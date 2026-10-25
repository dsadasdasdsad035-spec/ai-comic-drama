/**
 * 角色表情参考回归：身份/表情分离、往返、参考排序、失效与超限。
 * 跑法：node verify-expression.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-expression-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/characters.ts')}`,
    `export * from ${abs('src/charMap.ts')}`,
    `export * from ${abs('src/shotReferences.ts')}`,
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

const char = {
  id: '林岚', name: '林岚', role: '主角', lookCn: '黑发', lookEn: 'black hair, grey coat',
  palette: '灰', keywords: ['短发'], image: '/char.png',
}
const fp = lib.identityFingerprint(char)
const sheet = { ...char, expressions: { happy: { image: '/happy.png', candidates: ['/happy.png', '/happy2.png'], activeIdx: 1, source: 'generated', fingerprint: fp } } }

check('身份指纹不包含表情', lib.identityFingerprint(char) === lib.identityFingerprint({ ...char, expressions: sheet.expressions }))
const stale = lib.markExpressionsStale(sheet.expressions)
check('身份变化标 stale 且保留图片', stale.happy.stale === true && stale.happy.image === '/happy.png')

const project = lib.toProject(sheet)
check('项目往返：表情字段', project.expressions?.happy?.image === '/happy.png' && project.expressions?.happy?.activeIdx === 1)
const back = lib.toSheet(project)
check('项目往返：读回表情', back.expressions?.happy?.candidates?.length === 2)

const node = {
  id: 'n1', type: 'shot',
  data: {
    no: 'S01', seconds: 3, size: '中景', move: '固定', dialogue: '林岚：你来了。', prompt: '', marks: [],
    cast: ['林岚'], refIds: [],
    performance: [{ character: '林岚', emotion: 'happy', intensity: 3, speaks: true, action: '抬眼' }],
  },
}
const collected = lib.collectShotReferences({ node, nodes: [node], characters: [back] })
check('参考排序：表情先于身份', collected.refs[0]?.source === 'expression' && collected.refs[1]?.source === 'character', collected.refs.map((r) => r.source).join(','))
check('表情标签可读', collected.refs[0]?.label.includes('表情') && collected.refs[0]?.label.includes('喜'))

const staleChar = { ...back, expressions: { happy: { ...back.expressions.happy, stale: true } } }
const skipped = lib.collectShotReferences({ node, nodes: [node], characters: [staleChar] })
check('失效表情不发送', skipped.refs.every((r) => r.source !== 'expression'))

const limited = lib.limitReferences(collected.refs, 1)
check('超限报告 omitted', limited.used.length === 1 && limited.omitted.length >= 1)

const noExpr = lib.collectShotReferences({ node, nodes: [node], characters: [{ ...back, expressions: undefined }] })
check('没有表情回退身份图', noExpr.refs.some((r) => r.source === 'character') && noExpr.refs.every((r) => r.source !== 'expression'))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
