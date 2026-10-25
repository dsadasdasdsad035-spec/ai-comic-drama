/**
 * 字幕烧录：本机 ffmpeg 没编 libass（subtitles / drawtext 滤镜都不存在），
 * 所以字幕在浏览器用 2D canvas 渲成「整帧透明 PNG」，交给 ffmpeg 用 overlay 叠上去。
 */
import { CAPTION_STYLE, type CaptionStyle } from './captions'

/** 按分辨率给字号，保证 480p~1080p 观感一致 */
function fontPx(H: number, style: CaptionStyle) {
  return Math.round(H * style.fontRatio)
}

/** 中文按字符断行，英文按空格断行 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = []
  let line = ''
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '\n') {
      lines.push(line)
      line = ''
      continue
    }
    const next = line + ch
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line)
      line = ch
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

export type SubtitleOpts = {
  /** 画面宽高（= 导出分辨率） */
  width: number
  height: number
  /** 台词 */
  text: string
  /** 与预览/ASS 共享的样式；缺省用 CAPTION_STYLE */
  style?: Partial<CaptionStyle>
}

/**
 * 渲染成一整帧透明 PNG（dataURL），文字居中贴在安全框下方。
 * 返回 null 表示这句没内容。
 */
export function renderSubtitlePng({ width, height, text, style: styleInput }: SubtitleOpts): string | null {
  const t = text.trim()
  if (!t) return null
  const style: CaptionStyle = { ...CAPTION_STYLE, ...(styleInput || {}) }

  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')
  if (!ctx) return null

  const size = fontPx(height, style)
  const maxW = width * style.maxWidthRatio
  ctx.font = `600 ${size}px ${style.fontFamily}`
  let lines = wrap(ctx, t, maxW)
  // 超过 maxLines 说明台词太长；字幕不是剧本，塞不下就该改词
  if (lines.length > style.maxLines) {
    lines = lines.slice(0, style.maxLines)
    const last = style.maxLines - 1
    lines[last] = lines[last].slice(0, Math.max(1, lines[last].length - 1)) + '…'
  }
  const lineH = Math.round(size * style.lineHeight)
  const blockH = lines.length * lineH
  const padX = Math.round(size * 0.5)
  const padY = Math.round(size * 0.34)

  const baseY = height - Math.round(height * style.bottomRatio) - blockH

  // 文字块背景（半透明圆角，保证亮画面上也读得清）
  const blockW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2
  const bx = (width - blockW) / 2
  const by = baseY - padY
  const bh = blockH + padY * 2
  const r = Math.min(style.radius, bh / 2)

  ctx.beginPath()
  ctx.moveTo(bx + r, by)
  ctx.arcTo(bx + blockW, by, bx + blockW, by + bh, r)
  ctx.arcTo(bx + blockW, by + bh, bx, by + bh, r)
  ctx.arcTo(bx, by + bh, bx, by, r)
  ctx.arcTo(bx, by, bx + blockW, by, r)
  ctx.closePath()
  ctx.fillStyle = style.background
  ctx.fill()

  ctx.font = `600 ${size}px ${style.fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = style.textColor
  lines.forEach((l, i) => {
    ctx.fillText(l, width / 2, baseY + i * lineH)
  })

  return cv.toDataURL('image/png')
}

export const EXPORT_SIZES: Record<'480p' | '720p' | '1080p', [number, number]> = {
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
}
