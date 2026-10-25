import type { Cap, ModelEntry } from './api'

export const CAP_ORDER: Cap[] = [
  'text',
  'textPro',
  'vision',
  'videoVision',
  'image',
  'view',
  'video',
  'videoRef',
  'audio',
]

export const CAP_LABELS: Record<Cap, string> = {
  text: '文本',
  textPro: '高质量文本',
  vision: '视觉',
  videoVision: '视频理解',
  image: '图像',
  view: '三视图',
  video: '视频',
  videoRef: '视频参考',
  audio: '配音',
}

/** 模型声明的能力；旧条目没有 caps 时退回单一 cap */
export function modelCaps(m: ModelEntry): Cap[] {
  return m.caps?.length ? m.caps : [m.cap]
}

/**
 * 能力谓词：新条目按 caps 精确判断，旧条目按 cap 保持原行为。
 * 视频参考额外接受显式 supportsVideoRef，避免要求目录为每个参考模型再建一行。
 */
export function modelHasCap(m: ModelEntry, cap: Cap): boolean {
  if (cap === 'videoRef') {
    const declared = m.caps?.length ? m.caps.includes('videoRef') : m.cap === 'videoRef'
    return declared || Boolean(m.supportsVideoRef)
  }
  if (m.caps?.length) return m.caps.includes(cap)
  return m.cap === cap
}

/** 目录已登记但运行时未接入的模型不能参与默认路由或生成 */
export function isRunnableModel(m: ModelEntry | undefined | null): boolean {
  return Boolean(m) && m!.runtime !== 'catalog-only'
}

export function modelCapsLabel(m: ModelEntry): string {
  const labels = modelCaps(m).map((c) => CAP_LABELS[c])
  if (m.supportsVideoRef && !modelCaps(m).includes('videoRef')) labels.push(CAP_LABELS.videoRef)
  return labels.join(' / ')
}
