/** 画布节点预览宽度；出片/参考仍用素材卡上的原图 url */
export const CANVAS_THUMB_WIDTH = 320

/** 站内图片 → 缩略图 API；外链与 data URL 原样返回 */
export function canvasDisplayImageUrl(url: string | undefined | null, w = CANVAS_THUMB_WIDTH): string {
  const raw = String(url || '').trim()
  if (!raw) return ''
  const bare = raw.split('?')[0]
  if (bare.startsWith('data:') || /^https?:\/\//i.test(bare)) return raw
  if (
    bare.startsWith('/project-assets/') ||
    bare.startsWith('/generated/') ||
    bare.startsWith('/videos/')
  ) {
    const q = new URLSearchParams({ ref: bare, w: String(w) })
    return `/api/canvas-thumb?${q.toString()}`
  }
  return raw
}