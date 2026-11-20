/**
 * 分集剧本 Markdown 零模型导入验收。
 * 跑法：node verify-script-markdown-import.mjs
 */
import assert from 'node:assert/strict'
import { detectFormat } from '../src/intake/format'
import { parseScriptMarkdown, hasScriptSceneHeading } from '../src/intake/scriptMarkdown'
import { episodesFromScriptJson } from '../src/board/scriptIntake'

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

const bad = parseScriptMarkdown(`## EP001-SC001 外 · 只有地点`)
assert.equal(bad.ok, false)

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

console.log('script-markdown-import: ok')