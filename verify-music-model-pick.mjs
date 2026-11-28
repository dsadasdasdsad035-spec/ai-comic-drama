/**
 * 音乐 / 配音 modelPick 与模型列表过滤
 * 跑法：node verify-music-model-pick.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-music-pick-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export * from ${abs('src/assetCardGeneration.ts')}\n`)
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

const models = [
  { key: 'minimax-tts', cap: 'audio', caps: ['audio'], provider: 'minimax', model: 'speech', source: 'preset' },
  {
    key: 'apimart-music-flowmusic',
    cap: 'audio',
    caps: ['audio'],
    provider: 'apimart',
    model: 'flowmusic',
    source: 'preset',
    features: { music: true },
  },
]

const voice = lib.audioModelReady('minimax-tts', models)
const rejectMusic = lib.audioModelReady('apimart-music-flowmusic', models)
const musicOk = lib.musicModelReady('apimart-music-flowmusic', models)

let bad = 0
const check = (n, c) => {
  console.log(`${c ? '✅' : '❌'} ${n}`)
  if (!c) bad++
}

check('配音模型可用', voice.ok)
check('音乐模型不能走配音', !rejectMusic.ok)
check('音乐模型可用', musicOk.ok)
check('music 默认键解析', lib.resolveMusicModelKey('', { defaults: { music: 'apimart-music-flowmusic' } }) === 'apimart-music-flowmusic')
check('手选 music 不影响 audio 解析', lib.resolveAudioModelKey('minimax-tts', { defaults: { audio: 'x', music: 'apimart-music-flowmusic' } }) === 'minimax-tts')

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)