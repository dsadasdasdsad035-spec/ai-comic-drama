import { extractFrames } from './api'
import type { SceneAssetInput } from './sceneCodeAssets'
import { stableAssetKey } from './sceneCodeFingerprint'
import { SCENE_CODE_LIMITS } from './types'

export type VideoFrameSet = {
  url: string
  duration: number
  frames: string[]
  warning?: string
}

const cache = new Map<string, Promise<VideoFrameSet>>()

/** 视频只抽关键帧，供媒体 brief / 代码素材 / 聊天使用；聊天不调用视频理解模型。 */
export function ensureVideoFrames(url: string, count = SCENE_CODE_LIMITS.videoFrames): Promise<VideoFrameSet> {
  const key = `${url}|${count}`
  const old = cache.get(key)
  if (old) return old
  const task = (async () => {
    try {
      const out = await extractFrames(url, count)
      return { url, duration: out.duration, frames: out.urls.slice(0, count) }
    } catch (e) {
      return { url, duration: 0, frames: [], warning: (e as Error).message || '视频抽帧失败' }
    }
  })()
  cache.set(key, task)
  return task
}

export async function videoFrameInputs(
  videos: { url: string; label: string; videoDuration?: number }[],
  count = SCENE_CODE_LIMITS.videoFrames,
): Promise<{ inputs: SceneAssetInput[]; warnings: string[] }> {
  const inputs: SceneAssetInput[] = []
  const warnings: string[] = []
  for (const video of videos.slice(0, SCENE_CODE_LIMITS.videos)) {
    const set = await ensureVideoFrames(video.url, count)
    if (set.warning) warnings.push(`${video.label}：${set.warning}`)
    const duration = video.videoDuration || set.duration
    set.frames.forEach((frame, i) => {
      inputs.push({
        key: `${stableAssetKey('video', video.url)}:frame:${i}`,
        source: 'video',
        kind: 'video-frame',
        label: `${video.label} · 帧 ${i + 1}`,
        url: frame,
        videoUrl: video.url,
        videoDuration: duration || undefined,
        frameTime: duration > 0 ? (duration * i) / Math.max(1, set.frames.length - 1) : undefined,
      })
    })
  }
  return { inputs, warnings }
}

export function clearVideoFrameCache(url?: string) {
  if (!url) {
    cache.clear()
    return
  }
  for (const key of [...cache.keys()]) if (key.startsWith(`${url}|`)) cache.delete(key)
}
