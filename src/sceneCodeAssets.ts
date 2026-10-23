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

export type PreparedSceneAsset = {
  payload: {
    key: string
    kind: 'image' | 'video-frame'
    label: string
    mime: string
    bytes: ArrayBuffer
    width: number
    height: number
    videoDuration?: number
    frameTime?: number
  }
  ref: SceneCodeAssetRef
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

function mimeFromBlob(blob: Blob, url: string): string {
  if (blob.type) return blob.type
  const ext = String(url).split('?')[0].toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/jpeg'
}

async function normalizeImage(
  original: Blob,
  url: string,
  maxEdge: number,
): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const mime = mimeFromBlob(original, url)
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(original)
  } catch {
    return { blob: original, mime, width: 0, height: 0 }
  }
  const width = bitmap.width
  const height = bitmap.height
  const scale = Math.min(1, maxEdge / Math.max(width, height || 1))
  if (scale >= 0.999 || typeof document === 'undefined') {
    bitmap.close?.()
    return { blob: original, mime, width, height }
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    return { blob: original, mime, width, height }
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const type = mime === 'image/png' || mime === 'image/webp' ? 'image/png' : 'image/jpeg'
  const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
  if (!resized) return { blob: original, mime, width, height }
  return { blob: resized, mime: resized.type || type, width: canvas.width, height: canvas.height }
}

async function loadOne(input: SceneAssetInput): Promise<PreparedSceneAsset> {
  const url = absoluteLocal(input.url)
  if (!url) throw new SceneCodeAssetError('external-url', `素材「${input.label}」不是项目内地址，已拒绝`)
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const original = await res.blob()
  if (!original.size) throw new Error('空文件')
  const normalized =
    input.kind === 'video-frame'
      ? { blob: original, mime: mimeFromBlob(original, url), width: 0, height: 0 }
      : await normalizeImage(original, url, SCENE_CODE_LIMITS.imageEdge)
  const bytes = await normalized.blob.arrayBuffer()
  const contentHash = await assetContentHash(bytes)
  const key = input.key || stableAssetKey(input.source, input.videoUrl || url)
  return {
    payload: {
      key,
      kind: input.kind,
      label: input.label,
      mime: normalized.mime,
      bytes,
      width: normalized.width,
      height: normalized.height,
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
      ...(normalized.width ? { width: normalized.width } : {}),
      ...(normalized.height ? { height: normalized.height } : {}),
      ...(input.videoDuration != null ? { videoDuration: input.videoDuration } : {}),
      ...(input.frameTime != null ? { frameTime: input.frameTime } : {}),
    },
  }
}

/**
 * 把选择解析成真实的图片/关键帧字节。
 * 同一 URL 只加载一次；图片超限抛错，不静默截断。
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
      totalBytes += one.payload.bytes.byteLength
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
