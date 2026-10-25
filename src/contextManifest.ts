import type { Shot3DContext } from './types'
import {
  allCatalogItems,
  itemIsSelected,
  type Shot3DContextCatalog,
  type Shot3DContextItem,
} from './shot3dContextCatalog'

/** 只有这几项可以作为文本附件；景别/运镜不再自动发送。 */
export type ManifestTextName =
  | 'prompt'
  | 'videoPrompt'
  | 'cast'
  | 'sizeMove'
  | 'marks'
  | 'dialogue'
  | 'scene'

export type ManifestImageAttachment = {
  kind: 'image'
  key: string
  label: string
  source: 'character' | 'design' | 'asset' | 'image'
  url: string
  includeBrief: boolean
}

export type ManifestVideoAttachment = {
  kind: 'video'
  key: string
  label: string
  url: string
  duration?: number
  frameTimes: number[]
  includeBrief: boolean
}

export type ManifestTextAttachment = {
  kind: 'text'
  key: string
  name: ManifestTextName
  label: string
  text: string
}

export type ManifestAttachment =
  | ManifestImageAttachment
  | ManifestVideoAttachment
  | ManifestTextAttachment

export type ContextManifest = {
  version: 1
  shot: {
    id?: string
    no: string
    duration: number
    aspect: string
  }
  attachments: ManifestAttachment[]
}

export type ManifestCounts = { image: number; video: number; text: number }

export type ManifestSummary = {
  attachmentKeys: string[]
  counts: ManifestCounts
  metadata: ContextManifest['shot']
}

export type BuildManifestInput = {
  context: Shot3DContext
  catalog: Shot3DContextCatalog
  shotId?: string
  shotNo?: string
  duration: number
  aspect: string
}

function sourceOf(item: Shot3DContextItem): ManifestImageAttachment['source'] {
  if (item.category === 'character') return 'character'
  if (item.category === 'scene' || item.category === 'prop') return 'design'
  if (item.category === 'asset') return 'asset'
  return 'image'
}

/** 当前选择里真正可以作为图片附件的条目；同一 URL 只保留一次。 */
export function selectedImageItems(
  catalog: Shot3DContextCatalog,
  context: Shot3DContext,
): Shot3DContextItem[] {
  const seen = new Set<string>()
  const out: Shot3DContextItem[] = []
  for (const item of allCatalogItems(catalog)) {
    if (!item.url || item.category === 'video') continue
    if (!itemIsSelected(context, item) || seen.has(item.url)) continue
    seen.add(item.url)
    out.push(item)
  }
  return out
}

export function selectedVideoItems(
  catalog: Shot3DContextCatalog,
  context: Shot3DContext,
): Shot3DContextItem[] {
  return catalog.videos.filter((v) => Boolean(v.url) && context.videoUrls.includes(v.url!))
}

function videoFrameTimes(duration: number | undefined, count = 3): number[] {
  const total = Number(duration) || 0
  if (total <= 0) return []
  const n = Math.max(2, count)
  return Array.from({ length: n }, (_, i) => Number(((total * i) / (n - 1)).toFixed(3)))
}

function textAttachment(
  name: ManifestTextName,
  label: string,
  text: string,
): ManifestTextAttachment {
  return { kind: 'text', key: `text:${name}`, name, label, text }
}

/**
 * 把显式选择投影成发送清单。
 * 这里只读取 Shot3DContext 中真正选中的项；不读 catalog.defaults，也不补镜头头内容。
 */
export function buildManifest(input: BuildManifestInput): ContextManifest {
  const { context, catalog } = input
  const briefOff = new Set(context.briefOff || [])
  const attachments: ManifestAttachment[] = []

  for (const item of selectedImageItems(catalog, context)) {
    attachments.push({
      kind: 'image',
      key: item.key,
      label: item.label,
      source: sourceOf(item),
      url: item.url!,
      includeBrief: !briefOff.has(item.key),
    })
  }

  for (const video of selectedVideoItems(catalog, context)) {
    attachments.push({
      kind: 'video',
      key: video.key,
      label: video.label,
      url: video.url!,
      ...(video.videoDuration != null ? { duration: Number(video.videoDuration) } : {}),
      frameTimes: videoFrameTimes(video.videoDuration),
      includeBrief: !briefOff.has(video.key),
    })
  }

  const t = context.text
  const cat = catalog.text
  if (t.prompt && cat.prompt) attachments.push(textAttachment('prompt', '画面提示词', cat.prompt))
  if (t.videoPrompt && cat.videoPrompt) {
    attachments.push(textAttachment('videoPrompt', '运动提示词', cat.videoPrompt))
  }
  if (t.cast && cat.cast.length) {
    attachments.push(textAttachment('cast', '出场角色', cat.cast.join('、')))
  }
  if (t.sizeMove && cat.sizeMove) {
    attachments.push(textAttachment('sizeMove', '景别/运镜', cat.sizeMove))
  }
  if (t.marks && cat.marks) attachments.push(textAttachment('marks', '画面标注', cat.marks))

  const dialogue = t.dialogue
  const lines =
    dialogue === 'all'
      ? cat.dialogue
      : cat.dialogue.filter((line) => dialogue.includes(line.index))
  if (lines.length) {
    attachments.push(
      textAttachment(
        'dialogue',
        `台词（${lines.length} 句）`,
        lines.map((line) => `${line.speaker || '旁白'}：${line.text}`).join('\n'),
      ),
    )
  }

  for (const sceneKey of context.sceneKeys) {
    const item = catalog.scenes.find(
      (x) => x.kind === 'scene-text' && x.key === `scene:${sceneKey}`,
    )
    if (!item) continue
    attachments.push({
      kind: 'text',
      key: `text:scene:${sceneKey}`,
      name: 'scene',
      label: item.label,
      text: `${item.label}${item.subtitle ? `（${item.subtitle}）` : ''}`,
    })
  }

  return {
    version: 1,
    shot: {
      ...(input.shotId ? { id: input.shotId } : {}),
      no: String(input.shotNo || ''),
      duration: Number(input.duration) || 0,
      aspect: String(input.aspect || ''),
    },
    attachments,
  }
}

export function manifestCounts(manifest: ContextManifest): ManifestCounts {
  const counts: ManifestCounts = { image: 0, video: 0, text: 0 }
  for (const a of manifest.attachments) {
    if (a.kind === 'image') counts.image += 1
    else if (a.kind === 'video') counts.video += 1
    else counts.text += 1
  }
  return counts
}

export function manifestSummary(manifest: ContextManifest): ManifestSummary {
  return {
    attachmentKeys: manifest.attachments.map((a) => a.key),
    counts: manifestCounts(manifest),
    metadata: manifest.shot,
  }
}

export type ManifestAssetMeta = { width?: number; height?: number }

/**
 * 代码模型看到的文本投影：镜头头只有镜号/时长/画幅，其余全部来自附件。
 * briefs 以附件 key 为键；includeBrief=false 的附件不拼 brief。
 * assetMeta 只补尺寸，不改变附件是否出现。
 */
export function manifestText(
  manifest: ContextManifest,
  briefs: Record<string, string> = {},
  maxChars = 12000,
  assetMeta: Record<string, ManifestAssetMeta> = {},
): string {
  const lines: string[] = []
  lines.push(
    `【镜头】${manifest.shot.no || '未编号'}｜${manifest.shot.duration.toFixed(1)}s｜${manifest.shot.aspect}`,
  )

  const texts = manifest.attachments.filter(
    (a): a is Extract<ManifestAttachment, { kind: 'text' }> => a.kind === 'text',
  )
  if (texts.length) {
    lines.push('【文本附件】')
    for (const a of texts) lines.push(`- ${a.label}：${a.text}`)
  }

  const assets = manifest.attachments.filter((a) => a.kind !== 'text')
  if (assets.length) {
    lines.push('【素材附件】')
    for (const a of assets) {
      if (a.kind === 'image') {
        const meta = assetMeta[a.key]
        const size = meta?.width && meta?.height ? `｜${meta.width}x${meta.height}` : ''
        lines.push(`- key=${a.key}｜${a.label}｜image｜${a.source}${size}`)
      } else {
        const frames = a.frameTimes.length
          ? `｜关键帧 ${a.frameTimes.map((t) => `${t.toFixed(2)}s`).join('/')}`
          : ''
        lines.push(
          `- key=${a.key}｜${a.label}｜video${a.duration ? `｜${a.duration.toFixed(2)}s` : ''}${frames}`,
        )
      }
      const brief = a.includeBrief ? briefs[a.key] : ''
      if (brief) lines.push(`  brief：${brief}`)
    }
  }

  return lines.join('\n').slice(0, maxChars)
}
