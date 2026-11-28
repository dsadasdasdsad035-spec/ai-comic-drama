import type { Cap, ModelEntry } from './api'

function isMusicGenModel(m: ModelEntry): boolean {
  return Boolean(m.features?.music) || /^flowmusic$/i.test(String(m.model || ''))
}

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
  'music',
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
  music: '音乐',
}

/** 模型声明的能力；旧条目没有 caps 时退回单一 cap */
export function modelCaps(m: ModelEntry): Cap[] {
  return m.caps?.length ? m.caps : [m.cap]
}

/** 生图能力：图像与三视图走同一份生图代码，只有默认位与存图目录不同 */
export function isImageCap(cap: Cap): boolean {
  return cap === 'image' || cap === 'view'
}

/** 全部生图能力，用于下拉一次列出整族 */
export const IMAGE_CAPS: Cap[] = ['image', 'view']

/** 只按条目声明判断，不含下文的能力家族规则；单独抽出避免家族判断自递归 */
function declaredCap(m: ModelEntry, cap: Cap): boolean {
  if (m.caps?.length) return m.caps.includes(cap)
  return m.cap === cap
}

/**
 * 能力谓词：新条目按 caps 精确判断，旧条目按 cap 保持原行为。
 * 视频参考额外接受显式 supportsVideoRef，避免要求目录为每个参考模型再建一行。
 *
 * 生图族：image 与 view 实质是同一个能力，任一声明都算数，双向成立。
 * 因此主声明为图像（或三视图）的模型会同时出现在两处选择列表里；
 * 两个默认位 defaults.image / defaults.view 仍各自独立。
 * 该规则只对生图生效，不得外溢到文本、视频、配音。
 */
export function modelHasCap(m: ModelEntry, cap: Cap): boolean {
  if (cap === 'videoRef') {
    return declaredCap(m, 'videoRef') || Boolean(m.supportsVideoRef)
  }
  if (isImageCap(cap)) return declaredCap(m, 'image') || declaredCap(m, 'view')
  if (cap === 'music') return declaredCap(m, 'music') || isMusicGenModel(m)
  return declaredCap(m, cap)
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
