/**
 * 静帧出图与视频参考解耦：纯函数 + 轻量逻辑。
 * 跑法：node verify-shot-still-image-library.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'still-lib-'))
const entry = path.join(tmp, 'e.ts')
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(root, 'src/videoPrompt.ts'))}\n` +
    `export * from ${JSON.stringify(path.join(root, 'src/shotReferences.ts'))}`,
)
const bundle = path.join(tmp, 'b.mjs')
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${bundle}`,
  '--log-level=error',
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const schedule = { scene: null, blocking: null, duration: 5, ready: false, status: '', reason: '' }
const onlyPreview = {
  no: 'S01',
  seconds: 5,
  size: '中景',
  move: '固定',
  dialogue: '',
  prompt: 'x',
  marks: [],
  refImage: '/project-assets/demo/preview.png',
  refIds: [],
}
const reqPreview = lib.buildShotVideoRequest({
  data: onlyPreview,
  nodeId: 's1',
  nodes: [{ id: 's1', type: 'shot', data: onlyPreview }],
  characters: [],
  schedule,
})
check('仅有 refImage 无连线时 blocking', reqPreview.blocking.some((b) => b.code === 'no-image'))
check('附件不含 current', !reqPreview.refs.some((r) => r.source === 'current' || r.label.includes('当前画面')))
check('无隐式 firstFrame', reqPreview.firstFrame === null)

const withChar = {
  ...onlyPreview,
  refIds: ['char-甲'],
}
const charSheet = { id: '甲', name: '甲', role: '', lookCn: '', lookEn: 'x', palette: '', keywords: [], image: '/c.png' }
const reqChar = lib.buildShotVideoRequest({
  data: withChar,
  nodeId: 's1',
  nodes: [
    { id: 's1', type: 'shot', data: withChar },
    { id: 'char-甲', type: 'char', data: { name: '甲' } },
  ],
  characters: [charSheet],
  schedule,
})
check('连线角色后可出片', reqChar.blocking.every((b) => b.code !== 'no-image'))
check('图1 为角色', reqChar.refs[0]?.label.includes('甲'), reqChar.refs[0]?.label)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
