/**
 * 出片请求时长求解回归：唯一入口 shotRequestSeconds。
 * 跑法：node verify-shot-seconds.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-shot-seconds-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/videoSeconds.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/videoPrompt.ts'))}`,
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

const D25 = 'seedance-2.5'
const NATIVE = { nativeAudio: true, nativeAudioMinVideoSeconds: 4 }

// 原生音频：门槛是含边界的 4 秒（实测 duration:4 合法），不再 +1 抬到 5
let r = lib.shotRequestSeconds({ seconds: 4.2, modelId: D25, ...NATIVE })
check('4.2s + 原生音频 = 4 且无抬升', r.seconds === 4 && r.floor === null, JSON.stringify(r))
r = lib.shotRequestSeconds({ seconds: 4.0, modelId: D25, ...NATIVE })
check('4.0s + 原生音频 = 4 且无抬升', r.seconds === 4 && r.floor === null, JSON.stringify(r))
r = lib.shotRequestSeconds({ seconds: 4.4, modelId: D25, ...NATIVE })
check('4.4s + 原生音频 = 4 且无抬升', r.seconds === 4 && r.floor === null, JSON.stringify(r))
// 原生门槛高于模型下限时才由它抬升（Seedance 2.5 两者都是 4，抬升原因归 model-min）
r = lib.shotRequestSeconds({ seconds: 2.6, ...NATIVE })
check('2.6s + 原生门槛 4 抬到 4 且原因是原生音频', r.seconds === 4 && r.floor?.kind === 'native-audio' && r.floor.min === 4, JSON.stringify(r))
r = lib.shotRequestSeconds({ seconds: 5, modelId: D25, ...NATIVE })
check('5s + 原生音频保持 5 且无抬升', r.seconds === 5 && r.floor === null, JSON.stringify(r))
r = lib.shotRequestSeconds({ seconds: 6.6, modelId: D25, ...NATIVE })
check('6.6s + 原生音频 = 7 且无抬升', r.seconds === 7 && r.floor === null, JSON.stringify(r))

// 模型下限
r = lib.shotRequestSeconds({ seconds: 3, modelId: D25 })
check('3s + Seedance 2.5 下限 4 = 4', r.seconds === 4 && r.floor?.kind === 'model-min')
r = lib.shotRequestSeconds({ seconds: 3, modelId: 'kling-v3' })
check('3s + Kling v3 下限 3 保持 3', r.seconds === 3 && r.floor === null, JSON.stringify(r))
r = lib.shotRequestSeconds({ seconds: 1, modelId: 'kling-v3' })
check('1s + Kling v3 先夹 2 再抬到下限 3', r.seconds === 3 && r.floor?.kind === 'model-min', JSON.stringify(r))

// 未登记模型：只取整与夹取
r = lib.shotRequestSeconds({ seconds: 2.6, modelId: 'unknown-model' })
check('未知模型 2.6s = 3', r.seconds === 3 && r.floor === null)
r = lib.shotRequestSeconds({ seconds: 0.4 })
check('0.4s = 2', r.seconds === 2 && r.floor === null)
r = lib.shotRequestSeconds({ seconds: 20 })
check('20s 夹到 12', r.seconds === 12 && r.floor === null)

// 无能力信息时不做原生音频抬升
r = lib.shotRequestSeconds({ seconds: 3, modelId: 'unknown-model', nativeAudio: true })
check('无音频能力信息只套模型下限', r.seconds === 3 && r.floor === null, JSON.stringify(r))

// 区间与文案
check('Seedance 2.5 上限 30', lib.videoMaxSeconds(D25) === 30)
check('Kling v3 上限 15', lib.videoMaxSeconds('kling-v3') === 15)
check('未知模型上限退回 12', lib.videoMaxSeconds('unknown-model') === 12)
check('原生音频说明', lib.secondsFloorReason({ kind: 'native-audio', value: 4, min: 4 }).includes('最短 4'))
check('模型下限说明', lib.secondsFloorReason({ kind: 'model-min', value: 4, min: 4 }).includes('下限 4'))
check('无抬升无文案', lib.secondsFloorReason(null) === '')

// 拼装器只解一次：请求秒数与返回值同源，原生音频不再自证通过
const sample = { url: '/project-assets/p/voice.mp3', text: '试音', seconds: 8, engine: 'mock', voiceId: 'v1', fingerprint: 'f', stale: false }
const characters = [{ id: '陈默', name: '陈默', role: '', lookCn: '', lookEn: '', palette: '', keywords: [], image: '/generated/char-chen.jpg', voiceId: 'v1', voiceSample: sample }]
const model = { key: 'apimart-seedance-2.5', model: 'seedance-2.5', providerKind: 'apimart', audioOut: true, supportsVideoRef: true }
const shotData = (seconds) => ({
  no: 'S01', seconds, size: '中景', move: '推', dialogue: '陈默：你来了。', prompt: '雨夜摊位',
  videoPrompt: '镜头缓慢前推', refIds: ['char-陈默'], refExtras: [], marks: [], candidates: [],
  prodKind: 'video', audioMode: 'native', performance: [], dialogueDelivery: [],
})
const build = (seconds) =>
  lib.buildShotVideoRequest({
    data: shotData(seconds),
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: shotData(seconds) }],
    characters,
    model,
    resolution: '720p',
  })

let req = build(4.2)
check('4.2s 原生音频请求 4s', req.seconds === 4, JSON.stringify({ seconds: req.seconds, shotSeconds: req.shotSeconds }))
check('同时带回镜头时长 4.2s', req.shotSeconds === 4.2)
check('4.2s 原生音频不阻止且带音色参考', req.blocking.length === 0 && req.audio?.slot === 'audio', req.blocking.map((b) => b.message).join(';'))

req = build(4.0)
check('4.0s 原生音频请求 4s 且不阻止', req.seconds === 4 && req.blocking.length === 0, JSON.stringify({ seconds: req.seconds, blocking: req.blocking.map((b) => b.code) }))
req = build(5)
check('5s 原生音频请求保持 5s', req.seconds === 5 && req.secondsFloor === null)

const silent = lib.buildShotVideoRequest({
  data: { ...shotData(3), audioMode: 'off' },
  nodeId: 'n1',
  nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: { ...shotData(3), audioMode: 'off' } }],
  characters,
  model,
  resolution: '720p',
})
check('3s 静音 + Seedance 2.5 请求 4s', silent.seconds === 4 && silent.secondsFloor?.kind === 'model-min')

/**
 * 没有可用音色样本时仍然出**带声音**的视频。
 *
 * 音色参考只是音轨的增强项：拿不到样本不该把「出片」整条堵死，也不该把
 * 「有没有声音」一起丢掉。2026-11-22 实测确认 `generate_audio:true` 不带
 * `audio_url` 能出片且会念台词，所以这里钉住新语义——不阻塞、仍走 native
 * 模式、没有 audio 附件、给出 no-reference warn，时长仍按原生门槛（含 4）。
 */
const noSample = { ...characters[0], voiceSample: undefined }
const buildNoSample = (seconds) =>
  lib.buildShotVideoRequest({
    data: shotData(seconds),
    nodeId: 'n1',
    nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: shotData(seconds) }],
    characters: [noSample],
    model,
    resolution: '720p',
  })

const degraded = buildNoSample(4.2)
check('无音色样本不阻塞出片', degraded.blocking.length === 0, degraded.blocking.map((b) => b.message).join(';'))
check('无音色样本仍走 native', degraded.mode === 'native', degraded.mode)
check('无音色样本不带 audio 附件', degraded.audio === null)
check(
  '无音色样本给出 no-reference warn',
  degraded.warnings.some((w) => w.code === 'native-no-reference'),
  degraded.warnings.map((w) => w.code).join(','),
)
check(
  '无音色样本不再报 degraded',
  !degraded.warnings.some((w) => w.code === 'native-degraded'),
  degraded.warnings.map((w) => w.code).join(','),
)
check('无音色样本时长按原生门槛（4）', degraded.seconds === 4, String(degraded.seconds))

// 零角色卡 + 无台词的纯空镜：没有任何可判定的说话人，照样能走 native
const bareShot = { ...shotData(6), refIds: [], dialogue: '' }
const noChars = lib.buildShotVideoRequest({
  data: bareShot,
  nodeId: 'n1',
  nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: bareShot }],
  characters: [],
  model,
  resolution: '720p',
})
check(
  '零角色卡空镜不因音色缺失阻塞',
  !noChars.blocking.some((b) => b.code === 'native-unavailable'),
  noChars.blocking.map((b) => b.code).join(','),
)
check('零角色卡空镜仍走 native 且无 audio 附件', noChars.mode === 'native' && noChars.audio === null, noChars.mode)

/**
 * 台词点名了一个角色库里没有的说话人：这是数据不一致，不是「没有样本」。
 * 猜不出该用谁的音色，也不该静默按无参考出片——明确拦下让人先补角色卡。
 */
const missingCard = { ...shotData(6), refIds: [] }
const noCardHit = lib.buildShotVideoRequest({
  data: missingCard,
  nodeId: 'n1',
  nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: missingCard }],
  characters: [],
  model,
  resolution: '720p',
})
check(
  '说话人不在角色库时降级并说明',
  noCardHit.mode !== 'native' && noCardHit.warnings.some((w) => w.code === 'native-degraded'),
  noCardHit.warnings.map((w) => w.code).join(','),
)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
