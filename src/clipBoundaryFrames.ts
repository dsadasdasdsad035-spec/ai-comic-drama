import { extractFrames } from './api'

/** 缓存里存原始 YAVG（不是布尔），阈值调整后不会命中旧判定 */
const frameCache = new Map<string, { start?: string; end?: string; startYavg?: number; endYavg?: number }>()

/**
 * 尾帧用负时间表示「距片尾秒数」（/api/frames → ffmpeg -sseof）。
 * 注意它只是解码窗口起点：服务端用 `-update 1` 解码到片尾，落盘的才是真末帧。
 */
export const TAIL_FRAME_SSEOF_SEC = -0.1

/** 近黑阈值，与服务端 `/api/frames` 的判黑阈值保持一致（约占 7% 亮度） */
export const DARK_FRAME_YAVG = 18

export type ClipFrameRole = 'head' | 'tail'

export type ClipBoundaryFrames = {
  start?: string
  end?: string
  startYavg?: number
  endYavg?: number
}

/** 视频首帧/尾帧；同一 URL 只抽一次；只缓存首尾都成功的结果，避免尾帧失败后永久回退静帧。 */
export async function clipBoundaryFrames(url: string): Promise<ClipBoundaryFrames> {
  const hit = frameCache.get(url)
  if (hit?.start && hit?.end) return hit
  try {
    const first = await extractFrames(url, 2, undefined, [0])
    const startYavg = first.stats?.[0]?.yavg
    let end: string | undefined
    let endYavg: number | undefined
    try {
      const last = await extractFrames(url, 2, undefined, [TAIL_FRAME_SSEOF_SEC])
      end = last.urls[0]
      endYavg = last.stats?.[0]?.yavg
    } catch {
      end = undefined
    }
    const out = {
      start: first.urls[0],
      end,
      ...(startYavg === undefined ? {} : { startYavg }),
      ...(endYavg === undefined ? {} : { endYavg }),
    }
    if (out.start && out.end) frameCache.set(url, out)
    return out
  } catch {
    return {}
  }
}

export function darkFrameNotice(role: ClipFrameRole, yavg: number | undefined): string | undefined {
  if (yavg === undefined || yavg >= DARK_FRAME_YAVG) return undefined
  return role === 'head' ? '成片首帧接近黑场，连续性参考有限' : '成片尾帧接近黑场，连续性参考有限'
}

/** 从成片抽单帧；失败返回可读错误。 */
export async function extractSingleClipFrame(
  videoUrl: string,
  role: ClipFrameRole,
): Promise<{ url: string; yavg?: number; notice?: string } | { error: string }> {
  const url = String(videoUrl || '').trim()
  if (!url) return { error: '还没有成片' }
  try {
    if (role === 'head') {
      const first = await extractFrames(url, 2, undefined, [0])
      const frameUrl = first.urls[0]
      if (!frameUrl) return { error: '首帧抽取失败' }
      const yavg = first.stats?.[0]?.yavg
      return { url: frameUrl, yavg, notice: darkFrameNotice('head', yavg) }
    }
    const last = await extractFrames(url, 2, undefined, [TAIL_FRAME_SSEOF_SEC])
    const frameUrl = last.urls[0]
    if (!frameUrl) return { error: '尾帧抽取失败' }
    const yavg = last.stats?.[0]?.yavg
    return { url: frameUrl, yavg, notice: darkFrameNotice('tail', yavg) }
  } catch (e) {
    return { error: (e as Error)?.message || '抽帧失败' }
  }
}

export function clearClipBoundaryFrameCache(videoUrl?: string) {
  if (!videoUrl) {
    frameCache.clear()
    return
  }
  frameCache.delete(videoUrl)
}