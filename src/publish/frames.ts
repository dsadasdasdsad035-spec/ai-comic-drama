/** 从本地视频按比例抽帧，返回 JPEG dataURL 列表。纯前端，不占服务端。 */
export async function loadVideoFrame(src: string, count = 4, maxWidth = 720): Promise<string[]> {
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  const ready = await new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => resolve(ok)
    video.onloadedmetadata = () => done(true)
    video.onerror = () => done(false)
    window.setTimeout(() => done(Boolean(video.duration)), 8000)
  })
  if (!ready || !Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('无法读取视频时长，可能不是浏览器支持的格式')
  }

  const canvas = document.createElement('canvas')
  const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16
  const w = Math.min(maxWidth, video.videoWidth || maxWidth)
  const h = Math.round(w * ratio)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')

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
    try {
      ctx.drawImage(video, 0, 0, w, h)
      out.push(canvas.toDataURL('image/jpeg', 0.9))
    } catch {
      /* 单帧失败不阻塞其余 */
    }
  }
  return out
}

/**
 * 按比例位置抽一帧，返回 JPEG dataURL。
 * 助手用它在用户说「用第几个画面当封面」时直接取一帧，避免把整段视频交给模型。
 */
export async function loadVideoFrameAt(src: string, atPercent: number, maxWidth = 720): Promise<string> {
  const pct = Math.min(0.95, Math.max(0, Number(atPercent) || 0.5))
  const video = document.createElement('video')
  video.src = src
  video.muted = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'

  const ready = await new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => resolve(ok)
    video.onloadedmetadata = () => done(true)
    video.onerror = () => done(false)
    window.setTimeout(() => done(Boolean(video.duration)), 8000)
  })
  if (!ready || !Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('无法读取视频时长，可能不是浏览器支持的格式')
  }

  const ratio = video.videoWidth && video.videoHeight ? video.videoHeight / video.videoWidth : 9 / 16
  const w = Math.min(maxWidth, video.videoWidth || maxWidth)
  const h = Math.round(w * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')

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
  try {
    ctx.drawImage(video, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.9)
  } catch {
    throw new Error('抽帧失败，可能受跨域限制')
  }
}
