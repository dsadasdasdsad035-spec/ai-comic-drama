import { shortHash } from './scheduleGeometry'

export type BoardImage = { label: string; url?: string; kind?: 'frame' | 'scene' | 'character' | 'prop' }

export type ReferenceBoardInput = {
  currentFrame?: string
  scene?: BoardImage
  characters: BoardImage[]
  props: BoardImage[]
  manifest: string
  /** 所有参与指纹的图片 URL/资源键（含被数量上限截掉的） */
  resources: string[]
}

export type ReferenceBoard = {
  dataUrl: string
  manifest: string
  fingerprint: string
  hasImages: boolean
  imageCount: number
}

const W = 1400
const H = 1200
const PAD = 26
const HEADER = 60
const GAP = 18
const CELL_W = (W - PAD * 2 - GAP) / 2
const CELL_H = (H - PAD * 2 - HEADER - GAP * 3) / 4

function loadImage(url?: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  if (/^https?:\/\//i.test(url) && !url.startsWith(location.origin)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    const timer = window.setTimeout(() => resolve(null), 5000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    try {
      img.crossOrigin = 'anonymous'
      img.src = url
    } catch {
      window.clearTimeout(timer)
      resolve(null)
    }
  })
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  const iw = img.naturalWidth * scale
  const ih = img.naturalHeight * scale
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih)
}

function cell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  img: HTMLImageElement | null,
  accent: string,
) {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, CELL_W, CELL_H)
  ctx.strokeStyle = '#b8c0c8'
  ctx.lineWidth = 2
  ctx.strokeRect(x, y, CELL_W, CELL_H)
  ctx.fillStyle = accent
  ctx.fillRect(x, y, 8, CELL_H)
  ctx.fillStyle = '#17212b'
  ctx.font = 'bold 20px system-ui, sans-serif'
  ctx.fillText(label.slice(0, 52), x + 20, y + 28)
  if (img) {
    drawContain(ctx, img, x + 18, y + 44, CELL_W - 36, CELL_H - 60)
  } else {
    ctx.fillStyle = '#eef1f4'
    ctx.fillRect(x + 18, y + 44, CELL_W - 36, CELL_H - 60)
    ctx.fillStyle = '#8b96a1'
    ctx.font = '18px system-ui, sans-serif'
    ctx.fillText('MISSING IMAGE', x + 28, y + 74)
  }
}

/**
 * 把当前帧、场景卡、角色、道具压成一张带标签参考板。
 * 图片数量有限；未进入参考板的资源仍保留在 manifest 里交给文本模型。
 */
export async function buildReferenceBoard(input: ReferenceBoardInput): Promise<ReferenceBoard> {
  const characters = input.characters.slice(0, 3)
  const props = input.props.slice(0, 3)
  const current = input.currentFrame || ''
  const scene = input.scene?.url || ''
  const resources = [
    ...input.resources,
    ...(current ? [current] : []),
    ...(scene ? [scene] : []),
    ...characters.map((c) => c.url || ''),
    ...props.map((p) => p.url || ''),
  ].filter(Boolean)
  const fingerprint = shortHash(
    JSON.stringify({
      current,
      scene,
      characters: characters.map((c) => [c.label, c.url || '']),
      props: props.map((p) => [p.label, p.url || '']),
      manifest: input.manifest,
    }),
  )
  const [curImg, sceneImg, ...rest] = await Promise.all([
    loadImage(current),
    loadImage(scene),
    ...characters.map((c) => loadImage(c.url)),
    ...props.map((p) => loadImage(p.url)),
  ])
  const anyImage = Boolean(curImg || sceneImg || rest.some(Boolean))
  if (!anyImage) {
    return {
      dataUrl: '',
      manifest: input.manifest,
      fingerprint,
      hasImages: false,
      imageCount: 0,
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas，无法生成参考板')
  ctx.fillStyle = '#f3f5f7'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111820'
  ctx.font = 'bold 24px system-ui, sans-serif'
  ctx.fillText('3D STORYBOARD REFERENCE BOARD', PAD, 38)
  ctx.fillStyle = '#5e6b78'
  ctx.font = '14px system-ui, sans-serif'
  ctx.fillText('CURRENT FRAME / SCENE / CHARACTER / PROP — labels are authoritative', PAD, 56)
  cell(ctx, PAD, PAD + HEADER, 'CURRENT FRAME', curImg, '#2563eb')
  cell(ctx, PAD + CELL_W + GAP, PAD + HEADER, `SCENE — ${input.scene?.label || 'SCENE CARD'}`, sceneImg, '#0f766e')
  const lower: { label: string; img: HTMLImageElement | null; accent: string }[] = [
    ...characters.map((c, i) => ({ label: `CHARACTER — ${c.label}`, img: rest[i] || null, accent: '#7c3aed' })),
    ...props.map((p, i) => ({
      label: `PROP — ${p.label}`,
      img: rest[characters.length + i] || null,
      accent: '#b45309',
    })),
  ]
  lower.forEach((item, i) => {
    const row = 1 + Math.floor(i / 2)
    const col = i % 2
    cell(
      ctx,
      PAD + col * (CELL_W + GAP),
      PAD + HEADER + row * (CELL_H + GAP),
      item.label,
      item.img,
      item.accent,
    )
  })
  let dataUrl = ''
  try {
    dataUrl = canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return { dataUrl: '', manifest: input.manifest, fingerprint, hasImages: false, imageCount: 0 }
  }
  const imageCount = [curImg, sceneImg, ...rest].filter(Boolean).length
  return { dataUrl, manifest: input.manifest, fingerprint, hasImages: true, imageCount }
}
