#!/usr/bin/env python3
"""视频 → 深度 + 位姿（DA3-BASE），产物是 npz 供 mesh_whitebox.py 消费。

为什么要拆成两个脚本：推理要 1.6GB 峰值、网格化要 3.1GB，同进程跑峰值叠加；
而且网格化失败时不该重跑一遍推理。

关键约束（都来自实测，见 openspec/changes/video-to-whitebox/design.md）：
- KMP_DUPLICATE_LIB_OK=TRUE 必须在 import torch 之前设进 os.environ。
  torch 与 pycolmap 各带一份 libomp，同进程会直接 abort。
- extrinsics 实际是 (N,3,4)，不是上游注释写的 (N,4,4)。
- 帧数少于 4 直接失败：位姿估计需要基线。

用法：
  python da3_infer.py --video in.mp4 --out out.npz --interval 0.5 --max-frames 96
  python da3_infer.py ... --state-root /path   # 指定 .whitebox 所在目录
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# 必须在任何 torch 导入之前。macOS 上 torch 与 pycolmap 各自链接一份 libomp，
# 同时初始化会让 OpenMP 直接 abort 掉进程（OMP: Error #15）。
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
# 别让 tokenizer 的并行 fork 影响单线程推理的可预测性
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

HERE = Path(__file__).resolve().parent
MIN_FRAMES = 4
# 帧数上限。实测（M4 Pro / 24GB，卧室 42 秒巡游）：
#   12 帧 → 1.55GB / 1.9s      42 帧 → 1.73GB / 6.2s      84 帧 → 2.07GB / 17.4s
# 内存几乎不随时间线增长，所以这个上限控制的是耗时与 TSDF 体素精度，不是内存。
HARD_MAX_FRAMES = 96
# 目标帧间隔 —— 本次修复的核心。
#
# 之前是「全片等间隔凑满 12 帧」：42 秒视频变成每 4 秒一帧，相邻帧相机早已
# 走出视野、画面几乎不重叠，DA3 估不出连贯位姿，重建塌成一片薄板
# （实测 15,874 面，形态完全不可辨）。
#
# 同一视频的对照实测：
#   间隔 4.0s（旧逻辑）→ 塌成薄片，看不出房间
#   间隔 1.0s          → 能辨认床与墙，69,390 面
#   间隔 0.5s          → 完整房间轮廓，位姿跳变 9 处 → 5 处
# 0.5 秒是「重叠足够」与「帧数可控」的平衡点：42 秒视频 → 84 帧 → 17 秒跑完。
TARGET_FRAME_INTERVAL = 0.5
PROCESS_RES = 504


def log(msg: str) -> None:
    print(msg, flush=True)


def emit(event: dict) -> None:
    """结构化进度：服务端按行解析 stdout 里的 JSON。"""
    print(json.dumps(event, ensure_ascii=False), flush=True)


def whitebox_root(state_root: Path) -> Path:
    return state_root / ".whitebox"


def resolve_runtime_root(state_root: Path | None, runtime_root: Path | None) -> Path:
    """环境根：随安装包时直接给 --runtime-root，用户自装时是 <state-root>/.whitebox。"""
    if runtime_root is not None:
        return Path(runtime_root).expanduser().resolve()
    root = Path(state_root).expanduser().resolve() if state_root else HERE.parent
    return whitebox_root(root)


def plan_frame_indices(
    total: int,
    src_fps: float,
    interval: float = TARGET_FRAME_INTERVAL,
    max_frames: int = HARD_MAX_FRAMES,
) -> list[int]:
    """按**固定时间间隔**取帧，而不是「全片凑满 N 帧」。

    这是重建质量的关键。DA3 靠相邻帧的重叠来估位姿；帧间隔一旦大到相机走出
    视野，位姿就崩，TSDF 会把互相矛盾的点云平均成一片噪声薄板。

    实测同一条 42 秒卧室巡游：
      间隔 4.0s（旧的摊薄逻辑）→ 塌成薄片，15,874 面
      间隔 1.0s               → 能辨认床与墙，69,390 面
      间隔 0.5s               → 完整房间轮廓，28,200 面（84 帧覆盖全片）

    所以默认 0.5 秒。只有当视频长到「间隔 0.5 秒会超过 max_frames」时，
    才退化成拉大间隔——保证覆盖全片但不让帧数爆掉。

    Args:
        total: 视频总帧数
        src_fps: 源帧率
        interval: 目标帧间隔（秒）
        max_frames: 帧数硬上限

    Returns:
        要读取的帧索引（升序）
    """
    if total <= 0 or src_fps <= 0:
        return []
    if interval <= 0:
        interval = TARGET_FRAME_INTERVAL

    # 长视频：先算「按 interval 取会有多少帧」，超上限就等比拉大间隔
    duration = total / src_fps
    want = max(1, int(round(duration / interval)) + 1)
    if want > max_frames:
        interval = duration / (max_frames - 1)

    step = max(1, int(round(interval * src_fps)))
    indices = list(range(0, total, step))
    if indices and indices[-1] > total - 1:
        indices[-1] = total - 1
    return indices[:max_frames]


def sample_frames(video: Path, interval: float, max_frames: int) -> tuple[list, float]:
    """按计划好的索引单遍读帧，避免把整条视频读进内存。

    返回 (RGB 帧列表, 实际帧率)。这个帧率是「间隔换算出的等效值」，
    长视频会自动拉大间隔，所以它可能小于 1/interval。
    """
    import cv2

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"无法打开视频：{video}")
    try:
        src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        if src_fps <= 0:
            src_fps = 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        wanted = plan_frame_indices(total, src_fps, interval, max_frames)
        if not wanted:
            return [], src_fps

        want_set = set(wanted)
        picked: dict[int, object] = {}
        index = 0
        last = wanted[-1]
        while index <= last:
            ok, frame = cap.read()
            if not ok:
                break
            if index in want_set:
                picked[index] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            index += 1
        frames = [picked[i] for i in wanted if i in picked]
    finally:
        cap.release()

    # 等效帧率：覆盖的时长 / 帧数，让下游知道帧间大致隔多久
    span_frames = (wanted[-1] - wanted[0]) if len(wanted) > 1 else 1
    actual_fps = (len(frames) - 1) * src_fps / span_frames if span_frames > 0 and len(frames) > 1 else src_fps
    log(
        f"抽帧：{len(frames)} 帧（源 {src_fps:.1f} fps / {total} 帧，"
        f"覆盖 0–{wanted[-1] if wanted else 0}，等效 {actual_fps:.2f} fps）"
    )
    return frames, actual_fps


def load_images(paths: list[Path], max_frames: int) -> list:
    """读取用户挑的图片，统一成 DA3 能吃的 RGB 数组列表。

    只做两件事：转 RGB、超过上限时等间隔抽取。不做裁剪或增强——
    图片是用户自己选的，动它反而可能破坏相邻图的重叠关系。
    """
    import cv2

    picked = paths[:max_frames]
    if len(paths) > max_frames:
        idx = [round(i * (len(paths) - 1) / (max_frames - 1)) for i in range(max_frames)]
        picked = [paths[i] for i in idx]
        log(f"图片数超过上限，等间隔抽到 {len(picked)} 张")

    frames = []
    skipped = []
    for path in picked:
        img = cv2.imread(str(path))
        if img is None:
            skipped.append(path.name)
            continue
        frames.append(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if skipped:
        log(f"跳过 {len(skipped)} 张无法读取的图片：{', '.join(skipped[:3])}{'…' if len(skipped) > 3 else ''}")
    return frames


def pad_extrinsics(extrinsics):
    """(N,3,4) 补成 (N,4,4)。

    上游 output_processor.py 的注释写 (N,4,4)，实测是 (N,3,4)。
    两种都接受，避免上游哪天改回来时这边崩掉。
    """
    import numpy as np

    if extrinsics is None:
        return None
    arr = np.asarray(extrinsics)
    if arr.ndim != 3:
        raise SystemExit(f"extrinsics 维度异常：{arr.shape}")
    if arr.shape[1:] == (4, 4):
        return arr
    if arr.shape[1:] == (3, 4):
        padded = np.tile(np.eye(4), (arr.shape[0], 1, 1))
        padded[:, :3, :4] = arr
        return padded
    raise SystemExit(f"不支持的 extrinsics 形状：{arr.shape}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    # 输入二选一：一段视频，或一组图片。
    #
    # 图片路线的优势是**可选择**：视频抽帧是自动的，会抽到字幕帧、黑帧、特写
    # 帧；图片由用户自己挑，每张都干净。实测同一条房间素材：
    #   1 张  → 无位姿基线，只有一层深度壳，出带状薄片
    #   8 张  → 基线 2.7，能重建出有体积的房间
    # 关键要求：相邻两张要有足够重叠（转身不超过约 60°），且最好走动而非原地转。
    ap.add_argument("--video", default=None, help="输入视频（与 --images 二选一）")
    ap.add_argument(
        "--images",
        nargs="+",
        default=None,
        help="输入图片路径列表（与 --video 二选一）。8–16 张，覆盖房间各方向",
    )
    ap.add_argument("--out", required=True, help="输出 npz 路径")
    ap.add_argument(
        "--interval",
        type=float,
        default=TARGET_FRAME_INTERVAL,
        help="目标帧间隔（秒）。默认 0.5——间隔越大，相邻帧重叠越少，位姿越容易崩",
    )
    # 兼容旧调用方（服务端早期的 --fps 参数）：给了 fps 就换算成间隔
    ap.add_argument("--fps", type=float, default=None, help=argparse.SUPPRESS)
    ap.add_argument("--max-frames", type=int, default=HARD_MAX_FRAMES)
    ap.add_argument("--state-root", default=None, help="用户自装时的状态根")
    ap.add_argument("--runtime-root", default=None, help="直接指定环境根（随安装包时用）")
    ap.add_argument("--device", default="", help="mps / cpu，留空自动")
    args = ap.parse_args()

    out = Path(args.out).expanduser().resolve()
    has_video = bool(args.video)
    has_images = bool(args.images)
    if has_video == has_images:
        raise SystemExit("必须且只能指定一种输入：--video 或 --images")
    video = Path(args.video).expanduser().resolve() if has_video else None
    if video is not None and not video.is_file():
        raise SystemExit(f"视频不存在：{video}")
    image_paths = []
    if has_images:
        image_paths = [Path(x).expanduser().resolve() for x in args.images]
        missing = [str(p) for p in image_paths if not p.is_file()]
        if missing:
            raise SystemExit(f"图片不存在：{missing[0]}" + (f" 等 {len(missing)} 个" if len(missing) > 1 else ""))
        if len(image_paths) < MIN_FRAMES:
            raise SystemExit(
                f"只给了 {len(image_paths)} 张图，至少需要 {MIN_FRAMES} 张。"
                "单张或多两张无法估出位姿，只会得到一层深度壳。建议 8–16 张，覆盖房间各方向。"
            )

    # 硬上限保护（见 HARD_MAX_FRAMES 的说明）
    max_frames = max(MIN_FRAMES, min(int(args.max_frames or HARD_MAX_FRAMES), HARD_MAX_FRAMES))
    if max_frames != int(args.max_frames or HARD_MAX_FRAMES):
        log(f"max-frames 被限制为 {max_frames}（硬上限 {HARD_MAX_FRAMES}）")

    state_root = Path(args.state_root).expanduser().resolve() if args.state_root else None
    wb = resolve_runtime_root(state_root, args.runtime_root)
    vendor_src = wb / "vendor" / "depth-anything-3" / "src"
    model_dir = wb / "models" / "da3-base"

    if not (vendor_src / "depth_anything_3").is_dir():
        raise SystemExit(
            f"DA3 源码缺失：{vendor_src}\n先跑 bash whitebox/install.sh --state-root {state_root or '<state-root>'}"
        )
    if not (model_dir / "model.safetensors").is_file():
        raise SystemExit(
            f"权重缺失：{model_dir / 'model.safetensors'}\n"
            f"先跑 python whitebox/fetch_weights.py --state-root {state_root or '<state-root>'}"
        )
    sys.path.insert(0, str(vendor_src))

    started = time.time()
    emit({"type": "phase", "phase": "sampling"})

    if image_paths:
        # 图片模式：不抽帧，直接读并统一尺寸。
        # 不做裁剪/缩放以外的处理——DA3 自己会按 process_res 归一。
        frames = load_images(image_paths, max_frames)
        actual_fps = 0.0
        log(f"图片来源：{len(frames)} 张（上限 {max_frames}）")
        if len(frames) < MIN_FRAMES:
            emit({
                "type": "error",
                "code": "frames-too-few",
                "message": f"只有 {len(frames)} 张可用图片，至少需要 {MIN_FRAMES} 张。",
            })
            return 2
    else:
        interval = args.interval
        if args.fps is not None and args.fps > 0:
            # 旧参数换算：fps=2 → interval=0.5
            interval = 1.0 / args.fps
            log(f"--fps {args.fps} 已换算为间隔 {interval:.2f}s（建议直接用 --interval）")
        log(f"抽帧策略：间隔 {interval:.2f}s，上限 {max_frames} 帧")
        frames, actual_fps = sample_frames(video, interval, max_frames)
        if len(frames) < MIN_FRAMES:
            emit({
                "type": "error",
                "code": "frames-too-few",
                "message": f"只抽出 {len(frames)} 帧，至少需要 {MIN_FRAMES} 帧。视频过短或帧率过低，建议减小抽帧间隔。",
            })
            return 2

    emit({"type": "phase", "phase": "inference"})
    try:
        import numpy as np
        import torch
        from depth_anything_3.api import DepthAnything3
    except ImportError as exc:  # 依赖缺失时说清缺什么，不要抛一堆栈
        emit({"type": "error", "code": "env-missing", "message": f"依赖导入失败：{exc}"})
        return 3

    if args.device:
        device = torch.device(args.device)
    else:
        device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    log(f"设备：{device}")

    try:
        model = DepthAnything3.from_pretrained(str(model_dir))
        model = model.to(device=device)
        pred = model.inference(frames, process_res=PROCESS_RES, export_format="mini_npz")
    except Exception as exc:  # noqa: BLE001 — 推理失败原因要原样透传给 UI
        emit({"type": "error", "code": "inference-failed", "message": f"DA3 推理失败：{exc}"})
        return 4

    extrinsics = pad_extrinsics(pred.extrinsics)
    depth = np.asarray(pred.depth)
    conf = np.asarray(pred.conf) if pred.conf is not None else np.array([])
    intrinsics = np.asarray(pred.intrinsics) if pred.intrinsics is not None else np.array([])

    emit({"type": "phase", "phase": "saving"})
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out,
        depth=depth,
        conf=conf,
        extrinsics=extrinsics if extrinsics is not None else np.array([]),
        intrinsics=intrinsics,
        images=np.stack(frames),
    )

    elapsed = time.time() - started
    payload = {
        "type": "done",
        "npz": str(out),
        "frames": int(depth.shape[0]),
        "height": int(depth.shape[1]),
        "width": int(depth.shape[2]),
        "device": str(device),
        # 图片来源没有帧率概念，给 null 而不是 0，免得前端显示「0 fps」
        "sourceType": "images" if image_paths else "video",
        "fps": actual_fps if not image_paths else None,
        "is_metric": bool(pred.is_metric) if isinstance(pred.is_metric, (bool, int)) else None,
        "seconds": round(elapsed, 2),
    }
    emit(payload)
    log(f"✓ 完成：{out}（{depth.shape[0]} 帧，{elapsed:.1f}s）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
