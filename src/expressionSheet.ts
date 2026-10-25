import {
  EXPRESSION_PROMPTS,
  EXPRESSION_SHEET_COLUMNS,
  EXPRESSION_SHEET_EMOTIONS,
  EXPRESSION_SHEET_ROWS,
  identityFingerprint,
  type CharacterExpressionSheet,
  type CharacterSheet,
  type ExpressionSheetCell,
} from './characters'
import { shortHash } from './scheduleGeometry'
import type { PerformanceEmotion } from './types'

export { EXPRESSION_SHEET_COLUMNS, EXPRESSION_SHEET_EMOTIONS, EXPRESSION_SHEET_ROWS }

/** 一次生成一张；4×2 的八格顺序必须与 UI、裁剪和旧数据映射一致。 */
export const EXPRESSION_SHEET_SUFFIX =
  'character expression sheet, exactly 4 columns by 2 rows, eight equal square head-and-shoulders ' +
  'portraits in one image, no borders, no gutters, no labels, no text, no watermark, same person, ' +
  'same hairstyle, same outfit, same accessories, same lighting, plain neutral grey seamless studio ' +
  'background, only the facial expression changes in each cell, natural skin texture, consistent identity'

export function buildExpressionSheetCells(): ExpressionSheetCell[] {
  const w = 1 / EXPRESSION_SHEET_COLUMNS
  const h = 1 / EXPRESSION_SHEET_ROWS
  return EXPRESSION_SHEET_EMOTIONS.map((emotion, i) => ({
    emotion,
    x: (i % EXPRESSION_SHEET_COLUMNS) * w,
    y: Math.floor(i / EXPRESSION_SHEET_COLUMNS) * h,
    w,
    h,
  }))
}

export function cellForEmotion(
  sheet: CharacterExpressionSheet | undefined,
  emotion: PerformanceEmotion,
): ExpressionSheetCell | undefined {
  const found = sheet?.cells?.find((cell) => cell.emotion === emotion)
  if (found) return found
  return buildExpressionSheetCells().find((cell) => cell.emotion === emotion)
}

/** 总图内容指纹；不包含 cropUrl，避免裁剪写回后反过来让缓存失效。 */
export function sheetFingerprint(sheet: Pick<CharacterExpressionSheet, 'image' | 'fingerprint' | 'cells'>): string {
  return shortHash(
    JSON.stringify({
      image: sheet.image,
      identity: sheet.fingerprint,
      cells: (sheet.cells ?? []).map((cell) => [cell.emotion, cell.x, cell.y, cell.w, cell.h]),
    }),
  )
}

export function cropFingerprint(
  sheet: Pick<CharacterExpressionSheet, 'image' | 'fingerprint' | 'cells'>,
  cell: Pick<ExpressionSheetCell, 'emotion' | 'x' | 'y' | 'w' | 'h'>,
): string {
  return shortHash(
    JSON.stringify({
      image: sheet.image,
      identity: sheet.fingerprint,
      sheet: sheetFingerprint(sheet),
      cell: [cell.emotion, cell.x, cell.y, cell.w, cell.h],
    }),
  )
}

export function isSheetUsable(
  sheet: CharacterExpressionSheet | undefined,
  currentIdentity?: string,
): sheet is CharacterExpressionSheet {
  if (!sheet?.image || sheet.stale) return false
  if (sheet.columns !== EXPRESSION_SHEET_COLUMNS || sheet.rows !== EXPRESSION_SHEET_ROWS) return false
  if (!Array.isArray(sheet.cells) || sheet.cells.length !== EXPRESSION_SHEET_EMOTIONS.length) return false
  if (currentIdentity && sheet.fingerprint !== currentIdentity) return false
  const seen = new Set<PerformanceEmotion>()
  for (const cell of sheet.cells) {
    if (!EXPRESSION_SHEET_EMOTIONS.includes(cell.emotion)) return false
    if (seen.has(cell.emotion)) return false
    seen.add(cell.emotion)
    if (![cell.x, cell.y, cell.w, cell.h].every((n) => Number.isFinite(n) && n >= 0)) return false
    if (cell.w <= 0 || cell.h <= 0) return false
  }
  return seen.size === EXPRESSION_SHEET_EMOTIONS.length
}

export type ExpressionReferenceSelection =
  | { kind: 'sheet'; url: string; emotion: PerformanceEmotion; sheet: CharacterExpressionSheet; cell: ExpressionSheetCell }
  | { kind: 'legacy'; url: string; emotion: PerformanceEmotion }
  | { kind: 'none'; reason: string }

/**
 * 总图 > 旧逐情绪单图 > 空。总图存在但失效/缺裁剪时不再偷偷用旧图，
 * 避免同一角色同时出现两套表情语义；只有完全没有总图时才读旧数据。
 */
export function selectExpressionReference(input: {
  character: Pick<CharacterSheet, 'expressions' | 'expressionSheet' | 'lookEn' | 'palette' | 'keywords'>
  emotion: PerformanceEmotion
}): ExpressionReferenceSelection {
  const { character, emotion } = input
  const identity = identityFingerprint(character)
  const sheet = character.expressionSheet
  if (sheet) {
    if (!isSheetUsable(sheet, identity)) return { kind: 'none', reason: '总图已失效' }
    const cell = sheet.cells.find((item) => item.emotion === emotion)
    if (!cell) return { kind: 'none', reason: '总图没有这个情绪格' }
    if (!cell.cropUrl) return { kind: 'none', reason: '表情单格尚未裁剪' }
    if (cell.cropFingerprint && cell.cropFingerprint !== cropFingerprint(sheet, cell)) {
      return { kind: 'none', reason: '表情单格缓存已失效' }
    }
    return { kind: 'sheet', url: cell.cropUrl, emotion, sheet, cell }
  }

  const legacy = character.expressions?.[emotion]
  if (legacy?.image && !legacy.stale) {
    if (!legacy.fingerprint || legacy.fingerprint === identity) {
      return { kind: 'legacy', url: legacy.image, emotion }
    }
    return { kind: 'none', reason: '旧表情参考已失效' }
  }
  return { kind: 'none', reason: '没有可用的表情参考' }
}

export function expressionSheetPrompt(lookEn: string): string {
  const cells = EXPRESSION_SHEET_EMOTIONS.map((emotion, i) => {
    const row = Math.floor(i / EXPRESSION_SHEET_COLUMNS) + 1
    const col = (i % EXPRESSION_SHEET_COLUMNS) + 1
    return `row ${row} column ${col}: ${EXPRESSION_PROMPTS[emotion]}`
  }).join('; ')
  return `${lookEn}, ${EXPRESSION_SHEET_SUFFIX}. ${cells}.`
}

export function cropRectPixels(
  cell: Pick<ExpressionSheetCell, 'x' | 'y' | 'w' | 'h'>,
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const x = Math.max(0, Math.min(1, cell.x))
  const y = Math.max(0, Math.min(1, cell.y))
  const w = Math.max(0, Math.min(1 - x, cell.w))
  const h = Math.max(0, Math.min(1 - y, cell.h))
  return {
    sx: Math.round(x * width),
    sy: Math.round(y * height),
    sw: Math.max(1, Math.round(w * width)),
    sh: Math.max(1, Math.round(h * height)),
  }
}
