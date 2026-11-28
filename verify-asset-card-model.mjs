/**
 * 素材卡生成所用模型键解析与就绪判断（纯函数）
 * 跑法：node verify-asset-card-model.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-asset-card-model-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  `export * from ${abs('src/assetCardGeneration.ts')}\n`,
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

const settings = {
  defaults: { image: 'img-def', audio: 'aud-def' },
  models: [
    { key: 'img-def', cap: 'image', provider: 'p', model: 'm', runtime: 'live' },
    { key: 'img-pick', cap: 'image', provider: 'p', model: 'm2', runtime: 'live' },
    { key: 'aud-def', caps: ['audio'], provider: 'p', model: 'v', runtime: 'live' },
    { key: 'music-stub', caps: ['audio'], provider: 'p', model: 'suno', runtime: 'catalog-only' },
  ],
}

check('手选图像键优先于默认', lib.resolveImageModelKey('img-pick', settings) === 'img-pick')
check('未手选时回落图像默认', lib.resolveImageModelKey('', settings) === 'img-def')
check('未手选时回落音频默认', lib.resolveAudioModelKey(undefined, settings) === 'aud-def')

const imgOk = lib.imageModelReady('img-def', settings.models)
check('默认图像模型可提交', imgOk.ok === true)

const audOk = lib.audioModelReady('aud-def', settings.models)
check('默认音频模型可提交', audOk.ok === true)

const stub = lib.audioModelReady('music-stub', settings.models)
check('未接入音频拒绝', stub.ok === false && stub.reason.includes('尚未接入'), stub.reason)

check('无效图像键', lib.imageModelReady('nope', settings.models).reason.includes('无效'))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 素材卡模型解析全部通过')
process.exit(bad ? 1 : 0)