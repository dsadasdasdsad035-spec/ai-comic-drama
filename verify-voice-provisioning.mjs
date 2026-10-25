/**
 * 音色创建能力门：哪些渠道能自定义/克隆/设计，哪些只能预置。
 * 跑法：node verify-voice-provisioning.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-voice-prov-'))
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
const mm = lib.voiceCapabilitiesForKind('minimax')
const el = lib.voiceCapabilitiesForKind('elevenlabs')
const volc = lib.voiceCapabilitiesForKind('volc-tts')
const ap = lib.voiceCapabilitiesForKind('apimart')
const mac = lib.voiceCapabilitiesForKind('macos-say')

check('MiniMax 可自定义', mm.supportsCustomVoiceId)
check('ElevenLabs 可自定义', el.supportsCustomVoiceId)
check('火山可自定义', volc.supportsCustomVoiceId)
check('APIMart 不可自定义/克隆/设计', !ap.supportsCustomVoiceId && !ap.supportsClone && !ap.supportsDesign)
check('macOS 不可自定义/克隆/设计', !mac.supportsCustomVoiceId && !mac.supportsClone && !mac.supportsDesign)
check('创建能力当前未探测通过', !mm.supportsClone && !mm.supportsDesign && !el.supportsClone && !volc.supportsClone)
check('所有渠道支持试听', [mm, el, volc, ap, mac].every((x) => x.supportsPreview))
check('来源标签完整', lib.VOICE_SOURCE_LABELS.custom === '自定义' && lib.VOICE_SOURCE_LABELS.clone === '克隆')

const ignored = lib.mergeCustomVoices([], [{ id: 'c', label: 'C', provider: 'apimart', voiceId: 'x', createdAt: 'n' }], {
  provider: 'apimart', providerKind: 'apimart', capabilities: ap,
})
check('不支持渠道不出现自定义', ignored.length === 0)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
