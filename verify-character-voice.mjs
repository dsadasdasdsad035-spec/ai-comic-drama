/**
 * 角色音色样本纯函数回归：往返、指纹、2-30 秒、失效、旧角色。
 * 跑法：node verify-character-voice.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-char-voice-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, [`export * from ${abs('src/characters.ts')}`, `export * from ${abs('src/charMap.ts')}`].join('\n') + '\n')
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
const base = {
  id: '陈默', name: '陈默', role: '主角', lookCn: '寸头', lookEn: 'buzz cut, grey coat',
  palette: '灰', keywords: ['寸头'], voiceId: 'male-a',
}
const sample = {
  url: '/project-assets/demo/voice-sample-1.mp3', text: '这是一段试音。', seconds: 8,
  engine: 'minimax:male-a', voiceId: 'male-a', modelKey: 'minimax-tts', fingerprint: 'abc', stale: false,
}
const sheet = { ...base, voiceSample: sample }
const project = lib.toProject(sheet)
check('项目往返：样本存在', project.voice_sample?.url === sample.url && project.voice_sample?.seconds === 8)
const back = lib.toSheet(project)
check('项目读回：样本完整', back.voiceSample?.text === sample.text && back.voiceSample?.voiceId === 'male-a')
check('换样本不改音色 id', back.voiceId === 'male-a')

const fp1 = lib.voiceSampleFingerprint({ url: sample.url, text: sample.text, voiceId: 'male-a', modelKey: 'm', engine: 'e' })
const fp2 = lib.voiceSampleFingerprint({ url: sample.url, text: '新试音', voiceId: 'male-a', modelKey: 'm', engine: 'e' })
const fp3 = lib.voiceSampleFingerprint({ url: sample.url, text: sample.text, voiceId: 'male-b', modelKey: 'm', engine: 'e' })
check('改文本指纹变化', fp1 !== fp2)
check('改音色指纹变化', fp1 !== fp3)
check('未变化指纹稳定', fp1 === lib.voiceSampleFingerprint({ url: sample.url, text: sample.text, voiceId: 'male-a', modelKey: 'm', engine: 'e' }))

check('2-30 秒可用', lib.isVoiceSampleUsable(sample))
check('1.2 秒不可用', !lib.isVoiceSampleUsable({ ...sample, seconds: 1.2 }))
check('31 秒不可用', !lib.isVoiceSampleUsable({ ...sample, seconds: 31 }))
check('stale 不可用', !lib.isVoiceSampleUsable({ ...sample, stale: true }))
check('标记失效保留音频', lib.markVoiceSampleStale(sample)?.stale === true && lib.markVoiceSampleStale(sample)?.url === sample.url)
check('旧角色无样本', lib.toSheet({ name: '林岚' }).voiceSample === undefined)

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
