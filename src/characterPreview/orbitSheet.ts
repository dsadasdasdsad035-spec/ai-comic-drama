import { saveImageDataUrl } from '../api'
import {
  ORBIT_ANGLES,
  ORBIT_SHEET_COLUMNS,
  ORBIT_SHEET_ROWS,
  type CharacterOrbitSheet,
  type CharacterSheet,
  type OrbitSheetCell,
} from '../characters'
import { canGenerateExpressionSheet, cropRectPixels } from '../expressionSheet'
import { shortHash } from '../hash'

/**
 * 八个水平视角塞进一张 4×2 总图。
 *
 * 不直接把三视图切三份：三视图只有 0/90/180 三个关键角度，等分还会切到人；
 * 一次生成八个 45° 递增的全身帧才能让预览真正"转"起来。
 */
export const ORBIT_SHEET_SUFFIX =
  'character orbit sheet, exactly 4 columns by 2 rows, eight equal full-body portraits of the same ' +
  'person in one image, rotating clockwise in 45 degree steps, cell order: ' +
  'row 1 column 1 front view 0 degrees; row 1 column 2 three-quarter front left 45 degrees; ' +
  'row 1 column 3 left profile 90 degrees; row 1 column 4 back three-quarter left 135 degrees; ' +
  'row 2 column 1 back view 180 degrees; row 2 column 2 back three-quarter right 225 degrees; ' +
  'row 2 column 3 right profile 270 degrees; row 2 column 4 three-quarter front right 315 degrees; ' +
  'identical outfit, hairstyle, accessories and body proportions in every cell, each figure centered ' +
  'in its own cell with margin, standing straight, arms relaxed, plain neutral grey seamless studio ' +
  'background, flat even lighting, no borders, no gutters, no labels, no text, no watermark'

/** 单帧低于这个像素就没有预览价值；用来把明显错的裁切挡在写文件之前 */
export const MIN_ORBIT_CELL_PX = 1

export function buildOrbitSheetCells(): OrbitSheetCell[] {
  const w = 1 / ORBIT_SHEET_COLUMNS
  const h = 1 / ORBIT_SHEET_ROWS
  return ORBIT_ANGLES.map((angle, i) => ({
    angle,
    x: (i % ORBIT_SHEET_COLUMNS) * w,
    y: Math.floor(i / ORBIT_SHEET_COLUMNS) * h,
    w,
    h,
  }))
}

/** 无 lookEn、只靠参考图生成时用的英文身份句 */
export const ORBIT_REF_ONLY_IDENTITY =
  'same person as reference image, match reference identity exactly, keep hairstyle outfit accessories and lighting'

export function orbitSheetPrompt(lookEn: string): string {
  const identity = lookEn.trim() || ORBIT_REF_ONLY_IDENTITY
  return `${identity}, ${ORBIT_SHEET_SUFFIX}.`
}

/** 与表情总图同一套门槛：有锚点，或有可用的三视图/参考图 */
export function canGenerateOrbitSheet(
  character: Pick<CharacterSheet, 'lookEn' | 'image' | 'referenceImages'>,
  options?: { imageMissing?: boolean },
): boolean {
  return canGenerateExpressionSheet(character, options)
}

export function orbitCropRect(
  cell: Pick<OrbitSheetCell, 'x' | 'y' | 'w' | 'h'>,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  return cropRectPixels(cell, width, height)
}

/**
 * 异常格自检：只挡真正的错误（几何非法、算出的框太小），
 * 不影响构图审美——构图问题归生成提示词管。
 */
export function validateOrbitCells(
  cells: OrbitSheetCell[],
  width: number,
  height: number,
): string[] {
  const errors: string[] = []
  if (!(width > 0) || !(height > 0)) return ['总图没有有效尺寸']
  if (cells.length !== ORBIT_ANGLES.length) {
    errors.push(`转盘应有 ${ORBIT_ANGLES.length} 帧，实际 ${cells.length} 帧`)
  }
  const seen = new Set<number>()
  for (const cell of cells) {
    if (!ORBIT_ANGLES.includes(cell.angle as (typeof ORBIT_ANGLES)[number])) {
      errors.push(`非法角度 ${cell.angle}`)
      continue
    }
    if (seen.has(cell.angle)) errors.push(`角度重复 ${cell.angle}`)
    seen.add(cell.angle)
    if (![cell.x, cell.y, cell.w, cell.h].every((n) => Number.isFinite(n) && n >= 0)) {
      errors.push(`${cell.angle}° 坐标非法`)
      continue
    }
    const rect = orbitCropRect(cell, width, height)
    if (rect.sw < MIN_ORBIT_CELL_PX || rect.sh < MIN_ORBIT_CELL_PX) {
      errors.push(`${cell.angle}° 裁切框过小（${rect.sw}×${rect.sh}）`)
    }
  }
  return errors
}

/** 单帧缓存指纹：总图、身份、角度与格位任一变化都会让旧裁图失效 */
export function orbitCellFingerprint(
  sheet: Pick<CharacterOrbitSheet, 'image' | 'fingerprint'>,
  cell: Pick<OrbitSheetCell, 'angle' | 'x' | 'y' | 'w' | 'h'>,
): string {
  return shortHash(
    JSON.stringify({
      image: sheet.image,
      identity: sheet.fingerprint,
      cell: [cell.angle, cell.x, cell.y, cell.w, cell.h],
    }),
  )
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const timer = window.setTimeout(() => {
      img.src = ''
      reject(new Error('转盘总图加载超时'))
    }, 20_000)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('转盘总图加载失败'))
    }
    img.src = src
  })
}

/**
 * 一次性把八帧裁出来。单帧失败不影响其它帧，也不丢总图；
 * 缺帧的转盘在预览里会整张降级为静态卡（半张转盘更让人困惑）。
 */
export async function cropOrbitSheet(
  sheet: CharacterOrbitSheet,
  project: string,
): Promise<{ sheet: CharacterOrbitSheet; errors: string[] }> {
  const img = await loadImage(sheet.image)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height
  const fatal = validateOrbitCells(sheet.cells, width, height).filter((e) => e.includes('尺寸'))
  if (fatal.length) throw new Error(fatal[0])

  const cells: OrbitSheetCell[] = []
  const errors: string[] = []
  for (const cell of sheet.cells) {
    const expected = orbitCellFingerprint(sheet, cell)
    if (cell.cropUrl && cell.cropFingerprint === expected) {
      cells.push(cell)
      continue
    }
    try {
      const rect = orbitCropRect(cell, width, height)
      if (rect.sw < MIN_ORBIT_CELL_PX || rect.sh < MIN_ORBIT_CELL_PX) {
        throw new Error('裁切框过小')
      }
      const canvas = document.createElement('canvas')
      canvas.width = rect.sw
      canvas.height = rect.sh
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('浏览器不支持图片裁剪')
      ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.sw, rect.sh)
      const dataUrl = canvas.toDataURL('image/png')
      const url = await saveImageDataUrl(dataUrl, {
        project,
        prefix: `char-orbit-${cell.angle}`,
      })
      cells.push({ ...cell, cropUrl: url, cropFingerprint: expected })
    } catch (e) {
      const msg = (e as Error).message || '转盘单帧裁剪失败'
      cells.push({ ...cell, cropUrl: undefined, cropFingerprint: undefined })
      errors.push(`${cell.angle}°：${msg.includes('tainted') ? '总图跨域，无法裁剪' : msg}`)
    }
  }
  return { sheet: { ...sheet, cells }, errors }
}
