/**
 * 字幕卡：SRT 校验 / 迁移 / LLM 提示
 * 跑法：node verify-subtitle-card.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-subtitle-card-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(entry, `export * from ${abs('src/subtitleCard.ts')}\n`)
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

const shots = [
  { id: 's1', no: '01', dialogue: '甲：你好', seconds: 3, video_prompt: '' },
  { id: 's2', no: '02', dialogue: '乙：再见', seconds: 2, video_prompt: '' },
]

const sampleSrt = `1
00:00:00,000 --> 00:00:02,000
你好

2
00:00:02,000 --> 00:00:04,000
再见
`

check('parseSrtBlocks', lib.parseSrtBlocks(sampleSrt).length === 2)
check('isValidSubtitleSrt', lib.isValidSubtitleSrt(sampleSrt))
check('无效 SRT', !lib.isValidSubtitleSrt('not srt'))
check('normalize 围栏', lib.normalizeSrtFromLlm('```srt\n' + sampleSrt + '\n```').includes('-->'))

const migrated = lib.migrateCuesToSrtBody([
  { id: 'c1', text: '台词', startMs: 0, endMs: 2000 },
])
check('迁移 cues', lib.isValidSubtitleSrt(migrated), migrated.slice(0, 40))

check('有可导出 SRT', lib.subtitleCardHasExportableSrt(sampleSrt))
check('无可导出 SRT', !lib.subtitleCardHasExportableSrt(''))

const sys = lib.subtitleLlmSrtSystemPrompt()
check('SRT 系统提示', sys.includes('SRT') && sys.includes('SubRip'))

const userPrompt = lib.subtitleLlmUserPrompt(shots, 'dialogue', '简短')
check('用户提示含镜号', userPrompt.includes('01') && userPrompt.includes('说明'), userPrompt.slice(0, 80))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)