/**
 * 分镜 → 音频/字幕卡：纯函数（连线 id、文案合并、解析边）
 * 跑法：node verify-asset-shot-prompt-ref.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-shot-prompt-ref-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export * from ${abs('src/assetShotPromptRef.ts')}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
const banner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--log-level=error',
  `--banner:js=${banner}`,
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

check('audio 接受分镜引用', lib.assetAcceptsShotPromptRef('audio'))
check('subtitle 接受分镜引用', lib.assetAcceptsShotPromptRef('subtitle'))
check('image 不接受', !lib.assetAcceptsShotPromptRef('image'))

const nodes = [
  { id: 'shot-a', type: 'shot', data: { no: '01', dialogue: '你好', videoPrompt: '特写' } },
  { id: 'shot-b', type: 'shot', data: { no: '02', dialogue: '再见', videoPrompt: '远景' } },
  { id: 'asset-1', type: 'asset', data: {} },
]
const slices = lib.resolveShotsFromSourceIds(nodes, ['shot-b', 'shot-a'])
check('按 sourceShotIds 解析', slices.length === 2 && slices[0].id === 'shot-b' && slices[1].id === 'shot-a')

const merged = lib.buildAssetAudioPrompt({
  prompt: '前缀',
  field: 'dialogue',
  shots: slices,
})
check('音频文案合并', merged === '前缀\n\n再见\n\n你好', merged)

const eid = lib.shotPromptRefEdgeId('shot-a', 'asset-xy')
check('边 id', eid === 'ref-shot-shot-a--asset-xy', eid)
const parsed = lib.parseShotPromptRefEdgeId(eid)
check('解析边', parsed?.shotId === 'shot-a' && parsed?.assetId === 'asset-xy', JSON.stringify(parsed))
const legacy = lib.parseShotPromptRefEdgeId('ref-shot-shot-a-asset-xy')
check('旧边 id 兼容', legacy?.shotId === 'shot-a' && legacy?.assetId === 'asset-xy', JSON.stringify(legacy))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)