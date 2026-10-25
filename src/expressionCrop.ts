import { saveImageDataUrl } from './api'
import {
  type CharacterExpressionSheet,
  type ExpressionSheetCell,
} from './characters'
import { cropFingerprint, cropRectPixels } from './expressionSheet'

export type ExpressionCropResult = {
  sheet: CharacterExpressionSheet
  errors: string[]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = window.setTimeout(() => {
      img.src = ''
      reject(new Error('表情总图加载超时'))
    }, 20_000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('表情总图加载失败'))
    }
    img.src = src
  })
}

/** 从同源总图裁出一格并写入项目媒体目录；总图本身永远不会被当作参考发送。 */
export async function cropExpressionCell(
  sheet: CharacterExpressionSheet,
  cell: ExpressionSheetCell,
  project: string,
  image?: HTMLImageElement,
): Promise<{ url: string; fingerprint: string }> {
  const img = image ?? (await loadImage(sheet.image))
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  if (!width || !height) throw new Error('表情总图没有有效尺寸')
  const rect = cropRectPixels(cell, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = rect.sw
  canvas.height = rect.sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持图片裁剪')
  try {
    ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
    const dataUrl = canvas.toDataURL('image/png')
    const url = await saveImageDataUrl(dataUrl, { project, prefix: `char-expr-${cell.emotion}` })
    return { url, fingerprint: cropFingerprint(sheet, cell) }
  } catch (e) {
    const msg = (e as Error).message || '表情单格裁剪失败'
    throw new Error(msg.includes('tainted') || msg.includes('Security') ? '表情总图跨域，无法裁剪' : msg)
  }
}

/**
 * 生成/上传后一次性补齐八格裁剪；单格失败不丢掉整张总图，
 * 失败格保持无 cropUrl，出图时回退文字表演。
 */
export async function cropExpressionSheet(
  sheet: CharacterExpressionSheet,
  project: string,
): Promise<ExpressionCropResult> {
  const img = await loadImage(sheet.image)
  const cells: ExpressionSheetCell[] = []
  const errors: string[] = []
  for (const cell of sheet.cells) {
    const expected = cropFingerprint(sheet, cell)
    if (cell.cropUrl && cell.cropFingerprint === expected) {
      cells.push(cell)
      continue
    }
    try {
      const crop = await cropExpressionCell(sheet, cell, project, img)
      cells.push({ ...cell, cropUrl: crop.url, cropFingerprint: crop.fingerprint })
    } catch (e) {
      cells.push({ ...cell, cropUrl: undefined, cropFingerprint: undefined })
      errors.push(`${cell.emotion}：${(e as Error).message}`)
    }
  }
  return { sheet: { ...sheet, cells }, errors }
}
