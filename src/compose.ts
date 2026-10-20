import type { Mark } from './types'

export const COMPOSE_W = 1024
export const COMPOSE_H = 576

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('参考图加载失败'))
    img.src = src
  })
}

/**
 * 把「参考图 + 构图标注」合成为一张 16:9 的图，作为 Seedream 的 image 输入。
 * 用离屏 canvas 以 1024 宽重绘，保证参考图分辨率不被卡片缩略图限制。
 */
export async function composeReference(refImage: string, marks: Mark[]): Promise<string> {
  const W = COMPOSE_W
  const H = COMPOSE_H
  const img = await loadImage(refImage)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')

  // 与卡片一致的 cover 裁切
  const s = Math.max(W / img.width, H / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (const m of marks) {
    ctx.globalAlpha = 0.8
    ctx.strokeStyle = m.color
    ctx.lineWidth = 7
    ctx.shadowColor = m.color
    ctx.shadowBlur = 10

    if (m.kind === 'pen') {
      const pts = m.points ?? []
      if (pts.length < 4) continue
      ctx.beginPath()
      for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i] * W
        const y = pts[i + 1] * H
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    } else {
      ctx.setLineDash([18, 12])
      ctx.strokeRect((m.x ?? 0) * W, (m.y ?? 0) * H, (m.w ?? 0) * W, (m.h ?? 0) * H)
      ctx.setLineDash([])
    }
  }

  ctx.globalAlpha = 1
  ctx.shadowBlur = 0

  return canvas.toDataURL('image/jpeg', 0.92)
}

/** 传给模型时追加的构图指令 */
export const COMPOSE_HINT =
  '\n\n构图要求：参考图中的彩色标注框标出了主体位置与画面占比，请严格按标注的构图关系安排主体；标注线条本身不要出现在成图里。'
