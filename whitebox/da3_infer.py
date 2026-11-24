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
  python da3_infer.py --video in.mp4 --out out.npz --fps 2 --max-frames 12
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
HARD_MAX_FRAMES = 12
MIN_FRAMES = 4
PROCESS_RES = 504


def log(msg: str) -> None:
    print(msg, flush=True)


def emit(event: dict) -> None:
    """结构化进度：服务端按行解析 stdout 里的 JSON。"""
    print(json.dumps(event, ensure_ascii=False), flush=True)


def whitebox_root(state_root: Path) -> Path:
    return state_root / ".whitebox"


def plan_frame_indices(total: int, src_fps: float, fps: float, max_frames: int) -> list[int]:
    """决定要读哪几帧。

    两段逻辑，缺一不可：
    1. fps → 按源帧率折算出步长，得到「按请求帧率抽」的候选。
    2. 候选超过 max_frames 时**在全片等间隔抽稀**，而不是截断取前 N 个。

    第 2 步是关键：一台机器重建 30 秒的镜头，截断取前 8 帧只会还原开头两秒，
    后面的空间完全丢失。等间隔抽稀才覆盖全片。
    """
    if total <= 0 or src_fps <= 0:
        return []
    step = max(1, int(round(src_fps / fps))) if fps > 0 else 1
    candidates = list(range(0, total, step))
    if not candidates:
        return []
    if len(candidates) <= max_frames:
        return candidates
    # 等间隔抽稀到 max_frames，含首尾
    if max_frames == 1:
        return [candidates[0]]
    picks = [round(i * (len(candidates) - 1) / (max_frames - 1)) for i in range(max_frames)]
    return [candidates[i] for i in picks]


def sample_frames(video: Path, fps: float, max_frames: int) -> tuple[list, float]:
    """按计划好的索引单遍读帧，避免把整条视频读进内存。

    返回 (RGB 帧列表, 实际帧率)。实际帧率回填给调用方，因为这个值是
    抽稀之后的等效值，不等于请求的 fps。
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
        wanted = plan_frame_indices(total, src_fps, fps, max_frames)
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
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True, help="输出 npz 路径")
    ap.add_argument("--fps", type=float, default=2.0)
    ap.add_argument("--max-frames", type=int, default=HARD_MAX_FRAMES)
    ap.add_argument("--state-root", default=str(HERE.parent))
    ap.add_argument("--device", default="", help="mps / cpu，留空自动")
    args = ap.parse_args()

    video = Path(args.video).expanduser().resolve()
    out = Path(args.out).expanduser().resolve()
    if not video.is_file():
        raise SystemExit(f"视频不存在：{video}")

    # 硬上限：规格要求 max_frames 不得超过 12
    max_frames = max(MIN_FRAMES, min(int(args.max_frames or HARD_MAX_FRAMES), HARD_MAX_FRAMES))
    if max_frames != int(args.max_frames or HARD_MAX_FRAMES):
        log(f"max-frames 被限制为 {max_frames}（硬上限 {HARD_MAX_FRAMES}）")

    state_root = Path(args.state_root).expanduser().resolve()
    wb = whitebox_root(state_root)
    vendor_src = wb / "vendor" / "depth-anything-3" / "src"
    model_dir = wb / "models" / "da3-base"

    if not (vendor_src / "depth_anything_3").is_dir():
        raise SystemExit(
            f"DA3 源码缺失：{vendor_src}\n先跑 bash whitebox/install.sh --state-root {state_root}"
        )
    if not (model_dir / "model.safetensors").is_file():
        raise SystemExit(
            f"权重缺失：{model_dir / 'model.safetensors'}\n"
            f"先跑 python whitebox/fetch_weights.py --state-root {state_root}"
        )
    sys.path.insert(0, str(vendor_src))

    started = time.time()
    emit({"type": "phase", "phase": "sampling"})
    frames, actual_fps = sample_frames(video, args.fps, max_frames)
    if len(frames) < MIN_FRAMES:
        emit({
            "type": "error",
            "code": "frames-too-few",
            "message": f"只抽出 {len(frames)} 帧，至少需要 {MIN_FRAMES} 帧。视频过短或帧率过低，建议提高抽帧帧率。",
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
        "fps": actual_fps,
        "is_metric": bool(pred.is_metric) if isinstance(pred.is_metric, (bool, int)) else None,
        "seconds": round(elapsed, 2),
    }
    emit(payload)
    log(f"✓ 完成：{out}（{depth.shape[0]} 帧，{elapsed:.1f}s）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
