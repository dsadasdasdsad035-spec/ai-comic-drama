#!/usr/bin/env python3
"""长视频分段重建：把一条长视频切成多段分别推理，对齐后合并成一份 npz。

为什么要分段：DA3 一次只吃有限帧——实测 96 帧峰值 2GB、耗时十几秒；帧数再上去
收益递减且容易撑爆内存（曾用 94 帧 × 756 分辨率把 24GB 机器干崩）。而单段 96 帧
按 0.15 秒间隔只覆盖 14 秒。要覆盖几分钟的巡游，只能分段。

分段的关键是**重叠**：相邻两段共享 N 帧。同一组物理帧在两段里各推一次，用它们的
相机中心做 Umeyama 配准，就能解出段间的相似变换（含尺度）——DA3 出的是相对深度，
每段尺度独立，不对齐直接合并只会得到互相错位叠加的碎片。

用法：
  python da3_stitch.py --video in.mp4 --out out.npz --interval 0.15 --segment-frames 96 --overlap 12
  python da3_stitch.py --video in.mp4 --out out.npz --segment-frames 96 --overlap 12 --min-overlap-residual 0.1

产物与 da3_infer.py 的 npz 完全同构（depth/conf/extrinsics/intrinsics），
所以 mesh_whitebox.py 不需要任何改动。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from stitch import align_segment, camera_centers  # noqa: E402

MIN_FRAMES = 4
PROCESS_RES = 504
HARD_MAX_FRAMES = 96


def log(msg: str) -> None:
    print(msg, flush=True)


def emit(event: dict) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def resolve_runtime_root(state_root: Path | None, runtime_root: Path | None) -> Path:
    if runtime_root is not None:
        return Path(runtime_root).expanduser().resolve()
    root = Path(state_root).expanduser().resolve() if state_root else HERE.parent
    return root / ".whitebox"


def plan_indices(total: int, src_fps: float, interval: float, segment_frames: int, overlap: int):
    """规划每段的帧索引。

    两件事：
    1. 按 interval 抽帧，得到全片的候选帧（可能几百帧）。
    2. 把这些候选帧切段，每段 segment_frames 帧，相邻段**共享 overlap 帧**。

    重叠帧是拼接的唯一依据，所以 overlap 不能太小：配准至少要 3 个非共线的相机
    中心，实际用 8–16 帧比较稳（多几帧能压制个别帧位姿偏差）。
    """
    if total <= 0 or src_fps <= 0:
        return []
    segment_frames = max(MIN_FRAMES * 2, int(segment_frames))
    overlap = max(3, min(int(overlap), segment_frames // 2))
    step = max(1, int(round(interval * src_fps)))
    candidates = list(range(0, total, step))
    if len(candidates) <= segment_frames:
        return [candidates] if candidates else []

    stride = segment_frames - overlap
    segments = []
    start = 0
    while start < len(candidates):
        chunk = candidates[start : start + segment_frames]
        if len(chunk) >= MIN_FRAMES:
            segments.append(chunk)
        if start + segment_frames >= len(candidates):
            break
        start += stride
    return segments


def read_frames_at(video: Path, indices: list[int]):
    """按给定索引抽帧（单遍读取，避免把整条视频读进内存）。"""
    import cv2

    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        raise SystemExit(f"无法打开视频：{video}")
    want = set(indices)
    picked: dict[int, object] = {}
    idx = 0
    last = max(indices) if indices else -1
    try:
        while idx <= last:
            ok, frame = cap.read()
            if not ok:
                break
            if idx in want:
                picked[idx] = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            idx += 1
    finally:
        cap.release()
    return [picked[i] for i in indices if i in picked]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True, help="输出 npz（与 da3_infer.py 同构）")
    ap.add_argument("--interval", type=float, default=0.15, help="抽帧间隔（秒）")
    ap.add_argument("--segment-frames", type=int, default=HARD_MAX_FRAMES, help="每段帧数")
    ap.add_argument("--overlap", type=int, default=12, help="相邻段共享的帧数")
    ap.add_argument(
        "--min-overlap-residual",
        type=float,
        default=0.0,
        help="覆盖默认容差；配准残差超过它即判该段对齐失败并停止拼接",
    )
    ap.add_argument("--state-root", default=None)
    ap.add_argument("--runtime-root", default=None)
    ap.add_argument("--device", default="")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if not video.is_file():
        raise SystemExit(f"视频不存在：{video}")

    wb = resolve_runtime_root(
        Path(args.state_root).expanduser().resolve() if args.state_root else None,
        Path(args.runtime_root).expanduser().resolve() if args.runtime_root else None,
    )
    vendor_src = wb / "vendor" / "depth-anything-3" / "src"
    model_dir = wb / "models" / "da3-base"
    if not (vendor_src / "depth_anything_3").is_dir():
        raise SystemExit(f"DA3 源码缺失：{vendor_src}")
    if not (model_dir / "model.safetensors").is_file():
        raise SystemExit(f"权重缺失：{model_dir / 'model.safetensors'}")
    sys.path.insert(0, str(vendor_src))

    import cv2
    import numpy as np
    import torch
    from depth_anything_3.api import DepthAnything3

    cap = cv2.VideoCapture(str(video))
    src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0) or 25.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()

    plan = plan_indices(total, src_fps, args.interval, args.segment_frames, args.overlap)
    if not plan:
        emit({"type": "error", "code": "frames-too-few", "message": "视频帧数不足，无法分段"})
        return 2

    duration = total / src_fps
    covered = (plan[-1][-1] - plan[0][0]) / src_fps if plan else 0
    log(
        f"分段规划：{len(plan)} 段，间隔 {args.interval:.2f}s，每段 {args.segment_frames} 帧，"
        f"重叠 {args.overlap} 帧 | 视频 {duration:.0f}s，覆盖 {covered:.0f}s"
    )
    emit({"type": "phase", "phase": "planning", "segments": len(plan)})

    device = torch.device(args.device) if args.device else torch.device(
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    log(f"设备：{device}")
    model = DepthAnything3.from_pretrained(str(model_dir)).to(device=device)

    all_depth: list[np.ndarray] = []
    all_conf: list[np.ndarray] = []
    all_ext: list[np.ndarray] = []
    all_intr: list[np.ndarray] = []
    reports = []
    # 上一段的尾部帧（全局索引）→ 相机中心，供下一段配准用
    prev_tail_indices: list[int] = []
    prev_tail_centers: np.ndarray | None = None
    failures = 0

    for si, indices in enumerate(plan):
        emit({"type": "phase", "phase": "inference", "segment": si + 1, "total": len(plan)})
        frames = read_frames_at(video, indices)
        if len(frames) < MIN_FRAMES:
            log(f"  第 {si + 1} 段可用帧不足（{len(frames)}），跳过")
            failures += 1
            continue

        pred = model.inference(frames, process_res=PROCESS_RES)
        depth = np.asarray(pred.depth)
        conf = np.asarray(pred.conf) if pred.conf is not None else np.zeros_like(depth, dtype=np.float32)
        intr = np.asarray(pred.intrinsics)
        ext = np.asarray(pred.extrinsics).astype(np.float64)
        if ext.shape[1:] == (3, 4):
            padded = np.tile(np.eye(4), (len(ext), 1, 1))
            padded[:, :3, :4] = ext
            ext = padded

        # ---- 对齐：找本段与上一段的重叠帧 ----
        align_info = None
        if prev_tail_centers is not None and prev_tail_indices:
            pos = {g: k for k, g in enumerate(prev_tail_indices)}
            pairs = [(k, pos[g]) for k, g in enumerate(indices) if g in pos]
            if len(pairs) >= 3:
                src_idx = [p[0] for p in pairs]
                dst_centers = prev_tail_centers[[p[1] for p in pairs]]
                depth, ext, align_info = align_segment(depth, ext, src_idx, dst_centers)
                if align_info is None:
                    log(f"  第 {si + 1} 段对齐失败（重叠 {len(pairs)} 帧），拼接中止")
                    emit(
                        {
                            "type": "error",
                            "code": "stitch-failed",
                            "message": (
                                f"第 {si + 1} 段与上一段无法对齐（重叠 {len(pairs)} 帧）。"
                                "常见原因：两段之间的相机运动太快，或视频中间有切镜。"
                            ),
                        }
                    )
                    return 5
                log(
                    f"  第 {si + 1} 段：对齐 {align_info['overlapFrames']} 帧，"
                    f"尺度 {align_info['scale']:.3f}，残差中位 {align_info['residualMedian']:.4f}"
                )
            else:
                log(f"  第 {si + 1} 段：重叠帧不足（{len(pairs)}），无法对齐，拼接中止")
                emit({"type": "error", "code": "stitch-failed", "message": "重叠帧不足，无法拼接"})
                return 5

        centers = camera_centers(ext)
        reports.append(
            {
                "segment": si + 1,
                "frames": len(frames),
                "span": [indices[0], indices[-1]],
                "align": align_info,
            }
        )

        # 重叠帧是下一段的配准依据，但**不重复并入最终点云**——
        # 同一批帧积分两次会把表面平均得更厚更糊。本段只保留非重叠部分。
        overlap_with_prev = set(prev_tail_indices) if prev_tail_indices else set()
        keep = [k for k, g in enumerate(indices) if g not in overlap_with_prev]
        if not keep:
            keep = list(range(len(indices)))
        all_depth.append(depth[keep])
        all_conf.append(conf[keep])
        all_ext.append(ext[keep])
        all_intr.append(intr[keep])

        # 本段尾部作为下一段的重叠区
        tail_n = min(args.overlap, len(indices))
        prev_tail_indices = indices[-tail_n:]
        prev_tail_centers = centers[-tail_n:]

    if not all_depth:
        emit({"type": "error", "code": "stitch-failed", "message": "没有任何段成功重建"})
        return 5

    depth_all = np.concatenate(all_depth, axis=0)
    conf_all = np.concatenate(all_conf, axis=0)
    ext_all = np.concatenate(all_ext, axis=0)
    intr_all = np.concatenate(all_intr, axis=0)

    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out, depth=depth_all, conf=conf_all, extrinsics=ext_all, intrinsics=intr_all
    )

    payload = {
        "type": "done",
        "npz": str(out),
        "frames": int(depth_all.shape[0]),
        "height": int(depth_all.shape[1]),
        "width": int(depth_all.shape[2]),
        "device": str(device),
        "sourceType": "video-stitched",
        "segments": len(plan),
        "segmentFailures": failures,
        "interval": args.interval,
        "seconds": None,
        "reports": reports,
    }
    emit(payload)
    log(f"✓ 完成：{out}（{depth_all.shape[0]} 帧，{len(plan)} 段）")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "code": "stitch-failed", "message": str(exc)})
        raise
