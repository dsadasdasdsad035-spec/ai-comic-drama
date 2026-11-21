/**
 * 轨道相机参数与用户可读单位之间的换算。
 *
 * 为什么单独成文件：面板要显示角度/米，同步逻辑要判断 epsilon，
 * 「适应视图」要算 distance —— 三处都依赖同一套换算，散在组件里
 * 会导致「滑杆显示 45° 但相机是 0.79 弧度」这类漂移。
 */

import type { OrbitPose } from './createEngine'

/** 弧度 -> 角度 */
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI
/** 角度 -> 弧度 */
export const degToRad = (deg: number): number => (deg * Math.PI) / 180

/** beta 是极角（0 = 正上方）。仰角用「俯视为 90、平视为 0」的语义，符合用户直觉。 */
export const betaToElevation = (beta: number): number => 90 - radToDeg(beta)
export const elevationToBeta = (elevation: number): number => degToRad(90 - elevation)

/** 仰角滑杆范围：不碰 90（正上方万向锁） */
export const ELEVATION_MIN = 0
export const ELEVATION_MAX = 89

/** 方位角显示范围 */
export const AZIMUTH_MIN = 0
export const AZIMUTH_MAX = 360

/** 目标坐标的滑杆范围（米）：够覆盖所有预设户型并留余地 */
export const TARGET_MIN = -30
export const TARGET_MAX = 30
/** 距离滑杆的显示范围；真实可用范围由相机 limit 决定 */
export const RADIUS_MIN = 0.5
export const RADIUS_MAX = 80

/** 相机值无实质变化的判定阈值 */
export const POSE_EPSILON = 1e-4

/** 把任意角度归一到 [0, 360) */
export function normalizeDeg(deg: number): number {
  const d = deg % 360
  return d < 0 ? d + 360 : d
}

/** 面板可读值：方位角归一化后的角度 */
export function poseToAzimuth(pose: OrbitPose): number {
  return normalizeDeg(radToDeg(pose.alpha))
}

/** 两个位姿在 epsilon 内是否相同 */
export function poseNearlyEqual(a: OrbitPose, b: OrbitPose): boolean {
  return (
    Math.abs(a.alpha - b.alpha) <= POSE_EPSILON &&
    Math.abs(a.beta - b.beta) <= POSE_EPSILON &&
    Math.abs(a.radius - b.radius) <= POSE_EPSILON &&
    Math.abs(a.target.x - b.target.x) <= POSE_EPSILON &&
    Math.abs(a.target.y - b.target.y) <= POSE_EPSILON &&
    Math.abs(a.target.z - b.target.z) <= POSE_EPSILON
  )
}

/** 一位小数的米制显示 */
export const meters = (v: number): string => `${v.toFixed(1)}m`

/**
 * 取景距离：让包围盒完整落在画面里并留余量。
 *
 * fovMode 是 VERTICAL_FIXED（Babylon 默认），所以垂直半角恒为 fov/2；
 * 水平半角随画布宽高比变化：tan(hHalf) = tan(vHalf) × aspect。
 * 取两者中更紧的那个约束：distance = max(需要的高度 / tan(vHalf), 需要的宽度 / tan(hHalf))。
 *
 * 早先直接用 `diag * 0.62`，漏了视场角这一步，相机贴得太近：
 * 大件被切边、小物件挤在角落，点选几乎命中不到。
 */
export function fitDistanceForBox(input: {
  /** 包围盒在相机横向上覆盖的宽度（米） */
  width: number
  /** 在纵向上覆盖的高度（米） */
  height: number
  /** 垂直视场角（弧度），Babylon 默认 0.8 */
  fov: number
  /** 画布宽高比 */
  aspect: number
  /** 余量系数，1.15 表示再退 15% */
  padding?: number
}): number {
  const pad = input.padding ?? 1.15
  const vHalf = Math.max(0.05, input.fov) / 2
  const tanV = Math.tan(vHalf)
  const tanH = tanV * Math.max(0.2, input.aspect)
  // 半高取包围盒高度的一半；半宽不取最大边的一半 —— 房间是长方形的，
  // 物体不会同时抵满左右两边，用「水平对角线的半径」更接近人眼取景：
  // 对 12×10m 的房间，sqrt(12²+10²)/2 ≈ 7.8，比 12/2=6 保守、却比
  // 直接用 12 的整宽省掉三分之一的距离。
  const halfSpan = Math.sqrt(input.width * input.width + input.height * input.height) / 2
  const byHeight = Math.max(0.1, input.height / 2) / tanV
  const byWidth = Math.max(0.1, halfSpan) / tanH
  return Math.max(1.2, Math.max(byHeight, byWidth) * pad)
}

/** 兼容旧调用：只知道对角线时，按正方体估算 */
export const FIT_RADIUS_FACTOR = 1.35
/** 适应视图时的极角：略俯视，不顶到天顶 */
export const FIT_BETA = 0.9
/** 退化包围盒的判定：小于这个对角线长度视为「没有可适配内容」 */
export const FIT_MIN_DIAGONAL = 0.01
