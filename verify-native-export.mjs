/**
 * 原生音频预览/导出纯函数回归：buildPlaylist 选择 native/tts/none。
 * 跑法：node verify-native-export.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-native-export-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export { buildPlaylist } from ${abs('src/Preview.tsx')}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--loader:.tsx=tsx', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const node = (id, no, extra) => ({ id, type: 'shot', data: { no, seconds: 4, size: '中景', move: '固定', dialogue: '', prompt: '', marks: [], episode: 1, shotId: `E01-${no}`, ...extra } })
const native = node('n1', 'S01', { videoUrl: '/videos/native.mp4', voiceUrl: '/voices/tts.mp3', audioMode: 'native' })
const tts = node('n2', 'S02', { videoUrl: '/videos/off.mp4', voiceUrl: '/voices/tts.mp3', audioMode: 'off' })
const silent = node('n3', 'S03', { refImage: '/generated/a.jpg', audioMode: 'off' })
const items = lib.buildPlaylist([native, tts, silent], [])
check('native 镜头 audio=native', items[0].audio === 'native')
check('native 不传 TTS', items[0].voice === undefined)
check('off 镜头 audio=tts', items[1].audio === 'tts' && items[1].voice === '/voices/tts.mp3')
check('无配音镜头 audio=none', items[2].audio === 'none')
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
