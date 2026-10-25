/**
 * 配音表演回归：逐行优先/角色回退、指纹失效、参数规范化、
 * provider 映射接线（MiniMax/Volc/ElevenLabs/APIMart）。
 * 跑法：node verify-voice-performance.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-voice-perf-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, [`export * from ${abs('src/performance.ts')}`, `export * from ${abs('src/prompts.ts')}`].join('\n') + '\n')
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

const performance = [
  { character: '陈默', emotion: 'angry', intensity: 4 },
  { character: '林岚', emotion: 'fearful', intensity: 3 },
]
const delivery = [{ emotion: 'sad', pace: 'slow' }, {}]
const lineDelivery = lib.deliveryForSpeaker(performance, '陈默', delivery, 0)
check('逐行表演优先', lineDelivery.emotion === 'sad' && lineDelivery.pace === 'slow')
const fallback = lib.deliveryForSpeaker(performance, '林岚', delivery, 1)
check('逐行缺失回退角色表演', fallback.emotion === 'fearful' && fallback.intensity === 3)
check('无表演返回空', Object.keys(lib.deliveryForSpeaker(undefined, '陈默', undefined, 0)).length === 0)

const fp1 = lib.voiceFingerprint('你来了', [lineDelivery])
const fp2 = lib.voiceFingerprint('你来了', [{ ...lineDelivery, emotion: 'happy' }])
const fp3 = lib.voiceFingerprint('你走了', [lineDelivery])
check('改情绪指纹变化', fp1 !== fp2)
check('改台词指纹变化', fp1 !== fp3)
check('未变化指纹稳定', lib.voiceFingerprint('你来了', [lineDelivery]) === fp1)

const normalized = lib.normalizeDialogueDelivery({ emotion: 'angry', intensity: 9, pace: 'fast', volume: 'shout', emphasis: ' 走 ' })
check('表演参数夹紧', normalized.intensity === 5 && normalized.emphasis === '走')
check('非法值被丢弃', Object.keys(lib.normalizeDialogueDelivery({ emotion: 'xxx', pace: 'xxx' })).length === 0)

const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
const apimart = fs.readFileSync(path.join(root, 'server/apimart.mjs'), 'utf8')
const volc = fs.readFileSync(path.join(root, 'server/volc-tts.mjs'), 'utf8')
check('MiniMax 映射接线', vite.includes('voice_setting') && vite.includes('emotion') && vite.includes('PACE_SPEED'))
check('ElevenLabs 标签/风格接线', vite.includes('elevenTags') && vite.includes('voice_settings'))
check('APIMart instructions 接线', vite.includes('voiceInstructions') && apimart.includes('instructions'))
check('火山 emotion/scale/rate 接线', volc.includes('emotion_scale') && volc.includes('speech_rate') && volc.includes('loudness_rate'))
check('applied/unsupported 回传接线', vite.includes('unsupported') && vite.includes('applied'))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
