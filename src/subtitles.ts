/**
 * 字幕烧录：本机 ffmpeg 没编 libass（subtitles / drawtext 滤镜都不存在），
 * 所以字幕在浏览器用 2D canvas 渲成「整帧透明 PNG」，交给 ffmpeg 用 overlay 叠上去。
 */

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

/** 按分辨率给字号，保证 480p~1080p 观感一致 */
function fontPx(H: number) {
  return Math.round(H * 0.044)
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
}

/**
 * 渲染成一整帧透明 PNG（dataURL），文字居中贴在安全框下方。
 * 返回 null 表示这句没内容。
 */
export function renderSubtitlePng({ width, height, text }: SubtitleOpts): string | null {
  const t = text.trim()
  if (!t) return null

  const cv = document.createElement('canvas')
  cv.width = width
  cv.height = height
  const ctx = cv.getContext('2d')
  if (!ctx) return null

  const size = fontPx(height)
  const maxW = width * 0.78
  ctx.font = `600 ${size}px ${FONT_STACK}`
  let lines = wrap(ctx, t, maxW)
  // 超过 3 行说明台词太长，截断加省略号（字幕不是剧本，塞不下就该改词）
  if (lines.length > 3) {
    lines = lines.slice(0, 3)
    lines[2] = lines[2].slice(0, Math.max(1, lines[2].length - 1)) + '…'
  }
  const lineH = Math.round(size * 1.42)
  const blockH = lines.length * lineH
  const padX = Math.round(size * 0.5)
  const padY = Math.round(size * 0.34)

  // 底部安全区：离画面底边 6%
  const baseY = height - Math.round(height * 0.06) - blockH

  // 文字块背景（半透明圆角，保证亮画面上也读得清）
  const blockW = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2
  const bx = (width - blockW) / 2
  const by = baseY - padY
  const bh = blockH + padY * 2
  const r = Math.min(14, bh / 2)

  ctx.beginPath()
  ctx.moveTo(bx + r, by)
  ctx.arcTo(bx + blockW, by, bx + blockW, by + bh, r)
  ctx.arcTo(bx + blockW, by + bh, bx, by + bh, r)
  ctx.arcTo(bx, by + bh, bx, by, r)
  ctx.arcTo(bx, by, bx + blockW, by, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(4, 8, 14, 0.52)'
  ctx.fill()

  // 描边 + 填充，双重保证可读
  ctx.font = `600 ${size}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.lineJoin = 'round'
  lines.forEach((l, i) => {
    const x = width / 2
    const y = baseY + i * lineH
    ctx.lineWidth = Math.round(size * 0.22)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)'
    ctx.strokeText(l, x, y)
    ctx.fillStyle = '#f4f8fc'
    ctx.fillText(l, x, y)
  })

  return cv.toDataURL('image/png')
}

export const EXPORT_SIZES: Record<'480p' | '720p' | '1080p', [number, number]> = {
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
}
