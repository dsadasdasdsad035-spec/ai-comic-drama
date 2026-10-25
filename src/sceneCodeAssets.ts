import type { SceneCodeAssetRef } from './types'
import { SCENE_CODE_LIMITS } from './types'
import { assetContentHash, stableAssetKey } from './sceneCodeFingerprint'

export type SceneAssetInput = {
  key: string
  source: SceneCodeAssetRef['source']
  kind: 'image' | 'video-frame'
  label: string
  url: string
  videoUrl?: string
  videoDuration?: number
  frameTime?: number
}

/**
 * 交给渲染宿主的素材清单：只给站内 URL 与元数据。
 * 宿主负责把它复制进一次性工作目录并做尺寸约束，浏览器不再传字节。
 */
export type PreparedSceneAsset = {
  payload: {
    key: string
    kind: 'image' | 'video-frame'
    label: string
    url: string
    width: number
    height: number
    videoDuration?: number
    frameTime?: number
  }
  ref: SceneCodeAssetRef
  /** 原始文件字节数；只用于总量限制，不发送给宿主 */
  bytes: number
}

export type PreparedSceneAssets = {
  assets: PreparedSceneAsset[]
  missing: { key: string; label: string; url: string; reason: string }[]
  imageCount: number
  videoCount: number
  totalBytes: number
}

export class SceneCodeAssetError extends Error {
  code: 'too-many-images' | 'too-many-videos' | 'too-large' | 'external-url'
  constructor(code: SceneCodeAssetError['code'], message: string) {
    super(message)
    this.name = 'SceneCodeAssetError'
    this.code = code
  }
}

function absoluteLocal(url: string): string | null {
  const raw = String(url || '').trim()
  if (!raw || raw.startsWith('data:')) return null
  try {
    const parsed = new URL(raw, typeof location !== 'undefined' ? location.origin : 'http://localhost')
    if (typeof location !== 'undefined' && parsed.origin !== location.origin) return null
    return parsed.href
  } catch {
    return null
  }
}

async function measureImage(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  } catch {
    return { width: 0, height: 0 }
  }
}

async function loadOne(input: SceneAssetInput): Promise<PreparedSceneAsset> {
  const url = absoluteLocal(input.url)
  if (!url) throw new SceneCodeAssetError('external-url', `素材「${input.label}」不是项目内地址，已拒绝`)
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  if (!blob.size) throw new Error('空文件')
  // 仍然要读一遍内容：指纹靠内容哈希判断「同 URL 换了文件」。
  const bytes = await blob.arrayBuffer()
  const contentHash = await assetContentHash(bytes)
  const size =
    input.kind === 'video-frame' ? { width: 0, height: 0 } : await measureImage(blob)
  if (size.width > SCENE_CODE_LIMITS.imageEdge || size.height > SCENE_CODE_LIMITS.imageEdge) {
    // 尺寸上限由宿主在落盘时缩放，这里只提示，不阻塞。
    console.warn(`素材「${input.label}」超过 ${SCENE_CODE_LIMITS.imageEdge}px，渲染时会缩放`)
  }
  const key = input.key || stableAssetKey(input.source, input.videoUrl || url)
  return {
    payload: {
      key,
      kind: input.kind,
      label: input.label,
      url: input.url,
      width: size.width,
      height: size.height,
      ...(input.videoDuration != null ? { videoDuration: input.videoDuration } : {}),
      ...(input.frameTime != null ? { frameTime: input.frameTime } : {}),
    },
    ref: {
      key,
      url: input.url,
      kind: input.kind,
      source: input.source,
      label: input.label,
      contentHash,
      ...(size.width ? { width: size.width } : {}),
      ...(size.height ? { height: size.height } : {}),
      ...(input.videoDuration != null ? { videoDuration: input.videoDuration } : {}),
      ...(input.frameTime != null ? { frameTime: input.frameTime } : {}),
    },
    bytes: blob.size,
  }
}

/**
 * 把选择解析成素材清单（URL + 元数据 + 内容哈希）。
 * 同一 URL 只加载一次；图片数量和总大小超限直接抛错，不静默截断。
 */
export async function prepareSceneAssets(inputs: SceneAssetInput[]): Promise<PreparedSceneAssets> {
  const unique = new Map<string, SceneAssetInput>()
  for (const input of inputs) {
    const url = String(input.url || '').trim()
    if (!url) continue
    if (!unique.has(url)) unique.set(url, input)
  }
  const images = [...unique.values()].filter((x) => x.kind !== 'video-frame')
  const videos = new Map<string, SceneAssetInput>()
  for (const input of unique.values()) {
    if (input.kind !== 'video-frame') continue
    const id = input.videoUrl || input.url
    if (!videos.has(id)) videos.set(id, input)
  }
  if (images.length > SCENE_CODE_LIMITS.images) {
    throw new SceneCodeAssetError('too-many-images', `最多选择 ${SCENE_CODE_LIMITS.images} 张图片`)
  }
  if (videos.size > SCENE_CODE_LIMITS.videos) {
    throw new SceneCodeAssetError('too-many-videos', `最多选择 ${SCENE_CODE_LIMITS.videos} 个视频`)
  }
  const missing: PreparedSceneAssets['missing'] = []
  const assets: PreparedSceneAsset[] = []
  let totalBytes = 0
  for (const input of unique.values()) {
    try {
      const one = await loadOne(input)
      totalBytes += one.bytes
      if (totalBytes > SCENE_CODE_LIMITS.totalAssetBytes) {
        throw new SceneCodeAssetError(
          'too-large',
          `素材总大小超过 ${Math.round(SCENE_CODE_LIMITS.totalAssetBytes / 1024 / 1024)}MB`,
        )
      }
      assets.push(one)
    } catch (e) {
      if (e instanceof SceneCodeAssetError && e.code !== 'external-url') throw e
      missing.push({
        key: input.key,
        label: input.label,
        url: input.url,
        reason: (e as Error).message || '读取失败',
      })
    }
  }
  return {
    assets,
    missing,
    imageCount: images.length,
    videoCount: videos.size,
    totalBytes,
  }
}
