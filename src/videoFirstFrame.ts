import { useEffect, useState } from 'react'

/** 同一成片 URL 只抽一次首帧，避免缩放/重挂载时重复解码 */
const posterCache = new Map<string, string>()

function grabFrame(v: HTMLVideoElement): string | null {
  const w = v.videoWidth
  const h = v.videoHeight
  if (!w || !h) return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    ctx.drawImage(v, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

export function captureVideoFirstFrame(src: string): Promise<string | null> {
  const hit = posterCache.get(src)
  if (hit) return Promise.resolve(hit)

  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'

    const finish = (url: string | null) => {
      v.removeAttribute('src')
      v.load()
      v.remove()
      if (url) posterCache.set(src, url)
      resolve(url)
    }

    const onReady = () => {
      if (v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
      const url = grabFrame(v)
      if (url) finish(url)
      else finish(null)
    }

    v.addEventListener('error', () => finish(null), { once: true })
    v.addEventListener(
      'loadeddata',
      () => {
        if (v.currentTime > 0.001) {
          onReady()
          return
        }
        const t = Math.min(0.04, v.duration > 0 ? v.duration * 0.001 : 0.04)
        v.addEventListener('seeked', onReady, { once: true })
        try {
          v.currentTime = t
        } catch {
          onReady()
        }
      },
      { once: true },
    )

    v.src = src
  })
}

/** 视频类型分镜卡封面：成片首帧；无 URL 或解码失败时返回 undefined */
export function useVideoFirstFrame(src?: string): string | undefined {
  const [frame, setFrame] = useState<string | undefined>(() => (src ? posterCache.get(src) : undefined))

  useEffect(() => {
    if (!src) {
      setFrame(undefined)
      return
    }
    const hit = posterCache.get(src)
    if (hit) {
      setFrame(hit)
      return
    }
    let alive = true
    void captureVideoFirstFrame(src).then((url) => {
      if (alive && url) setFrame(url)
    })
    return () => {
      alive = false
    }
  }, [src])

  return frame
}
