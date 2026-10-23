import type { AppSettings } from './api'
import { askVideoVision } from './api'
import type { Shot3DContext } from './types'
import { SCENE_CODE_LIMITS } from './types'
import { stageModelKey, type StagePick } from './ModelSelect'
import {
  allCatalogItems,
  itemIsSelected,
  type Shot3DContextCatalog,
} from './shot3dContextCatalog'
import { contextFingerprint } from './shot3dContext'
import { prepareSceneAssets, type PreparedSceneAsset } from './sceneCodeAssets'
import { videoFrameInputs } from './videoFrames'
import { buildMediaBrief, type MediaBrief } from './mediaBrief'

export type PreparedCodeContext = {
  context: Shot3DContext
  contextFp: string
  assets: PreparedSceneAsset[]
  missing: { key: string; label: string; url: string; reason: string }[]
  warnings: string[]
  mediaBrief: MediaBrief
  videoBrief?: string
  usedVideoVision: boolean
  imageCount: number
  videoCount: number
}

export function selectedImageInputs(catalog: Shot3DContextCatalog, context: Shot3DContext) {
  const seen = new Set<string>()
  const out: {
    key: string
    source: 'character' | 'design' | 'asset' | 'image'
    kind: 'image'
    label: string
    url: string
  }[] = []
  for (const item of allCatalogItems(catalog)) {
    if (!item.url || item.category === 'video') continue
    if (!itemIsSelected(context, item) || seen.has(item.url)) continue
    seen.add(item.url)
    const source =
      item.category === 'character'
        ? 'character'
        : item.category === 'scene' || item.category === 'prop'
          ? 'design'
          : item.category === 'asset'
            ? 'asset'
            : 'image'
    out.push({ key: item.key, source, kind: 'image', label: item.label, url: item.url })
  }
  return out
}

export async function prepareSceneCodeContext(input: {
  context: Shot3DContext
  catalog: Shot3DContextCatalog
  settings: AppSettings | null
  stagePick?: StagePick
  signal?: AbortSignal
  withBrief?: boolean
  allowVideoVision?: boolean
}): Promise<PreparedCodeContext> {
  const images = selectedImageInputs(input.catalog, input.context)
  const videos = input.catalog.videos.filter((v) => v.url && input.context.videoUrls.includes(v.url))
  const video = await videoFrameInputs(
    videos.map((v) => ({ url: v.url!, label: v.label, videoDuration: v.videoDuration })),
    SCENE_CODE_LIMITS.videoFrames,
  )
  if (input.signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const prepared = await prepareSceneAssets([...images, ...video.inputs])
  if (input.signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const brief =
    input.withBrief === false
      ? { brief: { version: 1 as const, usedVision: false, items: [], fingerprint: '' }, warnings: [] as string[] }
      : await buildMediaBrief({
          assets: prepared.assets,
          settings: input.settings,
          stagePick: input.stagePick,
          signal: input.signal,
        })
  let videoBrief: string | undefined
  let usedVideoVision = false
  if (input.allowVideoVision && videos.length) {
    const videoKey = stageModelKey(input.settings, 'videoVision', input.stagePick)
    if (videoKey) {
      try {
        const r = await askVideoVision({
          system: '你是视频场记。只描述视频里真实看到的运动、机位、节奏、光线和空间关系；不要编造。',
          prompt: `请描述参考视频，供 Three.js 代码的运镜和空间设计使用。视频标签：${videos[0].label}`,
          video: String(videos[0].url || ''),
          modelKey: videoKey,
          signal: input.signal,
          maxTokens: 1800,
        })
        if (r.text.trim()) {
          videoBrief = r.text.trim().slice(0, 6000)
          usedVideoVision = true
        }
      } catch (e) {
        brief.warnings.push(`视频理解回退关键帧：${(e as Error).message}`)
      }
    }
  }
  return {
    context: input.context,
    contextFp: contextFingerprint(input.context),
    assets: prepared.assets,
    missing: prepared.missing,
    warnings: [...video.warnings, ...brief.warnings],
    mediaBrief: brief.brief,
    ...(videoBrief ? { videoBrief } : {}),
    usedVideoVision,
    imageCount: prepared.imageCount,
    videoCount: prepared.videoCount,
  }
}
