import type { MediaBundle, ProjectAssetItem } from './api'
import type { AssetKind } from './data'

export type PickSource = 'asset' | 'project-image' | 'generated-image' | 'video' | 'stock' | 'manual'

export type MediaType = 'image' | 'video' | 'audio'

export type PickItem = {
  /** 去重键，通常就是 url */
  key: string
  source: PickSource
  kind: AssetKind
  mediaType: MediaType
  title: string
  url: string
  name?: string
  size?: number
  mtime?: number
  /** 这张就是素材卡当前来源 */
  current?: boolean
}

export const SOURCE_LABEL: Record<PickSource, string> = {
  asset: '项目素材',
  'project-image': '项目图片',
  'generated-image': '生成图片',
  video: '视频',
  stock: '在线素材',
  manual: '当前来源',
}

export const KIND_LABEL: Record<AssetKind, string> = {
  scene: '场景',
  prop: '道具',
  image: '图片',
  video: '视频',
  audio: '音频',
  'expression-sheet': '表情总图',
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|aac|flac)(?:[?#].*)?$/i

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(String(url || ''))
}

export function isAudioUrl(url: string): boolean {
  return AUDIO_EXT.test(String(url || ''))
}

/**
 * 素材的媒体类型：kind 优先，其次按扩展名。
 * 所有「非视频即图片」的判断都应改为调用它，音频才不会漏进画面参考。
 */
export function assetMediaType(kind: AssetKind, url: string): MediaType {
  if (kind === 'audio' || isAudioUrl(url)) return 'audio'
  if (kind === 'video' || isVideoUrl(url)) return 'video'
  return 'image'
}

function fileOf(url: string): string {
  const clean = String(url || '').split(/[?#]/)[0]
  const part = clean.split('/').pop() || clean
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function withoutExt(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '')
}

function when(mtime?: number): string {
  if (!mtime) return ''
  const d = new Date(mtime)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readableTitle(
  source: PickSource,
  kind: AssetKind,
  rawTitle: string,
  url: string,
  mtime?: number,
): string {
  const title = rawTitle.trim()
  if (title && title !== '新素材') return title
  const label =
    source === 'generated-image'
      ? '生成图'
      : source === 'video'
        ? '视频'
        : source === 'stock'
          ? '在线素材'
          : source === 'project-image'
            ? '项目图'
            : KIND_LABEL[kind]
  const stamp = when(mtime)
  if (stamp) return `${label} · ${stamp}`
  const name = withoutExt(fileOf(url))
  return name ? `${label} · ${name}` : label
}

function mediaTypeOf(kind: AssetKind, url: string): MediaType {
  return assetMediaType(kind, url)
}

function assetItem(a: ProjectAssetItem): PickItem | null {
  const url = String(a.url || '').trim()
  if (!url) return null
  const kind: AssetKind =
    a.kind === 'scene' ||
    a.kind === 'prop' ||
    a.kind === 'video' ||
    a.kind === 'audio' ||
    a.kind === 'image' ||
    a.kind === 'expression-sheet'
      ? a.kind
      : 'image'
  return {
    key: url,
    source: 'asset',
    kind,
    mediaType: mediaTypeOf(kind, url),
    title: readableTitle('asset', kind, String(a.title || ''), url),
    url,
    name: fileOf(url),
  }
}

function imageItem(m: MediaBundle['images'][number]): PickItem {
  const source: PickSource = m.url.startsWith('/project-assets/')
    ? 'project-image'
    : 'generated-image'
  return {
    key: m.url,
    source,
    kind: 'image',
    mediaType: 'image',
    title: readableTitle(source, 'image', '', m.url, m.mtime),
    url: m.url,
    name: m.name,
    size: m.size,
    mtime: m.mtime,
  }
}

function videoItem(m: MediaBundle['videos'][number]): PickItem {
  return {
    key: m.url,
    source: 'video',
    kind: 'video',
    mediaType: 'video',
    title: readableTitle('video', 'video', '', m.url, m.mtime),
    url: m.url,
    name: m.name,
    size: m.size,
    mtime: m.mtime,
  }
}

function currentItem(url: string, kind: AssetKind): PickItem {
  return {
    key: `current:${url}`,
    source: 'manual',
    kind,
    mediaType: mediaTypeOf(kind, url),
    title: '当前来源',
    url,
    name: fileOf(url),
    current: true,
  }
}

/**
 * 把 /api/media 的三类数据归一化成选择器条目：
 * - 空 URL 的占位素材丢弃
 * - 同 URL 去重，项目素材优先
 * - 无 mtime 的项目素材保持原始顺序，其余按 mtime 倒序
 */
export function buildPickItems(
  media: MediaBundle,
  current?: { url?: string; kind: AssetKind },
): PickItem[] {
  const byUrl = new Map<string, PickItem>()

  const add = (item: PickItem | null) => {
    if (!item) return
    const old = byUrl.get(item.url)
    if (!old) {
      byUrl.set(item.url, item)
      return
    }
    // 项目素材记录带标题和类型，优先于原始图片/视频文件
    if (item.source === 'asset' && old.source !== 'asset') byUrl.set(item.url, item)
  }

  for (const a of media.assets ?? []) add(assetItem(a))
  for (const m of media.images ?? []) add(imageItem(m))
  for (const m of media.videos ?? []) add(videoItem(m))

  const currentUrl = String(current?.url || '').trim()
  const items = [...byUrl.values()]
  if (currentUrl) {
    let found = false
    for (const item of items) {
      if (item.url === currentUrl) {
        item.current = true
        found = true
      }
    }
    if (!found) items.push(currentItem(currentUrl, current?.kind ?? 'image'))
  }

  return items.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    return (b.mtime ?? 0) - (a.mtime ?? 0)
  })
}

/** 选择媒体后应写入的素材类型 */
export function pickKind(item: PickItem, currentKind: AssetKind): AssetKind {
  if (item.mediaType === 'video') return 'video'
  if (item.mediaType === 'audio') return 'audio'
  if (item.source === 'asset') return item.kind
  if (currentKind === 'scene' || currentKind === 'prop') return currentKind
  return 'image'
}

/** 只在标题为空/默认占位时自动填，不覆盖用户手改 */
export function pickTitle(item: PickItem, currentTitle: string): string {
  const title = String(currentTitle || '').trim()
  if (title && title !== '新素材') return currentTitle
  return item.title
}

/** 给 UI 分组用：视频和音频各自单独归类 */
export function pickerTabOf(item: PickItem): 'project' | 'generated' | 'video' | 'audio' | 'manual' {
  if (item.mediaType === 'audio') return 'audio'
  if (item.mediaType === 'video') return 'video'
  if (item.source === 'generated-image') return 'generated'
  if (item.source === 'asset' || item.source === 'project-image') return 'project'
  return 'manual'
}
