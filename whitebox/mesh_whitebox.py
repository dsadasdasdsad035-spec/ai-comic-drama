#!/usr/bin/env python3
"""npz（深度 + 位姿）→ TSDF 三角网格 → clay 白模 GLB。

全部约束都来自实测，见 openspec/changes/video-to-whitebox/design.md：
- **必须用 UniformTSDFVolume**。open3d 0.20 的 mac arm64 版 ScalableTSDFVolume
  恒返回空网格——用官方文档式的单帧平面测试（voxel_length=0.01、单位尺度）
  同样得到 0 顶点 0 三角，而 UniformTSDFVolume 同样输入出 1302 顶点 2460 三角。
  这不是参数问题，是那个 GT 实现在该平台上的缺陷。
- trimesh 导出 GLB **不会自动写 NORMAL**。必须访问 tm.vertex_normals 触发
  惰性计算，否则 GLB 只有 POSITION，Babylon 里会渲染成一块纯色。
- TSDF 出来的网格体积可能为负（整体朝内），要 invert 成朝外。
- 深度是相对值（DA3-BASE 非米制），尺度任意：包围盒最大边归一。

用法：
  python mesh_whitebox.py --npz in.npz --out out.glb --target-size 6
  python mesh_whitebox.py --npz in.npz --out out.glb --json   # 输出统计 JSON
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

# 少于这个三角数就认为重建失败。实测正常视频出 34k~70k 面，
# 而 open3d 那个 TSDF 缺陷会给出 0，空壳给不出任何可用信息。
MIN_TRIANGLES = 1000
# 顶点颜色：中性灰。白模要看的是形体与光影，不是材质。
CLAY_RGB = [200, 200, 200]
CLAY_ROUGHNESS = 0.85
# 超过这个面数就简化，避免单个 GLB 拖慢 Babylon。
MAX_FACES = 400_000


def log(msg: str) -> None:
    print(msg, flush=True)


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def load_npz(npz_path: Path):
    import numpy as np

    data = np.load(npz_path)
    depth = data["depth"]
    conf = data["conf"] if "conf" in data.files and data["conf"].size else None
    extrinsics = data["extrinsics"]
    intrinsics = data["intrinsics"]

    if depth.ndim != 3:
        raise SystemExit(f"depth 维度异常：{depth.shape}，期望 (N,H,W)")
    if extrinsics.size == 0 or intrinsics.size == 0:
        raise SystemExit("npz 缺少位姿（extrinsics/intrinsics），无法融合")

    return depth, conf, extrinsics, intrinsics


def fused_points(depth, extrinsics, intrinsics):
    """逐帧反投影成世界坐标点云，用于估体素长度与包围盒。

    只用于估算，不参与 TSDF 积分——真正积分走 RGDBImage，那里 open3d 自己算。
    """
    import numpy as np

    n, h, w = depth.shape
    fx, fy = intrinsics[0, 0, 0], intrinsics[0, 1, 1]
    cx, cy = intrinsics[0, 0, 2], intrinsics[0, 1, 2]
    chunks = []
    for i in range(n):
        di = depth[i].astype(np.float64)
        ys, xs = np.nonzero(di > 1e-6)
        if len(xs) == 0:
            continue
        z = di[ys, xs]
        x = (xs - cx) * z / fx
        y = (ys - cy) * z / fy
        p_cam = np.stack([x, y, z], axis=-1)
        c2w = np.linalg.inv(extrinsics[i])
        p_world = (c2w[:3, :3] @ p_cam.T).T + c2w[:3, 3]
        chunks.append(p_world)
    if not chunks:
        raise SystemExit("所有帧的深度都为空，无法重建")
    return np.concatenate(chunks, axis=0)


def center_extrinsics(extrinsics, centroid):
    """把世界坐标平移 -centroid，使场景落在原点附近。

    为什么必须做：**UniformTSDFVolume 的体积盒固定以世界原点为中心**
    （实测：场景在 z=9、盒长 4 时积分出 0 个三角面）。而 DA3 的位姿是相对
    第一帧的，场景质心可能在任意位置——不归零就会有相当部分被盒切掉，
    表现为「只重建出一片薄板」。

    平移世界坐标等价于改 w2c 的平移列：
    p_cam = R·p_world + t = R·(p_new + c) + t = R·p_new + (R·c + t)
    """
    import numpy as np

    adjusted = np.array(extrinsics, dtype=np.float64, copy=True)
    for i in range(len(adjusted)):
        rotation = adjusted[i, :3, :3]
        adjusted[i, :3, 3] = rotation @ centroid + adjusted[i, :3, 3]
    return adjusted


def integrate_tsdf(depth, conf, extrinsics, intrinsics, volume_length, resolution, conf_filter=False):
    """逐帧 TSDF 积分并提取三角网格。

    用 UniformTSDFVolume（不是 ScalableTSDFVolume，原因见模块 docstring）。
    调用方必须先把 extrinsics 平移到质心归零，见 center_extrinsics。
    """
    import numpy as np
    import open3d as o3d

    n, h, w = depth.shape
    fx, fy = float(intrinsics[0, 0, 0]), float(intrinsics[0, 1, 1])
    cx, cy = float(intrinsics[0, 0, 2]), float(intrinsics[0, 1, 2])
    intrinsic = o3d.camera.PinholeCameraIntrinsic(w, h, fx, fy, cx, cy)

    voxel_length = volume_length / max(1, resolution)
    volume = o3d.pipelines.integration.UniformTSDFVolume(
        length=float(volume_length),
        resolution=int(resolution),
        sdf_trunc=float(voxel_length * 4),
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.Gray32,
    )

    # 置信度过滤默认关闭。
    #
    # 实测三份真实视频：robot 过滤前后都是 22364 面（无收益），
    # duel 过滤后直接 0 面、不过滤 431 面（纯损失），repo 过滤后 1012 面、
    # 不过滤更多（纯损失）。DA3 的 depth 已经是最终输出，conf 只反映
    # 模型内部一致度，拿它做逐像素剪枝会把薄表面切碎——TSDF 需要连续
    # 表面才能形成零交叉。
    #
    # 保留开关：如果将来遇到噪点严重的输入（比如低照度手持），
    # --conf-filter 可以打开，按帧内 30 百分位置 0（丢弃，不是相乘——
    # 相乘会把有效深度压成小数，实测同参数下 0 三角 vs 415 三角）。
    conf_mask = None
    if conf_filter and conf is not None and conf.size:
        threshold = float(np.percentile(conf, 30))
        conf_mask = conf >= threshold
        log(f"置信度过滤已开启（阈值 {threshold:.2f}，丢弃 ~30% 像素）")

    valid_depth = depth[depth > 1e-6]
    if valid_depth.size == 0:
        raise SystemExit("深度全为 0，视频可能没有有效视差")
    # 截断到 99.5 百分位：个别打空的射线深度爆表会把体素尺度拖到无量级
    depth_trunc = float(np.percentile(valid_depth, 99.5)) * 2.0

    color = np.full((h, w, 3), 255, dtype=np.uint8)
    integrated = 0
    for i in range(n):
        di = depth[i].astype(np.float32)
        if conf_mask is not None:
            # 布尔掩码：不可信的像素整格丢掉
            di = np.where(conf_mask[i], di, 0.0).astype(np.float32)
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(color),
            o3d.geometry.Image(di),
            depth_scale=1.0,
            depth_trunc=depth_trunc,
            convert_rgb_to_intensity=True,
        )
        volume.integrate(rgbd, intrinsic, extrinsics[i].astype(np.float64))
        integrated += 1

    mesh = volume.extract_triangle_mesh()
    return mesh, integrated, voxel_length


def faces_point_outward(tri, camera_positions):
    """判断法线整体朝外还是朝内。

    为什么不用 volume 的符号：TSDF 从有限视角重建出的表面**不闭合**
    （背面没有观测，必然留开口），而 trimesh 的 volume 对有洞的网格
    没有意义——实测正常产物 volume 恒为负，但渲染结果是对的。
    用 volume 判朝向会得到一个假信号。

    真正的判据是：重建的表面是被相机从外面看到的，所以外法线应当指向相机。
    逐顶点找最近的相机，算 dot(normal, cam - vertex)，多数为负说明法线整体
    朝内，需要翻转。
    """
    import numpy as np

    if tri.vertices.shape[0] == 0 or len(camera_positions) == 0:
        return True

    verts = np.asarray(tri.vertices)
    normals = np.asarray(tri.vertex_normals)

    # 顶点多时只抽一部分，最近邻扫描是 O(V*C)，全量在 40k 顶点上没必要
    stride = max(1, len(verts) // 4000)
    sample_v = verts[::stride]
    sample_n = normals[::stride]
    cams = np.asarray(camera_positions)

    votes = 0
    for vertex, normal in zip(sample_v, sample_n):
        nearest = cams[np.argmin(np.linalg.norm(cams - vertex, axis=1))]
        if float(np.dot(normal, nearest - vertex)) >= 0:
            votes += 1
    return votes >= len(sample_v) / 2.0


def write_glb(mesh, out_path: Path, target_size: float, stats: dict, camera_positions=None) -> dict:
    """网格 → clay 白模 GLB。

    四步都不可省：
    1. fix_normals + 体积为负则 invert → 否则在查看器里像内壁。
    2. 触碰 vertex_normals → trimesh 惰性算完才把 NORMAL 写进导出流。
    3. 双面材质 → 局部法线不一致处不出黑洞。
    4. 包围盒最大边归一 → 相对尺度进得去「场景三维」。
    """
    import numpy as np
    import trimesh

    tri = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices),
        faces=np.asarray(mesh.triangles),
        process=True,
    )
    before_faces = len(tri.faces)
    if before_faces < MIN_TRIANGLES:
        raise SystemExit(
            f"重建过于稀疏：只有 {before_faces} 个三角面（阈值 {MIN_TRIANGLES}）。"
            "可能是视频视差不足、视角过窄，或抽到的帧几乎静止。"
        )

    if before_faces > MAX_FACES:
        tri = tri.simplify_quadric_decimation(MAX_FACES)
        log(f"面数超限，简化到 {len(tri.faces)}")

    tri.fix_normals()
    # 触碰一次让法线算出来，faces_point_outward 要用
    _ = tri.vertex_normals
    if camera_positions and not faces_point_outward(tri, camera_positions):
        tri.invert()
        log("法线整体朝内，已翻转")

    # 尺度归一 + 居中
    verts = np.asarray(tri.vertices)
    lo, hi = verts.min(axis=0), verts.max(axis=0)
    extent = hi - lo
    max_edge = float(extent.max())
    if max_edge <= 1e-9:
        raise SystemExit("网格包围盒退化（所有顶点重合），无法归一尺度")
    scale = float(target_size) / max_edge
    center = (lo + hi) / 2.0
    tri.vertices = (verts - center) * scale

    # 必须在导出前访问，否则 GLB 里没有 NORMAL
    _ = tri.vertex_normals

    material = trimesh.visual.material.PBRMaterial(
        name="clay",
        baseColorFactor=[*CLAY_RGB, 255],
        roughnessFactor=CLAY_ROUGHNESS,
        metallicFactor=0.0,
        doubleSided=True,
    )
    tri.visual = trimesh.visual.TextureVisuals(material=material)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    tri.export(str(out_path))

    new_extent = np.asarray(tri.vertices).max(axis=0) - np.asarray(tri.vertices).min(axis=0)
    stats.update(
        {
            "triangles": int(len(tri.faces)),
            "vertices": int(len(tri.vertices)),
            "facesBeforeSimplify": int(before_faces),
            "bbox": [round(float(v), 3) for v in new_extent.tolist()],
            "bboxMaxEdge": round(float(new_extent.max()), 3),
            "scaleApplied": round(scale, 4),
            "bytes": out_path.stat().st_size,
        }
    )
    return stats


def main() -> int:
    import numpy as np

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--npz", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--target-size", type=float, default=6.0, help="包围盒最大边归一到多少米")
    ap.add_argument("--resolution", type=int, default=384, help="TSDF 体素数")
    ap.add_argument("--json", action="store_true", help="把统计打进 done 事件")
    ap.add_argument(
        "--conf-filter",
        action="store_true",
        help="开启置信度过滤（默认关；实测在多数视频上只会切碎薄表面）",
    )
    args = ap.parse_args()

    npz_path = Path(args.npz).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()
    if not npz_path.is_file():
        raise SystemExit(f"npz 不存在：{npz_path}")
    if not (args.target_size > 0.1):
        raise SystemExit(f"目标尺寸不合理：{args.target_size}")

    started = time.time()
    emit({"type": "phase", "phase": "loading"})
    depth, conf, extrinsics, intrinsics = load_npz(npz_path)

    emit({"type": "phase", "phase": "fusing"})
    points = fused_points(depth, extrinsics, intrinsics)
    lo, hi = points.min(axis=0), points.max(axis=0)
    span = float(np.max(hi - lo))
    if span <= 1e-6:
        raise SystemExit("点云退化成单点，无法重建")

    # 体积盒以原点为中心，场景必须先平移进来，否则被切掉（见 center_extrinsics）
    centroid = (lo + hi) / 2.0
    centered = center_extrinsics(extrinsics, centroid)
    # 留 25% 余量，避免场景贴边被切
    volume_length = span * 1.25
    log(
        f"点云 {len(points)} 点，跨度 {span:.3f}，"
        f"质心 {np.round(centroid, 3).tolist()}（已归零），体素盒 {volume_length:.3f}"
    )

    # 相机世界坐标：法线朝向判定要用（归零后的坐标系下，c2w 的平移列）
    camera_positions = [
        (-np.asarray(centered[i][:3, :3]).T @ np.asarray(centered[i][:3, 3])).tolist()
        for i in range(len(centered))
    ]

    mesh, integrated, voxel_length = integrate_tsdf(
        depth, conf, centered, intrinsics, volume_length, args.resolution, args.conf_filter
    )
    tri_count = len(mesh.triangles)
    log(f"TSDF：{integrated} 帧积分，{len(mesh.vertices)} 顶点 / {tri_count} 三角（体素 {voxel_length:.4f}）")
    if tri_count == 0:
        raise SystemExit(
            "TSDF 融合产出空网格。如果这台机器是 mac arm64，检查是否误用了 "
            "ScalableTSDFVolume（该实现恒返回空网格，必须用 UniformTSDFVolume）。"
        )

    emit({"type": "phase", "phase": "exporting"})
    stats = {"frames": int(depth.shape[0]), "integrated": integrated}
    stats = write_glb(mesh, out_path, args.target_size, stats, camera_positions)
    stats.update(
        {
            "type": "done",
            "glb": str(out_path),
            "seconds": round(time.time() - started, 2),
        }
    )
    emit(stats)
    log(
        f"✓ {out_path.name}：{stats['triangles']} 面，"
        f"包围盒 {stats['bbox']}，{stats['bytes'] // 1024} KB，{stats['seconds']}s"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — 把原因透传给服务端，不要只留栈
        emit({"type": "error", "code": "mesh-failed", "message": str(exc)})
        raise
