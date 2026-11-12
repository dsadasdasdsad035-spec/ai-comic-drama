/** 画幅字符串（如 16:9）→ 宽高比；非法值按 16:9 处理。 */
export function aspectValue(aspect: string | undefined): number {
  const m = String(aspect || '16:9').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!m) return 16 / 9
  const a = Number(m[1])
  const b = Number(m[2])
  return a > 0 && b > 0 ? a / b : 16 / 9
}

/**
 * 代理预览 / 渲染共用像素尺寸：长边固定 960，短边按画幅取偶数。
 * 只做尺寸换算，不涉及任何场景几何。
 */
export function renderSize(aspect: string): { width: number; height: number } {
  const a = aspectValue(aspect)
  const long = 960
  let w: number
  let h: number
  if (a >= 1) {
    w = long
    h = Math.round(long / a / 2) * 2
  } else {
    h = long
    w = Math.round((long * a) / 2) * 2
  }
  return { width: Math.max(2, w), height: Math.max(2, h) }
}
