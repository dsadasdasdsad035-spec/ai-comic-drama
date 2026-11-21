/**
 * 分集剧本 Markdown 零模型导入验收。
 * 跑法：node verify-script-markdown-import.mjs
 */
import assert from 'node:assert/strict'
import { detectFormat } from '../src/intake/format'
import { parseScriptMarkdown, hasScriptSceneHeading } from '../src/intake/scriptMarkdown'
import { episodesForScriptImport, episodesFromScriptJson } from '../src/board/scriptIntake'
import { buildScriptEpisodeMarkdown } from '../src/intake/scriptExportMarkdown'
import { validateContract } from '../src/skills/contracts'

const SAMPLE = `# EP001 开篇

## EP001-SC001 内 · 咖啡厅 · 日
陈默：你来了。
[VO] 系统：任务更新

## EP001-SC002 外 · 街道 · 夜
雨夜，街灯闪烁。
`

assert.ok(hasScriptSceneHeading(SAMPLE))

const parsed = parseScriptMarkdown(SAMPLE)
assert.equal(parsed.ok, true)
if (!parsed.ok) throw new Error('expected ok')
assert.equal(parsed.episodes.length, 1)
assert.equal(parsed.episodes[0]?.no, 1)
assert.equal(parsed.episodes[0]?.scenes?.length, 2)
const beats0 = parsed.episodes[0]?.scenes?.[0]?.beats ?? ''
assert.match(beats0, /陈默：你来了/)
assert.match(beats0, /\[VO\]/)

episodesForScriptImport(parsed.episodes)
episodesFromScriptJson({ episodes: parsed.episodes })

const dualEp = `# EP001 甲

## EP001-SC001 内 · A · 日
场 A

# EP002 乙

## EP002-SC001 外 · B · 夜
场 B
`
const pe = parseScriptMarkdown(dualEp)
assert.equal(pe.ok, true)
if (!pe.ok) throw new Error('dual ep')
assert.equal(pe.episodes.length, 2)
assert.deepEqual(
  pe.episodes.map((e) => e.no),
  [1, 2],
)

const incomplete = parseScriptMarkdown(`## EP001-SC001 外 · 只有地点`)
assert.equal(incomplete.ok, true)
if (!incomplete.ok) throw new Error('incomplete heading')
assert.equal(incomplete.episodes[0]?.scenes?.[0]?.time, '未注明时间')
episodesForScriptImport(incomplete.episodes)

const loose = parseScriptMarkdown(`## 第一场 内景 家 夜\n对白正文`, { hintEpNo: 2 })
assert.equal(loose.ok, true)
if (!loose.ok) throw new Error('loose')
assert.equal(loose.episodes[0]?.no, 2)
assert.match(loose.episodes[0]?.scenes?.[0]?.beats ?? '', /对白正文/)

const plain = parseScriptMarkdown(`只有一段故事，没有标题。`, { hintEpNo: 3 })
assert.equal(plain.ok, true)
if (!plain.ok) throw new Error('plain')
assert.equal(plain.episodes[0]?.no, 3)
assert.equal(plain.episodes[0]?.scenes?.length, 1)
assert.ok(plain.warnings.some((w) => /未识别场标题/.test(w)))

assert.equal(detectFormat('随便一段字', { intake: 'script' }).kind, 'script-markdown')

const mixed = `${SAMPLE}
| 镜头 | 时间 |
|---|---|
| 01 | 0-5 |
`
const pm = parseScriptMarkdown(mixed)
assert.equal(pm.ok, true)
if (!pm.ok) throw new Error('mixed')
assert.ok(pm.warnings.some((w) => /分镜表/.test(w)))

const combo = `${SAMPLE}
| 镜头 | 时间 |
|---|---|
| 01 | 0-5 |
`
assert.equal(detectFormat(combo, { intake: 'script' }).kind, 'script-markdown')
assert.equal(detectFormat(combo).kind, 'markdown-table')

const roundTrip = parseScriptMarkdown(buildScriptEpisodeMarkdown(parsed.episodes[0]!, 1))
assert.equal(roundTrip.ok, true)
if (!roundTrip.ok) throw new Error('roundTrip')
assert.equal(roundTrip.episodes[0]?.scenes?.length, 2)
assert.equal(roundTrip.episodes[0]?.scenes?.[1]?.space, '外')
const v = validateContract('script-v1', { episodes: roundTrip.episodes })
assert.equal(v.ok, true, v.errors?.join('；'))

const withHook = {
  no: 3,
  title: '无题',
  hook: '一句钩子',
  scenes: [{ no: 1, slug: 'EP003-SC001', space: '内', place: '家', time: '夜', beats: '正文' }],
} as const
const mdHook = buildScriptEpisodeMarkdown(withHook, 3)
assert.match(mdHook, /> 一句钩子/)
assert.match(mdHook, /EP003-SC001/)

const emptyTitle = buildScriptEpisodeMarkdown({ no: 4, scenes: [] }, 4)
assert.match(emptyTitle, /尚未填写场次/)

console.log('script-markdown-import: ok')