/**
 * 原生音频纯函数回归：能力门、单说话人、4 秒下限、音色样本、提示词、指纹。
 * 跑法：node verify-native-audio.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-native-audio-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, [`export * from ${abs('src/nativeAudio.ts')}`, `export * from ${abs('src/videoSeconds.ts')}`, `export * from ${abs('server/apimart.mjs')}`].join('\n') + '\n')
const bundle = path.join(tmp, 'bundle.mjs')
// esbuild 把 CJS 依赖（undici）打进 ESM 时，`__require` 在纯 ESM 里没有兜底，
// 运行时报 "Dynamic require of node:assert is not supported"。这里给它一个真的
// require，否则脚本连打包产物都 import 不进来，纯函数断言根本跑不到。
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
const sample = { url: '/project-assets/p/voice.mp3', text: '试音', seconds: 8, engine: 'mock', voiceId: 'v1', fingerprint: 'f', stale: false }
const characters = [{ id: '陈默', name: '陈默', role: '', lookCn: '', lookEn: '', palette: '', keywords: [], voiceId: 'v1', voiceSample: sample }]
const dialogue = [{ speaker: '陈默', text: '你来了。' }]
const caps = lib.audioRefCapabilitiesFor({ providerKind: 'apimart', model: 'seedance-2.5', audioOut: true })
const other = lib.audioRefCapabilitiesFor({ providerKind: 'ark', model: 'seedance-2.5', audioOut: true })

check('APIMart Seedance 2.5 能力', caps?.audioRefField === 'audio_url' && caps.maxRefAudios === 1 && caps.minVideoSeconds === 4)
check('其他渠道不开放', other === null)
check('4s 原生音频保持 4s（含边界合法）', lib.shotRequestSeconds({ seconds: 4, nativeAudio: true, nativeAudioMinVideoSeconds: caps.minVideoSeconds }).seconds === 4)
check('4.2s 原生音频保持 4s', lib.shotRequestSeconds({ seconds: 4.2, modelId: 'seedance-2.5', nativeAudio: true, nativeAudioMinVideoSeconds: caps.minVideoSeconds }).seconds === 4)
check('4.4s 原生音频保持 4s', lib.shotRequestSeconds({ seconds: 4.4, modelId: 'seedance-2.5', nativeAudio: true, nativeAudioMinVideoSeconds: caps.minVideoSeconds }).seconds === 4)
let r = lib.nativeAudioRef({ dialogue, characters, caps, seconds: 5 })
check('单说话人可用', r.ok && r.kind === 'reference' && r.character === '陈默' && r.url === sample.url)
r = lib.nativeAudioRef({ dialogue, characters, caps, seconds: 4 })
check('4 秒整可提交（含边界）', r.ok, r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue, characters, caps, seconds: 2 })
check('2 秒禁用', !r.ok && r.reason.includes('最短 4 秒'), r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue: [...dialogue, { speaker: '林岚', text: '我不该来。' }], characters, caps, seconds: 5 })
check('双说话人降级为无参考而非拦阻', r.ok && r.kind === 'no-reference' && r.reason.includes('多个说话人'), r.ok ? r.kind : r.reason)
// 失效样本按无参考提交（spec：「失效样本视同没有样本」），不是拦阻
r = lib.nativeAudioRef({ dialogue, characters: [{ ...characters[0], voiceSample: { ...sample, stale: true } }], caps, seconds: 5 })
check('失效样本转为无参考而非拦阻', r.ok && r.kind === 'no-reference' && r.reason.includes('失效'), r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue, characters: [{ ...characters[0], voiceSample: { ...sample, seconds: 1.2 } }], caps, seconds: 5 })
check('样本不合规降级为无参考而非拦阻', r.ok && r.kind === 'no-reference' && r.reason.includes('2-30'), r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue, characters: [{ ...characters[0], voiceSample: { ...sample, url: '' } }], caps, seconds: 5 })
check('样本缺音频文件转为无参考', r.ok && r.kind === 'no-reference', r.ok ? r.kind : r.reason)

// 无声镜：没有台词不等于不能用音色参考（音色只约束声音，不依赖台词）
r = lib.nativeAudioRef({ dialogue: [], characters, caps, seconds: 5, preferredCharacter: '陈默' })
check('无台词 + 已存角色可用', r.ok && r.kind === 'reference' && r.character === '陈默', r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue: [], characters, caps, seconds: 5 })
check('无台词无已选角色时取首个可用样本', r.ok && r.kind === 'reference' && r.character === '陈默', r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue: [], characters: [], caps, seconds: 5 })
check('无台词且无任何角色时可提交无参考', r.ok && r.kind === 'no-reference' && r.reason.includes('音色样本'), r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({ dialogue: [], characters, caps, seconds: 5, preferredCharacter: '林岚' })
check('已存角色不在角色库时降级并说明', r.ok && r.kind === 'no-reference' && r.reason.includes('不在角色库'), r.ok ? r.kind : r.reason)
r = lib.nativeAudioRef({
  dialogue: [{ speaker: '陈默', text: '' }],
  characters,
  caps,
  seconds: 5,
})
check('空文本行不算说话人', r.ok && r.character === '陈默', r.ok ? r.kind : r.reason)

const prompt = lib.nativeAudioPrompt('陈默', dialogue, true)
check('提示词含逐字台词', prompt.includes('陈默说：“你来了。”'))
check('提示词含音色参考音频1', prompt.includes('音色参考音频1'))
check('不声称原样播放', !prompt.includes('原样播放'))
check('无台词返回空', lib.nativeAudioPrompt('陈默', [], true) === '')

const f1 = lib.nativeAudioFingerprint({ modelKey: 'k', audioRef: { character: '陈默', url: sample.url }, dialogue })
const f2 = lib.nativeAudioFingerprint({ modelKey: 'k', audioRef: { character: '陈默', url: '/other.mp3' }, dialogue })
const f3 = lib.nativeAudioFingerprint({ modelKey: 'k2', audioRef: { character: '陈默', url: sample.url }, dialogue })
check('换音频指纹变化', f1 !== f2)
check('换模型指纹变化', f1 !== f3)
check('未变化指纹稳定', f1 === lib.nativeAudioFingerprint({ modelKey: 'k', audioRef: { character: '陈默', url: sample.url }, dialogue }))

// APIMart builder：单 audio_url 字符串 + generate_audio；4 秒合法、2 秒 native 拒绝
try {
  const payload = lib.buildVideoPayload({
    family: 'seedance-2.5',
    model: 'seedance-2.5',
    prompt: 'test',
    seconds: 5,
    resolution: '480p',
    ratio: '16:9',
    referenceImages: ['https://example.com/a.jpg'],
    audioUrl: 'data:audio/mpeg;base64,AAAA',
    generateAudio: true,
  })
  check('payload 使用 audio_url 字符串', payload.audio_url === 'data:audio/mpeg;base64,AAAA')
  check('payload 开启 generate_audio', payload.generate_audio === true)
  check('payload 不出现 reference_audio', !('reference_audio' in payload) && !('audio_urls' in payload))
} catch (e) {
  check('native payload 构建', false, e.message)
}
// 无音色参考：generate_audio 照发，audio_url 键不出现（2026-11-22 实测通过）
try {
  const payload = lib.buildVideoPayload({
    family: 'seedance-2.5',
    model: 'seedance-2.5',
    prompt: 'test',
    seconds: 4,
    resolution: '480p',
    ratio: '16:9',
    referenceImages: ['https://example.com/a.jpg'],
    generateAudio: true,
  })
  check('无参考 payload 开启 generate_audio', payload.generate_audio === true)
  check('无参考 payload 不带 audio_url 键', !('audio_url' in payload), JSON.stringify(payload))
  check('4 秒无参考 payload 合法', payload.duration === 4, String(payload.duration))
} catch (e) {
  check('无参考 payload 构建', false, e.message)
}
try {
  lib.buildVideoPayload({
    family: 'seedance-2.5', model: 'seedance-2.5', prompt: 'test', seconds: 2,
    resolution: '480p', ratio: '16:9', audioUrl: 'data:audio/mpeg;base64,AAAA', generateAudio: true,
  })
  check('2 秒 native 被拒绝', false)
} catch (e) {
  check('2 秒 native 被拒绝', String(e.message).includes('最短 4 秒'), e.message)
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
