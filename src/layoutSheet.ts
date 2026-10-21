import type { ShotLayout } from './types'

/**
 * 俯视调度图 → SVG 字符串 / PNG。
 *
 * 为什么用字符串拼而不是序列化 React 组件：出片时要「没打开面板也能生成」，
 * 拿不到 DOM；纯函数随便在哪调。视觉与 LayoutView 保持一致（同一套坐标与配色）。
 */
const W = 320
const H = 240
const PAD = 14

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const px = (v: number) => (PAD + v * (W - PAD * 2)).toFixed(1)
const py = (v: number) => (PAD + v * (H - PAD * 2)).toFixed(1)

export function layoutSvg(layout: ShotLayout): string {
  const actors = layout?.actors ?? []
  const cam = layout?.camera ?? { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5 }
  const [a, b] = actors
  const axis = a && b ? { x1: px(a.x), y1: py(a.y), x2: px(b.x), y2: py(b.y) } : null

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<style>
      .f{fill:#F7F6F1;stroke:#B4B2A9;stroke-width:1}
      .c{font:11px system-ui;fill:#888780}
      .ax{stroke:#888780;stroke-width:1;stroke-dasharray:6 5;fill:none}
      .cam{fill:#B5D4F4;stroke:#185FA5;stroke-width:1}
      .fov{stroke:#378ADD;stroke-width:1.5;stroke-dasharray:4 3;fill:none}
      .look{fill:#185FA5}
      .act{fill:#9FE1CB;stroke:#0F6E56;stroke-width:1.5}
      .face{stroke:#0F6E56;stroke-width:1.5}
      .nm{font:11px system-ui;fill:#3C3489;text-anchor:middle}
      .empty{font:12px system-ui;fill:#888780;text-anchor:middle}
    </style>`,
    `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" class="f"/>`,
    `<text x="12" y="20" class="c">俯视 · ${(layout?.w ?? 10) + '×' + (layout?.h ?? 8)}m</text>`,
  )

  if (axis) {
    parts.push(
      `<line x1="${axis.x1}" y1="${axis.y1}" x2="${axis.x2}" y2="${axis.y2}" class="ax"/>`,
      `<text x="${Number(axis.x2) + 6}" y="${Number(axis.y2) + 4}" class="c">轴线</text>`,
    )
  }

  parts.push(
    `<path d="M${px(cam.x)} ${Number(py(cam.y)) - 9} L${Number(px(cam.x)) - 8} ${Number(py(cam.y)) + 7} L${Number(px(cam.x)) + 8} ${Number(py(cam.y)) + 7} Z" class="cam"/>`,
    `<line x1="${px(cam.x)}" y1="${py(cam.y)}" x2="${px(cam.lookX)}" y2="${py(cam.lookY)}" class="fov"/>`,
    `<circle cx="${px(cam.lookX)}" cy="${py(cam.lookY)}" r="3" class="look"/>`,
  )

  for (const ac of actors) {
    const deg = ((ac.face ?? 0) * Math.PI) / 180
    const cx = Number(px(ac.x))
    const cy = Number(py(ac.y))
    const r = 11
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" class="act"/>`,
      `<line x1="${(cx + Math.cos(deg) * r).toFixed(1)}" y1="${(cy + Math.sin(deg) * r).toFixed(1)}" x2="${(cx + Math.cos(deg) * (r + 10)).toFixed(1)}" y2="${(cy + Math.sin(deg) * (r + 10)).toFixed(1)}" class="face"/>`,
      `<text x="${cx}" y="${cy + r + 12}" class="nm">${esc(ac.name)}</text>`,
    )
  }

  if (actors.length === 0) {
    parts.push(`<text x="${W / 2}" y="${H / 2}" class="empty">暂无站位</text>`)
  }

  parts.push('</svg>')
  return parts.join('')
}

/** SVG → PNG dataURL（默认 2 倍，出图更清晰） */
export async function layoutToPng(layout: ShotLayout, scale = 2): Promise<string> {
  const svg = layoutSvg(layout)
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('调度图渲染失败'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('取不到 canvas 上下文')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 生成并落盘，返回站内路径（/generated/layout-xxx.png） */
export async function saveLayoutSheet(layout: ShotLayout): Promise<string> {
  const dataUrl = await layoutToPng(layout)
  const r = await fetch('/api/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, prefix: 'layout' }),
  }).then((x) => x.json())
  if (!r.ok) throw new Error(r.message || '调度图保存失败')
  return r.url as string
}
