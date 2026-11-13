import { getViewportForBounds } from '@xyflow/react'
import { toPng } from 'html-to-image'

const MIN_WIDTH = 1280
const MIN_HEIGHT = 720
const MAX_DIMENSION = 4096
const PADDING = 96

type Bounds = {
  x: number
  y: number
  width: number
  height: number
}

type ExportOptions = {
  root: HTMLElement
  bounds: Bounds | (() => Bounds)
  fileName: string
  expectedNodes: number
}

export function pngOutputSize(bounds: Pick<Bounds, 'width' | 'height'>) {
  let width = Math.max(1, bounds.width + PADDING * 2)
  let height = Math.max(1, bounds.height + PADDING * 2)
  const scale = Math.min(2, MAX_DIMENSION / width, MAX_DIMENSION / height)
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))

  const grow = Math.max(1, MIN_WIDTH / width, MIN_HEIGHT / height)
  if (grow > 1) {
    width = Math.min(MAX_DIMENSION, Math.round(width * grow))
    height = Math.min(MAX_DIMENSION, Math.round(height * grow))
  }

  return { width, height }
}

function waitForFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    images.map(async (img) => {
      if (!img.complete) {
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          img.addEventListener('load', done, { once: true })
          img.addEventListener('error', done, { once: true })
          window.setTimeout(done, 4000)
        })
      }
      try {
        await img.decode()
      } catch {
        /* 缺失图片由 html-to-image 留空，不阻塞整张画布导出 */
      }
    }),
  )
}

export async function waitForCanvasRender(root: HTMLElement, expectedNodes: number) {
  for (let i = 0; i < 30; i += 1) {
    if (root.querySelectorAll('.react-flow__node').length >= expectedNodes) break
    await waitForFrame()
  }
  await waitForImages(root)
  await document.fonts?.ready
  await waitForFrame()
}

export async function exportCanvasPng({ root, bounds, fileName, expectedNodes }: ExportOptions) {
  await waitForCanvasRender(root, expectedNodes)
  const currentBounds = typeof bounds === 'function' ? bounds() : bounds
  const { width, height } = pngOutputSize(currentBounds)
  const viewport = getViewportForBounds(currentBounds, width, height, 0.1, 2, 0.06)

  const dataUrl = await toPng(root, {
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    backgroundColor: '#070b11',
    cacheBust: true,
    pixelRatio: 1,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    },
  })

  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.click()
  return { width, height }
}
