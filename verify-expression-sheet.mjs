/**
 * 表情总图纯函数回归：固定格序、4×2 坐标、指纹、可用性、总图/旧图选择、项目往返。
 * 跑法：node verify-expression-sheet.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-expression-sheet-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/expressionSheet.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/characters.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/charMap.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/shotSync.ts'))}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const order = [...lib.EXPRESSION_SHEET_EMOTIONS]
check('固定八情绪顺序', order.join(',') === 'neutral,happy,sad,angry,fearful,disgusted,surprised,calm', order.join(','))
const cells = lib.buildExpressionSheetCells()
check('总图 8 格', cells.length === 8)
check('4×2 坐标', cells[0].x === 0 && cells[0].y === 0 && cells[3].x === 0.75 && cells[4].y === 0.5, JSON.stringify(cells[4]))
check('格子覆盖整图', cells.every((c) => c.w === 0.25 && c.h === 0.5))
check('按情绪取格', lib.cellForEmotion({ image: '/x.png', columns: 4, rows: 2, cells, source: 'generated', fingerprint: 'f' }, 'angry')?.x === 0.75)

const char = { lookEn: 'short black hair', palette: 'grey', keywords: ['coat'] }
const identity = lib.identityFingerprint(char)
const sheet = { image: '/sheet.png', columns: 4, rows: 2, cells, source: 'generated', fingerprint: identity }
for (const cell of sheet.cells) {
  cell.cropUrl = `/crop-${cell.emotion}.png`
  cell.cropFingerprint = lib.cropFingerprint(sheet, cell)
}
check('有效总图', lib.isSheetUsable(sheet, identity))
check('总图指纹变化', lib.sheetFingerprint(sheet) !== lib.sheetFingerprint({ ...sheet, cells: cells.map((c) => (c.emotion === 'happy' ? { ...c, x: 0.1 } : c)) }))
check('失效总图不可用', !lib.isSheetUsable({ ...sheet, stale: true }, identity))
check('身份变化不可用', !lib.isSheetUsable(sheet, 'different'))
check('缺一格不可用', !lib.isSheetUsable({ ...sheet, cells: cells.slice(0, 7) }, identity))

const sheetPick = lib.selectExpressionReference({ character: { ...char, expressionSheet: sheet }, emotion: 'happy' })
check('总图优先选单格', sheetPick.kind === 'sheet' && sheetPick.url === '/crop-happy.png', JSON.stringify(sheetPick))
const noCrop = { ...sheet, cells: sheet.cells.map((c) => (c.emotion === 'happy' ? { ...c, cropUrl: undefined } : c)) }
check('缺裁剪不发送总图', lib.selectExpressionReference({ character: { ...char, expressionSheet: noCrop }, emotion: 'happy' }).kind === 'none')
const staleWithLegacy = lib.selectExpressionReference({
  character: { ...char, expressionSheet: { ...sheet, stale: true }, expressions: { happy: { image: '/old.png', fingerprint: identity } } },
  emotion: 'happy',
})
check('总图失效不偷用旧图', staleWithLegacy.kind === 'none' && staleWithLegacy.reason.includes('失效'), JSON.stringify(staleWithLegacy))
const legacy = lib.selectExpressionReference({
  character: { ...char, expressions: { happy: { image: '/old.png', fingerprint: identity } } },
  emotion: 'happy',
})
check('无总图回退旧单图', legacy.kind === 'legacy' && legacy.url === '/old.png')
const staleLegacy = lib.selectExpressionReference({
  character: { ...char, expressions: { happy: { image: '/old.png', fingerprint: identity, stale: true } } },
  emotion: 'happy',
})
check('失效旧图回退文字', staleLegacy.kind === 'none')
check('无表情回退文字', lib.selectExpressionReference({ character: char, emotion: 'sad' }).kind === 'none')

const rect = lib.cropRectPixels({ x: 0.75, y: 0, w: 0.25, h: 0.5 }, 1000, 500)
check('裁剪像素坐标', rect.sx === 750 && rect.sy === 0 && rect.sw === 250 && rect.sh === 250, JSON.stringify(rect))
const project = lib.toProject({ id: 'A', name: 'A', role: '', lookCn: '', lookEn: char.lookEn, palette: char.palette, keywords: char.keywords, expressionSheet: sheet })
check('项目蛇形字段', Boolean(project.expression_sheet?.image) && project.expression_sheet?.cells?.[0]?.cropUrl === '/crop-neutral.png')
const back = lib.toSheet({ name: 'A', look_en: char.lookEn, palette: char.palette, keywords: char.keywords, expression_sheet: project.expression_sheet })
check('项目往返总图', back.expressionSheet?.image === '/sheet.png' && back.expressionSheet?.cells?.length === 8)
const legacyProject = lib.toProject({ id: 'A', name: 'A', role: '', lookCn: '', lookEn: char.lookEn, palette: char.palette, keywords: char.keywords, expressions: { happy: { image: '/old.png' } } })
check('旧 expressions 仍写项目', legacyProject.expressions?.happy?.image === '/old.png')

const shot = { no: 'S01', seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: 'p', marks: [] }
const withToggle = lib.nodeToShot({ ...shot, useExpressionRef: true }, 's1')
check('镜头开关写蛇形', withToggle.use_expression_ref === true)
const readToggle = lib.shotToData(withToggle, shot)
check('镜头开关读回', readToggle.useExpressionRef === true)
const oldShot = lib.shotToData({ id: 's1', no: 'S01' }, shot)
check('旧镜头默认关闭', oldShot.useExpressionRef === false)
const merged = lib.mergeGenerated([{ id: 's1', use_expression_ref: true }], [{ id: 's1' }])
check('重新拆镜保留开关', merged[0].use_expression_ref === true)
check('开关进入业务签名', lib.bizSignature({ ...shot, useExpressionRef: true }) !== lib.bizSignature({ ...shot, useExpressionRef: false }))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
