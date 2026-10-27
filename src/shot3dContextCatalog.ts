import type { MediaBundle, ProjectAsset, ProjectData, ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import type { Shot3DContext } from './types'
import type { ShotData } from './types'
import { assetMediaType } from './mediaPick'
import { dialogueHashOf, parseDialogueLines } from './shot3dContext'
import { stableAssetKey } from './sceneCodeFingerprint'
import { linkedAssetsFor, sceneDesignFor } from './scheduleContext'
import { marksSummary } from './scheduleContext'

export type Shot3DContextCategory = 'character' | 'asset' | 'scene' | 'prop' | 'image' | 'video'
export type Shot3DItemKind = Shot3DContextCategory | 'scene-text'

export type Shot3DContextItem = {
  key: string
  category: Shot3DContextCategory
  kind: Shot3DItemKind
  label: string
  subtitle?: string
  url?: string
  /** 视频首选首帧；没有时选择器用 video 元素 */
  poster?: string
  sourceId?: string
  designId?: string
  videoDuration?: number
  missing?: boolean
  /** 场次文本所属集数；设计卡等项目级条目不填 */
  episode?: number
}

export type Shot3DTextCatalog = {
  prompt?: string
  videoPrompt?: string
  dialogue: { index: number; speaker: string; text: string }[]
  cast: string[]
  sizeMove?: string
  marks?: string
}

export type Shot3DContextCatalog = {
  characters: Shot3DContextItem[]
  assets: Shot3DContextItem[]
  scenes: Shot3DContextItem[]
  props: Shot3DContextItem[]
  images: Shot3DContextItem[]
  videos: Shot3DContextItem[]
  text: Shot3DTextCatalog
  defaults: Shot3DContext
}

export type BuildShot3DContextCatalogInput = {
  project?: ProjectData | null
  characters: CharacterSheet[]
  shot: ShotData | ProjectShot
  media?: MediaBundle | null
  nodes?: { id: string; data?: object }[]
  /** 当前镜头的 scene slug / no，用于默认场景卡 */
  sceneSlug?: string
  sceneNo?: number
}

const currentImageOf = (shot: ShotData | ProjectShot): string | undefined => {
  const s = shot as ShotData
  if (s.refImage) return s.refImage
  const candidates = Array.isArray(s.candidates) ? s.candidates : []
  if (!candidates.length) return undefined
  return candidates[Math.max(0, Math.min(candidates.length - 1, Number(s.activeIdx) || 0))]
}

const designImageOf = (d: { image?: string; candidates?: string[]; activeIdx?: number }): string | undefined => {
  if (d.image) return d.image
  const candidates = d.candidates ?? []
  if (!candidates.length) return undefined
  return candidates[Math.max(0, Math.min(candidates.length - 1, Number(d.activeIdx) || 0))]
}

const sceneKeyOf = (episode: number, sceneNo: number) =>
  `E${String(episode || 1).padStart(2, '0')}-SC${String(Math.max(1, sceneNo || 1)).padStart(2, '0')}`

const rosterOf = (cast?: string[], dialogue?: unknown): string[] => {
  const speakers = parseDialogueLines(dialogue).map((x) => x.speaker).filter(Boolean)
  return [...new Set([...(cast ?? []), ...speakers].map((x) => String(x).trim()).filter(Boolean))]
}

function imageKey(url: string, source: 'image' | 'asset') {
  return stableAssetKey(source, url)
}

/**
 * 汇总项目级可选项。图片按 URL 去重，优先级：当前帧 > 角色 > 设定卡 > 素材 > 项目生成图。
 * 文本项不在这里拼成字符串，保留结构让选择器逐句展示。
 */
export function buildShot3DContextCatalog(input: BuildShot3DContextCatalogInput): Shot3DContextCatalog {
  const project = input.project
  const shot = input.shot as ShotData
  const episodeNo = Number((shot as ShotData).episode) || 1
  const sceneNo = Math.max(1, Number(input.sceneNo ?? (shot as ShotData).sceneNo) || 1)
  const sceneSlug = input.sceneSlug || (shot as ShotData).sceneSlug || ''
  const episode = (project?.episodes ?? []).find((e) => Number(e.no) === episodeNo)
  const designs = project?.designs ?? []
  const assets = project?.assets ?? []
  const linked = linkedAssetsFor(assets, shot, input.nodes)
  const sceneDesign = sceneDesignFor({
    designs,
    scene: { slug: sceneSlug, place: episode?.scenes?.find((s) => Number(s.no) === sceneNo)?.place },
  })
  const roster = rosterOf(shot.cast, shot.dialogue)

  const imageByUrl = new Map<string, { item: Shot3DContextItem; priority: number }>()
  const addImage = (item: Shot3DContextItem, priority: number) => {
    if (!item.url) return
    const old = imageByUrl.get(item.url)
    if (old && old.priority >= priority) return
    imageByUrl.set(item.url, { item, priority })
  }

  const characters: Shot3DContextItem[] = input.characters
    .map((c) => ({
      key: stableAssetKey('character', c.id || c.name),
      category: 'character' as const,
      kind: 'character' as const,
      label: c.name,
      subtitle: c.role || c.lookCn || '',
      ...(c.image ? { url: c.image } : {}),
      sourceId: c.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  for (const c of characters) addImage(c, 80)

  const designItems: Shot3DContextItem[] = designs.map((d) => {
    const image = designImageOf(d)
    return {
      key: stableAssetKey('design', d.id),
      category: d.kind === 'scene' ? 'scene' : 'prop',
      kind: d.kind === 'scene' ? 'scene' : 'prop',
      label: d.name,
      subtitle: d.summaryCn || d.promptEn || '',
      ...(image ? { url: image } : {}),
      sourceId: d.id,
      designId: d.id,
      missing: !image,
    }
  })
  for (const d of designItems) if (d.url) addImage(d, 70)

  const sceneMetaItems: Shot3DContextItem[] = []
  for (const ep of project?.episodes ?? []) {
    const epNo = Number(ep.no) || 1
    for (const s of ep.scenes ?? []) {
      const no = Number(s.no) || sceneMetaItems.length + 1
      sceneMetaItems.push({
        key: `scene:${sceneKeyOf(epNo, no)}`,
        category: 'scene',
        kind: 'scene-text',
        label: `E${String(epNo).padStart(2, '0')} · SC${String(no).padStart(2, '0')} · ${s.slug || s.place || '未命名场次'}`,
        subtitle: [s.place, s.time, s.characters?.join('、')].filter(Boolean).join(' · '),
        episode: epNo,
      })
    }
  }
  if (!sceneMetaItems.some((x) => x.key === `scene:${sceneKeyOf(episodeNo, sceneNo)}`)) {
    sceneMetaItems.push({
      key: `scene:${sceneKeyOf(episodeNo, sceneNo)}`,
      category: 'scene',
      kind: 'scene-text',
      label: `SC${String(sceneNo).padStart(2, '0')} · ${sceneSlug || '当前场次'}`,
      subtitle: '当前镜头所属场次',
      episode: episodeNo,
    })
  }

  const manualAssets: Shot3DContextItem[] = assets
    .filter((a) => Boolean(a.url) && assetMediaType((a.kind || 'image') as never, String(a.url)) === 'image')
    .filter((a) => !(a.designId && designs.some((d) => d.id === a.designId)))
    .map((a: ProjectAsset) => ({
      key: imageKey(a.url, 'asset'),
      category: 'asset',
      kind: 'asset',
      label: a.title || a.url.split('/').pop() || '素材',
      subtitle: [a.kind, a.note].filter(Boolean).join(' · '),
      url: a.url,
      ...(a.designId ? { designId: a.designId } : {}),
    }))
  for (const a of manualAssets) addImage(a, 60)

  const shotImages: Shot3DContextItem[] = []
  const current = currentImageOf(shot)
  if (current) {
    shotImages.push({
      key: imageKey(current, 'image'),
      category: 'image',
      kind: 'image',
      label: '本镜首帧',
      subtitle: '当前构图',
      url: current,
    })
  }
  for (const [i, url] of (Array.isArray(shot.candidates) ? shot.candidates : []).entries()) {
    if (!url || url === current) continue
    shotImages.push({
      key: imageKey(url, 'image'),
      category: 'image',
      kind: 'image',
      label: `本镜候选 ${i + 1}`,
      subtitle: '分镜候选图',
      url,
    })
  }
  for (const img of input.media?.images ?? []) {
    if (!img.url) continue
    shotImages.push({
      key: imageKey(img.url, 'image'),
      category: 'image',
      kind: 'image',
      label: img.name || img.url.split('/').pop() || '生成图片',
      subtitle: '项目生成图片',
      url: img.url,
    })
  }
  for (const [i, img] of shotImages.entries()) addImage(img, i === 0 ? 100 : 50)

  const images = [...imageByUrl.values()]
    .sort((a, b) => b.priority - a.priority)
    .map((x) => x.item)
    .filter((x) => x.category === 'image' || x.category === 'asset' || x.category === 'character' || x.category === 'scene' || x.category === 'prop')
  // images 只保留图片类资源；角色/设定卡仍在各自分类里，避免选择器重复。
  const imageOnly = images.filter((x) => x.category === 'image' || x.category === 'asset')
  const characterItems = characters.map((c) => (c.url ? { ...c, missing: !c.url } : { ...c, missing: true }))
  const propItems = designItems.filter((x) => x.category === 'prop')
  const sceneDesignItems = designItems.filter((x) => x.category === 'scene')

  const videos: Shot3DContextItem[] = []
  const seenVideo = new Set<string>()
  const addVideo = (url: string | undefined, label: string, subtitle: string, duration?: number) => {
    if (!url || seenVideo.has(url)) return
    seenVideo.add(url)
    videos.push({
      key: stableAssetKey('video', url),
      category: 'video',
      kind: 'video',
      label,
      subtitle,
      url,
      ...(duration != null ? { videoDuration: duration } : {}),
    })
  }
  addVideo((shot as ShotData).videoUrl, '本镜成片', '当前镜头视频')
  for (const v of input.media?.videos ?? []) addVideo(v.url, v.name || v.url.split('/').pop() || '视频', '项目视频')

  const dialogue = parseDialogueLines(shot.dialogue)
  const text: Shot3DTextCatalog = {
    ...(shot.prompt ? { prompt: shot.prompt } : {}),
    ...(shot.videoPrompt ? { videoPrompt: shot.videoPrompt } : {}),
    dialogue,
    cast: roster,
    sizeMove: [shot.size, shot.move, shot.seconds != null ? `${Number(shot.seconds).toFixed(1)}s` : '']
      .filter(Boolean)
      .join(' · '),
    marks: shot.marks?.length ? marksSummary(shot.marks) : '',
  }

  const defaultDesignIds = new Set<string>()
  if (sceneDesign?.id) defaultDesignIds.add(sceneDesign.id)
  for (const a of linked) if (a.designId) defaultDesignIds.add(a.designId)
  const shotNo = String(shot.no || '')
  for (const d of designs) {
    if (d.kind !== 'prop') continue
    if (shotNo && (d.refs ?? []).includes(shotNo)) defaultDesignIds.add(d.id)
  }
  const defaultAssetUrls = linked.filter((a) => !a.designId && a.url).map((a) => a.url).filter((u): u is string => Boolean(u))
  const defaultImages = [current, ...((Array.isArray(shot.candidates) ? shot.candidates : []).slice(0, 4))]
    .filter((u): u is string => Boolean(u))
    .filter((u, i, arr) => arr.indexOf(u) === i)
  const defaultRoster = (Array.isArray(shot.cast) && shot.cast.length ? shot.cast : roster)
  const defaultCharacters = defaultRoster
    .map((name) => input.characters.find((c) => c.name === name))
    .filter((c): c is CharacterSheet => Boolean(c?.id))
    .map((c) => c.id)

  const defaults = {
    version: 1 as const,
    characterIds: [...new Set(defaultCharacters)],
    designIds: [...defaultDesignIds],
    assetUrls: defaultAssetUrls,
    imageUrls: defaultImages,
    videoUrls: [],
    sceneKeys: [sceneKeyOf(episodeNo, sceneNo)],
    text: {
      prompt: Boolean(shot.prompt),
      videoPrompt: Boolean(shot.videoPrompt),
      dialogue: 'all' as const,
      cast: roster.length > 0,
      marks: Boolean(shot.marks?.length),
      sizeMove: true,
    },
    dialogueHash: dialogueHashOf(shot.dialogue),
    updatedAt: new Date().toISOString(),
  }

  return {
    characters: characterItems,
    assets: manualAssets,
    scenes: [...sceneDesignItems, ...sceneMetaItems],
    props: propItems,
    images: imageOnly,
    videos,
    text,
    defaults,
  }
}

export function allCatalogItems(catalog: Shot3DContextCatalog): Shot3DContextItem[] {
  return [
    ...catalog.characters,
    ...catalog.assets,
    ...catalog.scenes,
    ...catalog.props,
    ...catalog.images,
    ...catalog.videos,
  ]
}

/** 选择里存在、但项目资源已经删除的项，给 UI 显示缺失占位。 */
export function missingSelectionItems(catalog: Shot3DContextCatalog, ctx: Shot3DContext): Shot3DContextItem[] {
  const byKey = new Map(allCatalogItems(catalog).map((x) => [x.key, x]))
  const out: Shot3DContextItem[] = []
  const add = (key: string, category: Shot3DContextCategory, extra: Partial<Shot3DContextItem> = {}) => {
    if (byKey.has(key)) return
    out.push({
      key,
      category,
      kind: category,
      label: `已删除：${key}`,
      subtitle: '资源不在当前项目中',
      missing: true,
      ...extra,
    })
  }
  for (const id of ctx.characterIds) add(stableAssetKey('character', id), 'character', { sourceId: id })
  for (const id of ctx.designIds) add(stableAssetKey('design', id), 'prop', { sourceId: id })
  for (const url of ctx.assetUrls) add(imageKey(url, 'asset'), 'asset', { url })
  for (const url of ctx.imageUrls) add(imageKey(url, 'image'), 'image', { url })
  for (const url of ctx.videoUrls) add(stableAssetKey('video', url), 'video', { url })
  for (const key of ctx.sceneKeys) {
    const full = `scene:${key}`
    if (!byKey.has(full)) out.push({ key: full, category: 'scene', kind: 'scene-text', label: `已删除场次：${key}`, subtitle: '场次不在当前项目中', missing: true })
  }
  return out
}

export function itemIsSelected(ctx: Shot3DContext, item: Shot3DContextItem): boolean {
  if (item.category === 'character') return ctx.characterIds.includes(item.sourceId || item.key.replace(/^character:/, ''))
  if (item.category === 'scene' || item.category === 'prop') {
    if (item.kind === 'scene-text') return ctx.sceneKeys.includes(item.key.replace(/^scene:/, ''))
    return ctx.designIds.includes(item.sourceId || item.key.replace(/^design:/, ''))
  }
  if (item.category === 'asset') return Boolean(item.url && ctx.assetUrls.includes(item.url))
  if (item.category === 'image') return Boolean(item.url && ctx.imageUrls.includes(item.url))
  if (item.category === 'video') return Boolean(item.url && ctx.videoUrls.includes(item.url))
  return false
}

/** 只返回可转成代码素材的选择；场次元数据只进入文本上下文。 */
export function selectedImageItems(catalog: Shot3DContextCatalog, ctx: Shot3DContext): Shot3DContextItem[] {
  return allCatalogItems(catalog).filter((item) => item.url && item.category !== 'video' && itemIsSelected(ctx, item))
}

export function selectedVideoItems(catalog: Shot3DContextCatalog, ctx: Shot3DContext): Shot3DContextItem[] {
  return catalog.videos.filter((item) => item.url && ctx.videoUrls.includes(item.url))
}

export function selectedSceneTextItems(catalog: Shot3DContextCatalog, ctx: Shot3DContext): Shot3DContextItem[] {
  return catalog.scenes.filter((item) => item.kind === 'scene-text' && itemIsSelected(ctx, item))
}

export type ContextTextKey = 'prompt' | 'videoPrompt' | 'cast' | 'marks' | 'sizeMove'

export function toggleContextItem(ctx: Shot3DContext, item: Shot3DContextItem): Shot3DContext {
  const next: Shot3DContext = {
    ...ctx,
    characterIds: [...ctx.characterIds],
    designIds: [...ctx.designIds],
    assetUrls: [...ctx.assetUrls],
    imageUrls: [...ctx.imageUrls],
    videoUrls: [...ctx.videoUrls],
    sceneKeys: [...ctx.sceneKeys],
    text: { ...ctx.text, dialogue: Array.isArray(ctx.text.dialogue) ? [...ctx.text.dialogue] : ctx.text.dialogue },
    updatedAt: new Date().toISOString(),
  }
  const toggle = (arr: string[], value: string) => {
    const i = arr.indexOf(value)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(value)
  }
  if (item.category === 'character') {
    toggle(next.characterIds, item.sourceId || item.key.replace(/^character:/, ''))
  } else if (item.category === 'scene' || item.category === 'prop') {
    if (item.kind === 'scene-text') toggle(next.sceneKeys, item.key.replace(/^scene:/, ''))
    else toggle(next.designIds, item.sourceId || item.key.replace(/^design:/, ''))
  } else if (item.category === 'asset' && item.url) {
    toggle(next.assetUrls, item.url)
  } else if (item.category === 'image' && item.url) {
    toggle(next.imageUrls, item.url)
  } else if (item.category === 'video' && item.url) {
    toggle(next.videoUrls, item.url)
  }
  return next
}

export function toggleContextText(ctx: Shot3DContext, key: ContextTextKey): Shot3DContext {
  return {
    ...ctx,
    text: { ...ctx.text, [key]: !ctx.text[key] },
    updatedAt: new Date().toISOString(),
  }
}

export function setDialogueSelection(ctx: Shot3DContext, value: 'all' | number[]): Shot3DContext {
  return {
    ...ctx,
    text: { ...ctx.text, dialogue: value },
    updatedAt: new Date().toISOString(),
  }
}

export function toggleDialogueLine(ctx: Shot3DContext, index: number, total: number): Shot3DContext {
  const current = ctx.text.dialogue === 'all' ? Array.from({ length: total }, (_, i) => i) : [...ctx.text.dialogue]
  const i = current.indexOf(index)
  if (i >= 0) current.splice(i, 1)
  else current.push(index)
  current.sort((a, b) => a - b)
  return setDialogueSelection(ctx, current.length === total ? 'all' : current)
}

/** 选择中实际会进入渲染的图片 URL 去重计数。 */
export function selectedImageCount(ctx: Shot3DContext, catalog?: Shot3DContextCatalog): number {
  const urls = new Set<string>([...ctx.imageUrls, ...ctx.assetUrls])
  if (catalog) {
    for (const item of allCatalogItems(catalog)) {
      if (!item.url || item.category === 'video') continue
      if (itemIsSelected(ctx, item)) urls.add(item.url)
    }
  }
  return urls.size
}

export function setContextCategory(
  ctx: Shot3DContext,
  catalog: Shot3DContextCatalog,
  category: Shot3DContextCategory,
  on: boolean,
): Shot3DContext {
  let next = ctx
  const items =
    category === 'character'
      ? catalog.characters
      : category === 'asset'
        ? catalog.assets
        : category === 'scene'
          ? catalog.scenes
          : category === 'prop'
            ? catalog.props
            : category === 'image'
              ? catalog.images
              : category === 'video'
                ? catalog.videos
                : []
  for (const item of items) {
    if (itemIsSelected(next, item) !== on) next = toggleContextItem(next, item)
  }
  return { ...next, updatedAt: new Date().toISOString() }
}
