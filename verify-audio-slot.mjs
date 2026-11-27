/**
 * 音频槽位纯函数回归：连线音频素材进入槽位、非音频素材被跳过、悬空 id 不阻止出片。
 * 跑法：node verify-audio-slot.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-audio-slot-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, [`export * from ${abs('src/shotReferences.ts')}`].join('\n') + '\n')
const bundle = path.join(tmp, 'bundle.mjs')
const banner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--banner:js=${banner}`, `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const shot = (refIds) => ({ id: 'shot-1', type: 'shot', position: { x: 0, y: 0 }, data: { refIds } })
const asset = (id, kind, url, title) => ({
  id,
  type: 'asset',
  position: { x: 0, y: 0 },
  data: { kind, url, title },
})

// 1. 音频素材进入 refs
{
  const nodes = [shot(['asset-audio']), asset('asset-audio', 'audio', '/videos/voice.mp3', '陈默音色')]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes })
  check('音频素材进入音频槽位', r.refs.length === 1 && r.refs[0].url === '/videos/voice.mp3', JSON.stringify(r.refs))
  check('音频标签带素材标题', r.refs[0]?.label.includes('陈默音色'), r.refs[0]?.label)
  check('音频无误报缺失', r.missing.length === 0, JSON.stringify(r.missing))
}

// 2. 图片与视频素材被跳过
{
  const nodes = [
    shot(['asset-img', 'asset-vid']),
    asset('asset-img', 'image', '/generated/a.png', '场景'),
    asset('asset-vid', 'video', '/videos/b.mp4', '运镜'),
  ]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes })
  check('图片素材不进音频槽位', r.refs.length === 0, JSON.stringify(r.refs))
}

// 3. 音频按 url 去重、按 refIds 顺序
{
  const nodes = [
    shot(['asset-a1', 'asset-a2']),
    asset('asset-a1', 'audio', '/videos/x.mp3', 'A'),
    asset('asset-a2', 'audio', '/videos/x.mp3', 'A 副本'),
  ]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes })
  check('同 URL 音频去重', r.refs.length === 1, JSON.stringify(r.refs))
}

// 4. 悬空 id 不阻塞
{
  const nodes = [shot(['asset-gone'])]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes })
  check('悬空音频 id 不报缺失', r.refs.length === 0 && r.missing.length === 0, JSON.stringify(r.missing))
}

// 5. 无地址 / 文件缺失
{
  const nodes = [shot(['asset-noUrl']), asset('asset-noUrl', 'audio', '', '空音频')]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes })
  check('音频无地址报缺失', r.missing.length === 1 && r.missing[0].reason.includes('没有地址'), JSON.stringify(r.missing))
}
{
  const nodes = [shot(['asset-gone']), asset('asset-gone', 'audio', '/videos/gone.mp3', '删掉的音频')]
  const r = lib.collectAudioReferences({ node: nodes[0], nodes, missingMedia: new Set(['/videos/gone.mp3']) })
  check('音频文件缺失报缺失', r.missing.length === 1 && r.missing[0].reason.includes('文件缺失'), JSON.stringify(r.missing))
}

// 6. 无 refIds
{
  const r = lib.collectAudioReferences({ node: shot(undefined), nodes: [shot(undefined)] })
  check('无 refIds 返回空集合', r.refs.length === 0 && r.missing.length === 0)
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
