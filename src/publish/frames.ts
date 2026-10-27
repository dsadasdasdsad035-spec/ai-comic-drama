/**
 * 从本地视频抽帧。纯前端，不占服务端。
 *
 * 抽出的画面必须符合目标封面比例：成片是 9:16 而平台要 16:9 时，
 * 直接把原图塞进封面框会被平台再裁一次，构图不可控。这里统一按
 * 「填满目标框、居中裁掉多余边」处理。
 */

export type CoverCrop = { sx: number; sy: number; sw: number; sh: number }

/** "9:16" → 0.5625；非法输入返回 0，调用方据此退回原始画幅 */
export function aspectRatioOf(aspect: string): number {
  const m = /^(\d+):(\d+)$/.exec(String(aspect || '').trim())
  if (!m) return 0
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return 0
  return w / h
}

/**
 * 计算居中裁切矩形（cover 语义：先按目标比例铺满，再裁掉多出的边）。
 * 输入输出都用源图像素坐标，便于直接交给 drawImage。
 */
export function coverCropRect(srcW: number, srcH: number, aspect: string): CoverCrop {
  const target = aspectRatioOf(aspect)
  if (!(srcW > 0) || !(srcH > 0) || !target) return { sx: 0, sy: 0, sw: srcW, sh: srcH }
  const srcAspect = srcW / srcH
  if (srcAspect > target) {
    // 源更宽：保留全高，裁两侧
    const sw = Math.min(srcW, Math.round(srcH * target))
    return { sx: Math.round((srcW - sw) / 2), sy: 0, sw, sh: srcH }
  }
  // 源更高：保留全宽，裁上下
  const sh = Math.min(srcH, Math.round(srcW / target))
  return { sx: 0, sy: Math.round((srcH - sh) / 2), sw: srcW, sh }
}

/** 与裁切矩形对应的输出尺寸：宽度优先受 maxWidth 限制 */
function outputSize(crop: CoverCrop, maxWidth: number): { w: number; h: number } {
  if (!(crop.sw > 0) || !(crop.sh > 0)) return { w: maxWidth, h: maxWidth }
  const w = Math.min(maxWidth, crop.sw)
  return { w, h: Math.max(1, Math.round((w * crop.sh) / crop.sw)) }
}

function encodeFrame(
  video: HTMLVideoElement,
  crop: CoverCrop,
  maxWidth: number,
): string | null {
  const { w, h } = outputSize(crop, maxWidth)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    return null
  }
}

function waitReady(video: HTMLVideoElement): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => resolve(ok)
    video.onloadedmetadata = () => done(true)
    video.onerror = () => done(false)
    window.setTimeout(() => done(Boolean(video.duration)), 8000)
  })
}

/** 抽 count 帧；aspect 为空时保持成片原始画幅 */
export async function loadVideoFrame(
  src: string,
  count = 4,
  maxWidth = 720,
  aspect = '',
): Promise<string[]> {
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  const ready = await waitReady(video)
  if (!ready || !Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('无法读取视频时长，可能不是浏览器支持的格式')
  }

  const crop = coverCropRect(video.videoWidth, video.videoHeight, aspect)
  const out: string[] = []
  // 取 10%–85% 区间，避开首尾黑场
  for (let i = 0; i < count; i++) {
    const t = video.duration * (0.1 + (0.75 * i) / Math.max(1, count - 1))
    const ok = await new Promise<boolean>((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        resolve(true)
      }
      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.05))
      window.setTimeout(() => {
        video.removeEventListener('seeked', onSeeked)
        resolve(false)
      }, 4000)
    })
    if (!ok) continue
    const frame = encodeFrame(video, crop, maxWidth)
    if (frame) out.push(frame)
  }
  return out
}

/**
 * 按比例位置抽一帧。助手用它在用户说「用第几个画面当封面」时直接取一帧，
 * 避免把整段视频交给模型；aspect 决定输出画幅，与封面上传同一口径。
 */
export async function loadVideoFrameAt(
  src: string,
  atPercent: number,
  maxWidth = 720,
  aspect = '',
): Promise<string> {
  const pct = Math.min(0.95, Math.max(0, Number(atPercent) || 0.5))
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  const ready = await waitReady(video)
  if (!ready || !Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('无法读取视频时长，可能不是浏览器支持的格式')
  }

  const t = Math.min(Math.max(0, video.duration * pct), Math.max(0, video.duration - 0.05))
  const ok = await new Promise<boolean>((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve(true)
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = t
    window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      resolve(false)
    }, 4000)
  })
  if (!ok) throw new Error('定位到该时间点失败，换一个位置再试')
  const crop = coverCropRect(video.videoWidth, video.videoHeight, aspect)
  const frame = encodeFrame(video, crop, maxWidth)
  if (!frame) throw new Error('抽帧失败，可能受跨域限制')
  return frame
}
