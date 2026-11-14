import catalogJson from '../public/presets/camera-moves-whitebox-132/manifest.json'
import type { ShotData } from './types'

export type LexiconCategory = 'camera-move' | 'shot-grammar'

export type CameraLexiconEntry = {
  key: string
  cn: string
  en: string
  filename: string
  url: string
  /** 16:9 静帧封面；缺省时列表回退为视频元数据预览 */
  poster?: string
  section: number
  sectionTitle: string
  lexiconCategory: LexiconCategory
  grammarGroup?: string
  mapsToMove?: string
  mapsToSize?: string
  primaryForMove?: boolean
  primaryForSize?: boolean
  duration?: number
}

export type CameraLexiconCatalog = {
  id: string
  attribution: string
  basePath: string
  count: number
  entries: CameraLexiconEntry[]
}

const catalog = catalogJson as CameraLexiconCatalog

export const CAMERA_LEXICON_ATTRIBUTION = catalog.attribution || 'hong hou zi'

export function getCameraLexiconCatalog(): CameraLexiconCatalog {
  return catalog
}

export function getCameraLexiconEntry(key: string): CameraLexiconEntry | undefined {
  const k = String(key || '').trim()
  return catalog.entries.find((e) => e.key === k)
}

export function listCameraLexicon(filter?: {
  category?: LexiconCategory
  section?: number
  grammarGroup?: string
  move?: string
  size?: string
  q?: string
  limit?: number
}): CameraLexiconEntry[] {
  let list = catalog.entries.slice()
  if (filter?.category) list = list.filter((e) => e.lexiconCategory === filter.category)
  if (filter?.section) list = list.filter((e) => e.section === filter.section)
  if (filter?.grammarGroup) list = list.filter((e) => e.grammarGroup === filter.grammarGroup)
  if (filter?.move) {
    list = list.filter((e) => e.mapsToMove === filter.move || e.cn.includes(filter.move!))
  }
  if (filter?.size) {
    list = list.filter((e) => e.mapsToSize === filter.size)
  }
  const q = filter?.q?.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (e) =>
        e.key.includes(q) ||
        e.cn.toLowerCase().includes(q) ||
        e.en.toLowerCase().includes(q) ||
        e.sectionTitle.toLowerCase().includes(q),
    )
  }
  if (filter?.limit) list = list.slice(0, Math.max(1, filter.limit))
  return list
}

export function resolvePrimaryMove(move: string): CameraLexiconEntry | undefined {
  const m = String(move || '').trim()
  const primary = catalog.entries.find((e) => e.mapsToMove === m && e.primaryForMove)
  if (primary) return primary
  return catalog.entries.find((e) => e.mapsToMove === m)
}

export function resolvePrimarySize(size: string): CameraLexiconEntry | undefined {
  const s = String(size || '').trim()
  const primary = catalog.entries.find((e) => e.mapsToSize === s && e.primaryForSize)
  if (primary) return primary
  return catalog.entries.find((e) => e.mapsToSize === s)
}

/** 当前镜头应用中的参照（lexiconRefKey 优先，否则主参照） */
export function resolveShotLexiconRef(
  data: { size?: string; move?: string; lexiconRefKey?: string },
): CameraLexiconEntry | undefined {
  if (data.lexiconRefKey) return getCameraLexiconEntry(data.lexiconRefKey)
  const byMove = data.move ? resolvePrimaryMove(data.move) : undefined
  if (byMove) return byMove
  return data.size ? resolvePrimarySize(data.size) : undefined
}

/** 勾选「作为运镜 reference_video」时解析可提交的 MP4 地址（项目导入 URL 优先，否则预置库地址） */
export function resolveMotionLexiconVideoRef(
  data: Pick<ShotData, 'motionLexiconAsRef' | 'lexiconRefKey' | 'lexiconRefUrl' | 'size' | 'move'>,
): { url: string; label: string; key?: string } | null {
  if (!data.motionLexiconAsRef) return null
  const entry = data.lexiconRefKey
    ? getCameraLexiconEntry(data.lexiconRefKey)
    : resolveShotLexiconRef(data)
  const url = String(data.lexiconRefUrl || entry?.url || '').trim()
  if (!url) return null
  const label = entry ? `运镜参照（内置库）· ${entry.cn}` : '运镜参照（内置库）'
  return { url, label, key: entry?.key ?? data.lexiconRefKey }
}

export function lexiconMoveLine(data: {
  move?: string
  lexiconRefKey?: string
  videoPrompt?: string
  prompt?: string
}): string {
  const own = (data.videoPrompt || data.prompt || '').trim()
  if (own) return own
  const ref = resolveShotLexiconRef(data)
  if (ref?.en) {
    const move = String(data.move || '').trim()
    if (move === '固定') return `${ref.en}; static hold, subtle environmental motion only`
    return `${ref.en}; camera movement reference for ${move || 'this shot'}`
  }
  const move = String(data.move || '').trim()
  return move === '固定'
    ? '机位固定不动，仅人物与环境的细微动态'
    : `镜头${move}，24fps，画面无过曝无噪点`
}
