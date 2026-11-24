#!/usr/bin/env python3
"""分段重建的段间对齐。

为什么需要：DA3 一次只能吃有限帧（实测 96 帧 / 2GB 稳定）。长视频必须切成
多段分别推理，但每段的坐标系与**尺度**都是独立的——DA3 出的是相对深度，
每段的第一帧各自为原点、尺度各自归一。直接把多段点云丢进同一个 TSDF，
会得到互相错位叠加的碎片（这正是「条带 / 麻点」的成因）。

对齐办法：切段时保留重叠帧。同一组物理帧在两段里都存在，于是可以拿两段的
**相机中心**做点集配准（Umeyama），解出相似变换 s/R/t，把后一段搬到前一段的
坐标系里。

为什么用相机中心而不是点云：点云稠密且无序，做配准要么慢要么需要法线/特征；
相机中心只有十几对，Umeyama 有闭式解，几十毫秒完成，且位姿本身就是 DA3 最
可信的输出。

尺度怎么处理：相似变换含尺度 s，而 TSDF 只接受刚体位姿。做法是把 s 吸收进
**深度值**（depth *= s），这样世界坐标等比缩放、旋转部分保持单位正交，c2w 的
旋转仍是正交阵，位姿仍是刚体。详见 apply_similarity 的推导。
"""
from __future__ import annotations

import numpy as np


def umeyama(src: np.ndarray, dst: np.ndarray, with_scale: bool = True):
    """最小二乘解 dst ≈ s * R @ src + t。

    Args:
        src: (N,3) 源点（后一段的相机中心）
        dst: (N,3) 目标点（前一段的对应相机中心），顺序必须与 src 一一对应

    Returns:
        (s, R, t)：标量 / (3,3) / (3,)

    退化情况（点共线、点数不足、全重合）返回 None，由调用方决定怎么降级——
    与其给出一个乱转的变换，不如让上层明确拒绝拼接。
    """
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[0] < 3 or src.shape[1] != 3:
        return None

    n = src.shape[0]
    mu_src = src.mean(axis=0)
    mu_dst = dst.mean(axis=0)
    src_c = src - mu_src
    dst_c = dst - mu_dst

    cov = (dst_c.T @ src_c) / n
    try:
        u, d, vt = np.linalg.svd(cov)
    except np.linalg.LinAlgError:
        return None

    # 反射修正：SVD 可能给出 det=-1 的「镜像旋转」，那不是真实位姿
    s_fix = np.eye(3)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        s_fix[2, 2] = -1.0
    r = u @ s_fix @ vt

    # 共线检测：第二个奇异值接近 0 说明点几乎在一条线上，解不唯一
    if d[0] <= 1e-12 or (d[1] / d[0]) < 1e-6:
        return None

    if with_scale:
        var_src = (src_c**2).sum() / n
        if var_src <= 1e-12:
            return None
        s = float(np.trace(np.diag(d) @ s_fix) / var_src)
        # 尺度离谱时（<0.05 或 >20）几乎一定是误对齐，宁可拒绝
        if not (0.05 <= s <= 20.0):
            return None
    else:
        s = 1.0

    t = mu_dst - s * (r @ mu_src)
    return s, r, t


def camera_centers(extrinsics: np.ndarray) -> np.ndarray:
    """(N,4,4) 的 world→camera 矩阵 → (N,3) 相机世界坐标。"""
    ex = np.asarray(extrinsics, dtype=np.float64)
    if ex.ndim != 3 or ex.shape[1:] != (4, 4):
        raise ValueError(f"extrinsics 形状不支持：{ex.shape}")
    rot = ex[:, :3, :3]
    trans = ex[:, :3, 3]
    # c2w 的平移 = -R^T t，等价于对每个 w2c 求逆的平移列
    return -np.einsum("nij,nj->ni", np.transpose(rot, (0, 2, 1)), trans)


def apply_similarity(depth: np.ndarray, extrinsics: np.ndarray, s: float, r: np.ndarray, t: np.ndarray):
    """把一段的（深度, 位姿）搬进目标坐标系。

    推导：相似变换 p_dst = s*R@p_src + t。TSDF 只接受刚体位姿，所以把 s 吸收进
    深度——深度与世界坐标同单位，depth' = s*depth 后世界坐标整体乘 s，
    于是 p_src' = s*p_src，映射退化为刚体 p_dst = R@p_src' + t。

    相机位姿：c2w 的旋转部分左乘 R（仍正交），平移部分 s*R*c2w_t + t。
    最后由 c2w 求逆得到新的 w2c，因此位姿始终是刚体的。

    Args:
        depth: (N,H,W)
        extrinsics: (N,4,4) world→camera
        s, r, t: umeyama 的输出

    Returns:
        (depth', extrinsics')，不修改入参
    """
    depth = np.asarray(depth)
    ex = np.asarray(extrinsics, dtype=np.float64)
    if ex.ndim != 3 or ex.shape[1:] != (4, 4):
        raise ValueError(f"extrinsics 形状不支持：{ex.shape}")

    c2w = np.linalg.inv(ex)
    rot_new = np.einsum("ij,njk->nik", np.asarray(r, dtype=np.float64), c2w[:, :3, :3])
    trans_new = s * np.einsum("ij,nj->ni", np.asarray(r, dtype=np.float64), c2w[:, :3, 3]) + np.asarray(
        t, dtype=np.float64
    )

    c2w_new = np.tile(np.eye(4), (len(ex), 1, 1))
    c2w_new[:, :3, :3] = rot_new
    c2w_new[:, :3, 3] = trans_new

    depth_new = depth.astype(np.float32) * float(s)
    return depth_new, np.linalg.inv(c2w_new)


def align_segment(depth, extrinsics, overlap_src: slice, overlap_dst, scale_hint: float | None = None):
    """用重叠帧把一段对齐到参考坐标系。

    Args:
        depth, extrinsics: 待对齐的这一段
        overlap_src: 本段里哪些帧是重叠帧（slice 或索引数组）
        overlap_dst: (M,3) 这些帧在参考坐标系里的相机中心，顺序与 overlap_src 一致
        scale_hint: 若已知上一段的尺度，可用来做合理性校验

    Returns:
        (depth', extrinsics', info) 或 (None, None, None) 表示对齐失败
    """
    ex = np.asarray(extrinsics)
    idx = np.arange(len(ex))[overlap_src] if isinstance(overlap_src, slice) else np.asarray(overlap_src)
    src_centers = camera_centers(ex)[idx]
    dst = np.asarray(overlap_dst, dtype=np.float64)
    if src_centers.shape != dst.shape or len(src_centers) < 3:
        return None, None, None

    solved = umeyama(src_centers, dst)
    if solved is None:
        return None, None, None
    s, r, t = solved

    # 残差检查：对齐后重叠帧的相机位置应该基本重合。
    # 残差过大说明这两段其实没对上（重叠帧选错了、或位姿本身崩了），
    # 这种情况继续拼接只会把脏数据混进同一个 TSDF。
    fitted = s * np.einsum("ij,nj->ni", r, src_centers) + t
    resid = np.linalg.norm(fitted - dst, axis=1)
    span = np.linalg.norm(dst.max(axis=0) - dst.min(axis=0))
    tol = max(0.02, span * 0.15) if span > 1e-9 else 0.05
    if float(np.median(resid)) > tol:
        return None, None, None

    depth_new, ex_new = apply_similarity(depth, ex, s, r, t)
    return depth_new, ex_new, {
        "scale": float(s),
        "residualMedian": float(np.median(resid)),
        "residualMax": float(resid.max()),
        "tolerance": float(tol),
        "overlapFrames": int(len(idx)),
    }
