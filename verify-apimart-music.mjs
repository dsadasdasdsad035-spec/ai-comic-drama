/**
 * Flow Music 纯函数：任务结果解析与模型判定
 * 跑法：node verify-apimart-music.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-apimart-music-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  `export * from ${abs('src/assetCardGeneration.ts')}\nexport { musicUrlFromTask } from ${abs('server/apimart.mjs')}\n`,
)
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

check(
  '识别 flowmusic',
  lib.isMusicAudioModel({ key: 'x', cap: 'audio', provider: 'apimart', model: 'flowmusic' }),
)
check(
  'TTS 不是音乐',
  !lib.isMusicAudioModel({ key: 'x', cap: 'audio', provider: 'minimax', model: 'speech-2.8-hd' }),
)

const url = lib.musicUrlFromTask({
  result: { music: [{ audio_url: 'https://cdn/a.m4a', wav_url: 'https://cdn/a.wav' }] },
})
check('解析 audio_url', url === 'https://cdn/a.m4a', url)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)