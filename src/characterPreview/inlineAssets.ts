/**
 * 导出时的资源内联。
 *
 * 在线预览直接读站内路径；导出必须把图与音都塞进同一个文件，
 * 否则把 .html 拷到别的机器就是一堆裂图。这里只负责"读回来 → 转 data URL"，
 * 排版与快照逻辑不参与，保证两种形态共用一份 viewer。
 */
export type InlineAssetOptions = {
  /** 图片最长边；转盘帧只是预览用，没必要保留原图分辨率 */
  maxEdge?: number
  /** WebP/JPEG 质量 */
  quality?: number
  fetchImpl?: typeof fetch
}

export const DEFAULT_INLINE_MAX_EDGE = 512
export const DEFAULT_INLINE_QUALITY = 0.8

/** 只接受同源相对路径与 http(s)；file:/javascript: 之类一律拒绝 */
export function isFetchableUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith('data:')) return false
  if (url.startsWith('/')) return true
  if (/^https?:\/\//i.test(url)) return true
  return false
}

/**
 * 单个资源 → data URL。
 * 图片统一压成 WebP（不支持时回退 JPEG），音频等其它类型按原样 base64。
 */
export async function inlineAsset(url: string, options: InlineAssetOptions = {}): Promise<string> {
  if (!url) throw new Error('空资源地址')
  if (url.startsWith('data:')) return url
  if (!isFetchableUrl(url)) throw new Error(`不支持的预览资源：${url}`)

  const fetchImpl = options.fetchImpl ?? fetch
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`资源读取失败（${res.status}）：${url}`)
  const blob = await res.blob()
  if (String(blob.type || '').startsWith('image/')) return encodeImage(blob, options)
  return blobToDataUrl(blob)
}

async function encodeImage(blob: Blob, options: InlineAssetOptions): Promise<string> {
  const maxEdge = options.maxEdge ?? DEFAULT_INLINE_MAX_EDGE
  const quality = options.quality ?? DEFAULT_INLINE_QUALITY
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('当前环境不支持图片压缩')
  }
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器不支持图片压缩')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const webp = canvas.toDataURL('image/webp', quality)
    // 有的运行环境声称支持 webp 却返回 png，这时按 jpeg 收口
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close?.()
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'function') return Promise.reject(new Error('当前环境不支持文件读取'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('资源转内联失败'))
    reader.readAsDataURL(blob)
  })
}
