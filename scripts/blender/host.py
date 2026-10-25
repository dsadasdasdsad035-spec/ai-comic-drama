"""Blender 场景代码宿主。

由 Node 端以以下形式启动：
    blender --background --factory-startup --python-exit-code 1 \
            --python scripts/blender/host.py -- /path/to/job.json

职责边界：
- 宿主拥有渲染设置（分辨率、帧率、引擎、采样、输出路径），场景代码不能改。
- 场景代码只拥有 build(ctx) / pose(t, mode) / dispose() 三个入口。
- 同一 t 必须产生同一画面：宿主不提供墙钟、随机源或外部网络。

与 Node 的协议：stdout 每行 `ZCODE_JOB <json>`；其余输出是 Blender 自己的日志。
"""

import json
import os
import sys
import traceback

import bpy

SENTINEL = "ZCODE_JOB "

# 引擎别名 → Blender 内部标识的候选顺序（跨版本兼容）
ENGINE_ALIASES = {
    "eevee": ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"],
    "cycles": ["CYCLES"],
    "workbench": ["BLENDER_WORKBENCH"],
}


def emit(payload):
    sys.stdout.write(SENTINEL + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def available_engines(scene):
    """动态枚举只反映当前上下文，不能作为能力清单；用赋值探测实际可用引擎。"""
    out = []
    for candidate in ("BLENDER_EEVEE", "BLENDER_WORKBENCH", "CYCLES"):
        try:
            scene.render.engine = candidate
            out.append(candidate)
        except Exception:
            pass
    return out


def resolve_engine(scene, name):
    wanted = (name or "eevee").strip().lower()
    for candidate in ENGINE_ALIASES.get(wanted, [name]):
        try:
            scene.render.engine = candidate
            return candidate
        except Exception:
            continue
    raise RuntimeError(
        "不支持的渲染引擎 %r；本机可用引擎：%s"
        % (name, ", ".join(available_engines(scene)) or "未知")
    )


class SceneContext:
    """暴露给场景代码的最小上下文。字段名是 ABI 的一部分，改动需升 abiVersion。"""

    def __init__(self, scene, camera, camera_data, job):
        self.scene = scene
        self.camera = camera
        self.camera_data = camera_data
        self.width = int(job["width"])
        self.height = int(job["height"])
        self.aspect = self.width / max(1, self.height)
        self.duration = float(job["duration"])
        self.fps = int(job["fps"])
        self.mode = job.get("mode", "clean")
        self.shot = job.get("shot") or {}
        self._assets = {a["key"]: a for a in job.get("assets", [])}

    def asset(self, key):
        item = self._assets.get(str(key))
        if not item:
            return None
        path = item.get("path")
        return path if path and os.path.exists(path) else None

    def assets(self):
        return [
            {
                "key": a["key"],
                "label": a.get("label", a["key"]),
                "kind": a.get("kind", "image"),
                "path": a.get("path"),
                "width": a.get("width"),
                "height": a.get("height"),
                **({"videoDuration": a["videoDuration"]} if "videoDuration" in a else {}),
                **({"frameTime": a["frameTime"]} if "frameTime" in a else {}),
            }
            for a in self._assets.values()
        ]


def reset_scene(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # 与旧运行时一致的深灰底色；代码可通过 ctx.scene.world 覆盖。
    world = bpy.data.worlds.new("SceneWorld")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.067, 0.075, 0.094, 1.0)
        bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    cam_data = bpy.data.cameras.new("ShotCam")
    cam_data.lens = 45.0
    cam = bpy.data.objects.new("ShotCam", cam_data)
    cam.location = (0.0, -5.0, 1.6)
    cam.rotation_euler = (1.4835, 0.0, 0.0)  # 约 85°，看向 +Y
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.resolution_x = int(job["width"])
    scene.render.resolution_y = int(job["height"])
    scene.render.resolution_percentage = 100
    scene.render.fps = int(job["fps"])
    scene.render.fps_base = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False

    available = available_engines(scene)
    engine = resolve_engine(scene, job.get("engine"))
    samples = max(1, int(job.get("samples") or 16))
    if engine == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = False
        if hasattr(scene.cycles, "seed"):
            scene.cycles.seed = 0
        if hasattr(scene.cycles, "use_animated_seed"):
            scene.cycles.use_animated_seed = False
    elif engine.startswith("BLENDER_EEVEE"):
        if hasattr(scene, "eevee") and hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = samples
    return scene, cam, cam_data, engine, available


def load_code(code_path):
    with open(code_path, "r", encoding="utf-8") as fh:
        source = fh.read()
    namespace = {"__name__": "scene_code", "__file__": code_path}
    try:
        compiled = compile(source, code_path, "exec")
    except SyntaxError as exc:
        lines = source.splitlines()
        lineno = int(exc.lineno or 1)
        line = lines[lineno - 1] if 0 < lineno <= len(lines) else ""
        raise RuntimeError(
            "语法错误（第 %d 行）：%s；该行内容：%s"
            % (lineno, exc.msg or "invalid syntax", line.strip()[:160])
        ) from exc
    try:
        exec(compiled, namespace)
    except NameError as exc:
        if "ctx" in str(exc):
            raise RuntimeError(
                "代码在模块顶层引用了 ctx；宿主只在 build(ctx) 里提供 ctx，"
                "请把建场景逻辑移进 build(ctx)，不要在 import 时执行"
            ) from exc
        raise
    build = namespace.get("build")
    pose = namespace.get("pose")
    dispose = namespace.get("dispose")
    if not callable(build):
        raise RuntimeError("代码必须定义 build(ctx)")
    if not callable(pose):
        raise RuntimeError("代码必须定义 pose(t, mode)")
    return namespace, build, pose, (dispose if callable(dispose) else None)


def render_one(scene, t, fps, out_path):
    scene.frame_set(int(round(float(t) * fps)))
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)


def run(job_path):
    with open(job_path, "r", encoding="utf-8") as fh:
        job = json.load(fh)

    scene, cam, cam_data, engine, available = reset_scene(job)
    emit({"type": "start", "jobId": job.get("id"), "engines": available, "engine": engine})

    namespace, build, pose, dispose = load_code(job["codePath"])
    ctx = SceneContext(scene, cam, cam_data, job)
    try:
        build(ctx)
        if not scene.objects:
            raise RuntimeError("build 之后场景里没有任何对象")
        if scene.camera is None:
            raise RuntimeError("build 之后没有设置相机")

        times = [float(t) for t in job["times"]]
        frames_dir = job["framesDir"]
        os.makedirs(frames_dir, exist_ok=True)
        total = len(times)
        for index, t in enumerate(times):
            pose(t, ctx.mode)
            out_path = os.path.join(frames_dir, "%04d.png" % index)
            render_one(scene, t, int(job["fps"]), out_path)
            emit({"type": "progress", "frame": index + 1, "total": total, "t": t})
    finally:
        if dispose:
            try:
                dispose()
            except Exception:
                traceback.print_exc()

    emit({"type": "done", "frames": len(times), "engine": engine})


def main():
    argv = sys.argv
    args = argv[argv.index("--") + 1 :] if "--" in argv else []
    if not args:
        emit({"type": "error", "phase": "args", "message": "缺少 job.json 路径"})
        sys.exit(2)
    phase = "init"
    try:
        run(args[0])
    except Exception as exc:
        emit(
            {
                "type": "error",
                "phase": phase,
                "message": str(exc),
                "traceback": traceback.format_exc()[-4000:],
            }
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
