/**
 * 计价：单价集中在这里，并允许在设置页覆盖。
 *
 * 为什么不做成「固定准确价」：方舟的价格随模型 / 分辨率 / 活动变化，
 * 写死的数字一定会过期。这里的默认值是**估算**，对不上账单时去设置页按实际单价改。
 * 计费口径：
 *   - 图片：每张单价 × 张数（一次生成 N 张就是 N 次请求）
 *   - 视频：每秒单价 × 时长（方舟按 tokens 计费，秒单价是最接近的线性近似）
 *   - 配音：按句/按次，ElevenLabs 与 MiniMax 价格差异大，默认 0（不计入）
 */
export type Pricing = {
  /** 每张图（Seedream）单价，元 */
  image: number
  /** 视频每秒单价（480p / 720p），元 */
  video480: number
  video720: number
  /** 配音每次（一镜一句/一段）单价，元；0 = 不计入 */
  audio: number
}

export const DEFAULT_PRICING: Pricing = {
  image: 0.22,
  video480: 0.08,
  video720: 0.15,
  audio: 0,
}

/** 设置里可能只填了一部分，缺的用默认兜底 */
export function normalizePricing(p: Partial<Pricing> | undefined): Pricing {
  const num = (v: unknown, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : d
  }
  return {
    image: num(p?.image, DEFAULT_PRICING.image),
    video480: num(p?.video480, DEFAULT_PRICING.video480),
    video720: num(p?.video720, DEFAULT_PRICING.video720),
    audio: num(p?.audio, DEFAULT_PRICING.audio),
  }
}

export function imageCost(price: Pricing, n = 1): number {
  return Math.round(price.image * Math.max(1, n) * 1000) / 1000
}

export function videoCost(price: Pricing, seconds: number, res: '480p' | '720p' = '480p'): number {
  const per = res === '720p' ? price.video720 : price.video480
  return Math.round(per * Math.max(1, seconds) * 1000) / 1000
}

export function audioCost(price: Pricing): number {
  return Math.round(price.audio * 1000) / 1000
}

/** 显示用：小于 0.1 保留三位，其余两位 */
export function money(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0'
  return v < 0.1 ? v.toFixed(3) : v.toFixed(2)
}
