/**
 * 音色目录纯函数回归：能力矩阵、自定义合并、MiniMax 分类、分组、显式不回落。
 * 跑法：node verify-voice-catalog.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-voice-catalog-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, 'src/voiceCatalog.ts'))}\n`)
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
const entryOf = (id, source = 'preset') => lib.entryOf({ id, label: id, provider: 'apimart', providerKind: 'apimart', modelKey: 'm', source })

check('MiniMax 自定义能力', lib.voiceCapabilitiesForKind('minimax').supportsCustomVoiceId)
check('ElevenLabs 自定义能力', lib.voiceCapabilitiesForKind('elevenlabs').supportsCustomVoiceId)
check('火山自定义能力', lib.voiceCapabilitiesForKind('volc-tts').supportsCustomVoiceId)
check('APIMart 不能自定义', !lib.voiceCapabilitiesForKind('apimart').supportsCustomVoiceId)
check('macOS 不能自定义', !lib.voiceCapabilitiesForKind('macos-say').supportsCustomVoiceId)

const caps = lib.voiceCapabilitiesForKind('minimax')
const merged = lib.mergeCustomVoices([entryOf('alloy')], [{ id: 'c1', label: '我的', provider: 'apimart', modelKey: 'm', voiceId: 'mine', createdAt: 'x' }], {
  provider: 'apimart', providerKind: 'apimart', modelKey: 'm', capabilities: caps,
})
check('自定义条目合并', merged.some((v) => v.voiceId === 'mine' && v.source === 'custom'))
const volcCustom = lib.mergeCustomVoices([], [{ id: 'v1', label: '火山自定义', provider: 'volc', voiceId: 'speaker-x', createdAt: 'x' }], {
  provider: 'volc', providerKind: 'volc-tts', modelKey: 'volc-tts', capabilities: lib.voiceCapabilitiesForKind('volc-tts'),
})
check('火山自定义 speaker 标未验证', volcCustom[0]?.note?.includes('未验证'), volcCustom[0]?.note)
const ignored = lib.mergeCustomVoices([entryOf('alloy')], [{ id: 'c1', label: '我的', provider: 'apimart', modelKey: 'm', voiceId: 'mine', createdAt: 'x' }], {
  provider: 'apimart', providerKind: 'apimart', modelKey: 'm', capabilities: lib.voiceCapabilitiesForKind('apimart'),
})
check('不支持渠道忽略自定义', ignored.every((v) => v.voiceId !== 'mine'))

const mini = lib.miniMaxVoicesFromResponse({
  system_voice: [{ voice_id: 'sys', name: '系统' }],
  voice_cloning: [{ voice_id: 'clone', name: '克隆' }],
  voice_generation: [{ voice_id: 'design', name: '设计' }],
}, { provider: 'minimax', providerKind: 'minimax', modelKey: 'minimax-tts' })
check('MiniMax 三类来源', mini.some((v) => v.source === 'preset') && mini.some((v) => v.source === 'clone') && mini.some((v) => v.source === 'design'))
const grouped = lib.groupVoices([entryOf('a', 'custom'), entryOf('b', 'preset')])
check('来源分组', grouped.length === 2 && grouped.every((g) => g.voices.length === 1))
const normalized = lib.normalizeCustomVoices([{ provider: 'p', voiceId: 'v', label: 'L' }, { provider: 'p', voiceId: 'v', label: 'dup' }, { provider: 'p' }])
check('自定义去重/丢弃空', normalized.length === 1 && normalized[0].label === 'L')

const explicit = lib.resolveVoiceForSpeaker({ character: { voiceId: 'custom', voiceProvider: 'minimax' }, currentProviderId: 'minimax', fallbackVoice: 'default' })
check('显式音色优先', explicit.ok && explicit.voice === 'custom')
const fallback = lib.resolveVoiceForSpeaker({ character: {}, currentProviderId: 'minimax', fallbackVoice: 'default' })
check('未指定回落默认', fallback.ok && fallback.voice === 'default')
const mismatch = lib.resolveVoiceForSpeaker({ character: { voiceId: 'custom', voiceProvider: 'minimax' }, currentProviderId: 'elevenlabs', fallbackVoice: 'default' })
check('渠道不匹配报错', !mismatch.ok && mismatch.reason.includes('渠道'))
const none = lib.resolveVoiceForSpeaker({})
check('无音色报错', !none.ok)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
