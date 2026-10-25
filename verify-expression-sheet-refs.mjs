/**
 * 表情总图参考解析：总图单格优先、旧图回退、stale/缺文件回退、画布总图卡不整图发送。
 * 跑法：node verify-expression-sheet-refs.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-expression-refs-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/shotReferences.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/expressionSheet.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/characters.ts'))}`,
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

const char = { id: 'A', name: '林岚', image: '/identity.png', lookEn: 'short black hair', palette: 'grey', keywords: ['coat'] }
const identity = lib.identityFingerprint(char)
const sheet = { image: '/sheet.png', columns: 4, rows: 2, cells: lib.buildExpressionSheetCells(), source: 'generated', fingerprint: identity }
for (const cell of sheet.cells) {
  cell.cropUrl = `/crop-${cell.emotion}.png`
  cell.cropFingerprint = lib.cropFingerprint(sheet, cell)
}
const withSheet = { ...char, expressionSheet: sheet }
const base = {
  no: 'S01', seconds: 3, size: '中景', move: '固定', dialogue: '林岚：别走。',
  prompt: 'p', marks: [], cast: ['林岚'], performance: [{ character: '林岚', emotion: 'angry', intensity: 3, speaks: true }],
}
const node = { id: 's1', type: 'shot', position: { x: 0, y: 0 }, data: base }

const refs = lib.collectShotReferences({ node, nodes: [node], characters: [withSheet] })
const expr = refs.refs.find((r) => r.source === 'expression')
check('总图单格进入参考', expr?.url === '/crop-angry.png', JSON.stringify(refs.refs))
check('单格带角色与情绪', expr?.character === '林岚' && expr?.emotion === 'angry')
check('总图本身不进入参考', refs.refs.every((r) => r.url !== '/sheet.png'))
check('表情先于身份', refs.refs[0]?.source === 'expression' && refs.refs[1]?.source === 'character', refs.refs.map((r) => r.source).join(','))

const stale = { ...withSheet, expressionSheet: { ...sheet, stale: true } }
const staleRefs = lib.collectShotReferences({ node, nodes: [node], characters: [stale] })
check('失效总图不发送', staleRefs.refs.every((r) => r.source !== 'expression'))

const missingRefs = lib.collectShotReferences({
  node,
  nodes: [node],
  characters: [withSheet],
  missingMedia: new Set(['/crop-angry.png']),
})
check('缺文件单格跳过', missingRefs.refs.every((r) => r.url !== '/crop-angry.png'))

const legacyChar = { ...char, expressions: { angry: { image: '/old-angry.png', fingerprint: identity } } }
const legacyRefs = lib.collectShotReferences({ node, nodes: [node], characters: [legacyChar] })
check('无总图回退旧单图', legacyRefs.refs.find((r) => r.source === 'expression')?.url === '/old-angry.png')

const sheetAsset = {
  id: 'asset-sheet', type: 'asset', position: { x: 0, y: 0 },
  data: { title: '林岚 · 表情总图', kind: 'expression-sheet', url: '/sheet.png', characterName: '林岚' },
}
const linked = { ...base, refIds: ['asset-sheet'], performance: [] }
const linkedRefs = lib.collectShotReferences({ node: { ...node, data: linked }, nodes: [node, sheetAsset], characters: [withSheet] })
check('画布总图卡不整图发送', linkedRefs.refs.every((r) => r.url !== '/sheet.png'), JSON.stringify(linkedRefs.refs))
check('无表演时没有单格', linkedRefs.refs.every((r) => r.source !== 'expression'))

const linkedWithPerformance = { ...linked, performance: [{ character: '林岚', emotion: 'happy', intensity: 2, speaks: true }] }
const linkedPerfRefs = lib.collectShotReferences({ node: { ...node, data: linkedWithPerformance }, nodes: [node, sheetAsset], characters: [withSheet] })
check('连线后仍按表演取单格', linkedPerfRefs.refs.find((r) => r.source === 'expression')?.url === '/crop-happy.png')
check('连线后不出现整图', linkedPerfRefs.refs.every((r) => r.url !== '/sheet.png'))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
