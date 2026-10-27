/** 在线素材结果的展示格式化：许可、署名、尺寸与时长。纯函数，便于单测。 */
import type { StockLicense } from './types'

export function stockLicenseLabel(license?: StockLicense | null): string {
  const name = String(license?.name || '').trim()
  return name || '未标注许可'
}

/**
 * 署名文本：优先用来源给的 attribution；
 * 来源没给时按「作者 · 许可 · 来源」拼，缺作者写「原作者未署名」。
 */
export function stockAttributionText(
  license?: StockLicense | null,
  fallback?: { author?: string; source?: string },
): string {
  const attribution = String(license?.attribution || '').trim()
  if (attribution) return attribution
  const author = String(fallback?.author || '').trim() || '原作者未署名'
  const source = String(fallback?.source || '').trim() || '在线素材库'
  return `${author} · ${stockLicenseLabel(license)} · ${source}`
}

export function stockSizeText(input: { width?: number; height?: number }): string {
  const w = Number(input?.width) || 0
  const h = Number(input?.height) || 0
  return w > 0 && h > 0 ? `${w} × ${h}` : '—'
}

export function stockDurationText(seconds?: number): string {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return '—'
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return `${m}:${String(rest).padStart(2, '0')}`
}
