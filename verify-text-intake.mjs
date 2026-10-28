/**
 * 文本导入的纯函数回归：
 * 1) 格式识别：JSON / Markdown 表格 / CSV / TSV / 自由文本 / 空
 * 2) 表头别名映射（含真实资料包的「镜头 / 时间 / 景别/机位 / 画面与动作 / 台词/声音 / 制作方式」）
 * 3) 值归一化：区间时长（三种破折号）、自然语言景别、台词拆旁白与音效
 * 4) merge / replace 语义：导入只改文件里出现的行
 * 5) 手改保护：导入不覆盖 handEdited 字段
 *
 * 用仓库已有的 esbuild 把 TS 打包成临时 ESM；不新增测试框架、不碰网络。
 * 跑法：node verify-text-intake.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(root, '.verify-intake-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [
    entry,
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=error',
    `--outfile=${out}`,
  ])
  return out
}

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const F = await import(bundle('src/intake/format.ts', 'format'))
const T = await import(bundle('src/intake/tableMap.ts', 'tableMap'))
const N = await import(bundle('src/intake/normalize.ts', 'normalize'))
const R = await import(bundle('src/intake/rows.ts', 'rows'))
const D = await import(bundle('src/agent/drafts.ts', 'drafts'))
const S = await import(bundle('src/shotSync.ts', 'shotSync'))
const P = await import(bundle('src/agent/promptDraft.ts', 'promptDraft'))

// ---------------------------------------------------------------- 1) 格式识别
check('空内容识别为 empty', F.detectFormat('   ').kind === 'empty')
check('JSON 对象', F.detectFormat('{"shots":[{"no":"01"}]}').kind === 'json')
check('JSON 数组', F.detectFormat('[{"no":"01"}]').kind === 'json')
check('围栏 JSON', F.detectFormat('```json\n{"a":1}\n```').kind === 'json', JSON.stringify(F.detectFormat('```json\n{"a":1}\n```')))
check(
  '坏 JSON 归自由文本并说明',
  F.detectFormat('{"a":').kind === 'free-text' && /不合法/.test(F.detectFormat('{"a":').reason),
)

const mdTable = `| 镜头 | 时间 | 景别/机位 | 画面与动作 | 台词/声音 |
|---|---|---|---|---|
| 01 | 00-05 | 极近景，猫眼 | 眼睛睁开 | 旁白：那天晚上 |`
check('Markdown 表格', F.detectFormat(mdTable).kind === 'markdown-table')

const tsv = '镜头\t时间\t画面\n01\t0-5\t眼睛睁开\n02\t5-11\t雨夜街角'
check('TSV', F.detectFormat(tsv).kind === 'tsv', F.detectFormat(tsv).kind)

const csv = '镜头,时间,画面\n01,0-5,眼睛睁开\n02,5-11,雨夜街角'
check('CSV', F.detectFormat(csv).kind === 'csv', F.detectFormat(csv).kind)

check('普通剧本是自由文本', F.detectFormat('第1集\n\n那天晚上，我以为自己活不过去了。').kind === 'free-text')

// 分列
const mdRows = F.parseTable(mdTable, 'markdown-table')
check('Markdown 表格分列', mdRows.length === 2 && mdRows[0][0] === '镜头' && mdRows[1][0] === '01', JSON.stringify(mdRows))
const csvRows = F.parseTable('镜头,画面\n01,"雨中，猫抬头"\n02,简单', 'csv')
check('CSV 引号内逗号不切分', csvRows[1][1] === '雨中，猫抬头', JSON.stringify(csvRows[1]))

// ---------------------------------------------------------------- 2) 表头映射
const mapped = T.mapHeaders(['镜头', '时间', '景别/机位', '画面与动作', '台词/声音', '制作方式'])
check('镜号列命中', mapped.hasShotNo)
check('时间→seconds', [...mapped.columns.values()].includes('seconds'))
check('景别/机位→size', [...mapped.columns.values()].includes('size'))
check('画面与动作→desc', [...mapped.columns.values()].includes('desc'))
check('台词/声音→dialogue', [...mapped.columns.values()].includes('dialogue'))
check('制作方式被忽略', mapped.ignored.includes('制作方式'), JSON.stringify(mapped.ignored))
check(
  '没有镜号列时 hasShotNo=false',
  T.mapHeaders(['时间', '画面']).hasShotNo === false,
)
check('英文表头', T.mapHeaders(['shot', 'seconds', 'size', 'move', 'description', 'dialogue']).hasShotNo)
check('columnOf 认「镜号」', T.columnOf('镜号') === 'no')
check('columnOf 认不出「制作方式」', T.columnOf('制作方式') === null)

// ---------------------------------------------------------------- 3) 值归一化
check('区间 00-05 → 5', N.parseDuration('00-05') === 5)
check('区间 0–5秒 → 5（短破折号）', N.parseDuration('0–5秒') === 5)
check('区间 5—11 秒 → 6（长破折号）', N.parseDuration('5—11 秒') === 6)
check('纯秒数 6 → 6', N.parseDuration('6') === 6)
check('纯秒数 3.5 秒', N.parseDuration('3.5 秒') === 3.5)
check('无法解析返回 null', N.parseDuration('约几秒') === null)
check('空返回 null', N.parseDuration('') === null)

const s1 = N.normalizeSize('中景')
check('景别标准值直通', s1.size === '中景' && s1.note === '', JSON.stringify(s1))
const s2 = N.normalizeSize('极近景，猫眼')
check('极近景→大特写，其余保留', s2.size === '大特写' && /猫眼/.test(s2.note), JSON.stringify(s2))
const s3 = N.normalizeSize('低机位远景')
check('低机位远景→远景，机位保留', s3.size === '远景' && /低机位/.test(s3.note), JSON.stringify(s3))
const s4 = N.normalizeSize('中近景')
check('中近景→近景', s4.size === '近景', JSON.stringify(s4))
const s5 = N.normalizeSize('猫咪主观镜头')
check('认不出景别时 size=null 并保留原文', s5.size === null && /主观镜头/.test(s5.note), JSON.stringify(s5))

check('运镜 推→推', N.normalizeMove('缓慢推近') === '推')
check('运镜 认不出返回 null', N.normalizeMove('随便动') === null)

const d1 = N.splitDialogueCell('旁白：那天晚上，我以为自己活不过去了。')
check('旁白不进台词', d1.lines.length === 0 && d1.narrators.length === 1, JSON.stringify(d1))
const d2 = N.splitDialogueCell('雨声、远处车声。')
check('纯音效不产生台词', d2.lines.length === 0 && d2.sounds.length > 0, JSON.stringify(d2))
const d3 = N.splitDialogueCell('脚步声停止。人类轻声：小家伙，你怎么在这里？')
check('混排拆成声音+台词', d3.lines.length === 1 && d3.sounds.length >= 1, JSON.stringify(d3))
check('混排的说话人被识别', d3.lines[0]?.speaker === '人类轻声' || d3.lines[0]?.speaker.includes('人类'), JSON.stringify(d3.lines))
const d4 = N.splitDialogueCell('音乐由紧张转柔和')
check('音乐提示不产生台词', d4.lines.length === 0, JSON.stringify(d4))

// ---------------------------------------------------------------- 4) 表格→导入行（真实资料包形态）
const realTable = `| 镜头 | 时间 | 景别/机位 | 画面与动作 | 台词/声音 | 制作方式 |
|---|---|---|---|---|---|
| 01 | 00-05 | 极近景，猫眼 | 黑暗里，小猫的眼睛缓缓睁开。 | 旁白：那天晚上，我以为自己活不过去了。 | AI |
| 02 | 05-12 | 低机位远景 | 雨夜街角，小猫缩在安全角落。 | 雨声、远处车声。 | AI |
| 03 | 12-19 | 爪子与脸部特写 | 小猫抬起爪子。 | 脚步声停止。人类轻声：小家伙，你怎么在这里？ | AI |`

const parsed = R.rowsFromTable(realTable, 'markdown-table', {
  epNo: 1,
  episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道' }] }],
})
check('真实表格解析出 3 行', parsed.rows.length === 3, JSON.stringify(parsed.rows.map((r) => r.no)))
check('镜号照抄', parsed.rows[0].no === '01')
check('时长按区间换算', parsed.rows[0].seconds === 5 && parsed.rows[1].seconds === 7)
check('景别归一化', parsed.rows[0].size === '大特写' && parsed.rows[1].size === '远景')
check('缺运镜列时补固定并记账', parsed.rows.every((r) => r.move === '固定') && parsed.rows[0].filled?.includes('move'), JSON.stringify(parsed.rows[0]))
check('旁白镜头不产生台词', !parsed.rows[0].dialogue, JSON.stringify(parsed.rows[0].dialogue))
check('音效镜头不产生台词', !parsed.rows[1].dialogue, JSON.stringify(parsed.rows[1].dialogue))
check('混排镜头产生台词', Array.isArray(parsed.rows[2].dialogue) && parsed.rows[2].dialogue.length === 1, JSON.stringify(parsed.rows[2].dialogue))
check('旁白保留进描述不丢', /旁白/.test(parsed.rows[0].desc), parsed.rows[0].desc)
check('声音说明保留进描述不丢', /雨声|车声/.test(parsed.rows[1].desc), parsed.rows[1].desc)
check('忽略列被记录', parsed.diff.ignoredColumns.includes('制作方式'), JSON.stringify(parsed.diff.ignoredColumns))
check('框取「制作方式」不影响镜号识别', parsed.error === undefined)

const noNo = R.rowsFromTable('| 画面 | 台词 |\n|---|---|\n| a | b |', 'markdown-table', { epNo: 1, episodes: [] })
check('没有镜号列直接拒绝', Boolean(noNo.error) && /镜号/.test(noNo.error), noNo.error)

const badDuration = R.rowsFromTable('| 镜头 | 时间 |\n|---|---|\n| 01 | 约几秒 |', 'markdown-table', { epNo: 1, episodes: [] })
check('时长无法解析的行被跳过', badDuration.rows[0]?.error && /时长/.test(badDuration.rows[0].error), JSON.stringify(badDuration.rows[0]))

// ---------------------------------------------------------------- 5) merge / replace 语义
const mkShot = (no, extra = {}) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `原描述 ${no}`,
  keyframe_prompt: `原首帧 ${no}`,
  video_prompt: `原视频 ${no}`,
  ...extra,
})

const twenty = Array.from({ length: 20 }, (_, i) => mkShot(`S${String(i + 1).padStart(2, '0')}`))
const threeImported = [mkShot('S02', { desc: '新描述 S02' }), mkShot('S05', { desc: '新描述 S05' }), mkShot('S99', { desc: '新增 S99' })]

const merged = S.mergeShotsDraft(twenty, threeImported, 1, 'merge')
check('merge：20 镜导入 3 镜后仍是 21 镜（20+1 新增）', merged.shots.length === 21, String(merged.shots.length))
check('merge：文件没提的镜头保留', merged.shots.some((s) => s.no === 'S01') && merged.shots.some((s) => s.no === 'S20'))
check('merge：出现过的被更新', merged.shots.find((s) => s.no === 'S02')?.desc === '新描述 S02')
check('merge：新镜号被追加', merged.shots.some((s) => s.no === 'S99'))
check('merge：计数正确', merged.added === 1 && merged.updated === 2, JSON.stringify(merged))

const replaced = S.mergeShotsDraft(twenty, threeImported, 1, 'replace')
check('replace：整集替换后只剩 3 镜', replaced.shots.length === 3, String(replaced.shots.length))

// 只改一列：视频提示词不该被清空
const partialPrompt = P.mergePromptDraft(
  [mkShot('S01')],
  [{ no: 'S01', keyframe_prompt: '新首帧' }],
  1,
  [],
  { partial: true },
)
check('partial：只给首帧时视频提示词保留', partialPrompt.shots[0].video_prompt === '原视频 S01', JSON.stringify(partialPrompt.shots[0]))
check('partial：首帧被更新', partialPrompt.shots[0].keyframe_prompt === '新首帧')

const fullPrompt = P.mergePromptDraft([mkShot('S01')], [{ no: 'S01', keyframe_prompt: '新首帧' }], 1, [])
check('非 partial（聊天）：缺列写成空，与旧行为一致', fullPrompt.shots[0].video_prompt === '')

// 手改保护
const locked = [mkShot('S01', { handEdited: ['desc'], desc: '我手写的描述' })]
const lockedMerge = S.mergeShotsDraft(locked, [mkShot('S01', { desc: '模型给的描述' })], 1, 'merge')
check('merge：handEdited 字段不被覆盖', lockedMerge.shots[0].desc === '我手写的描述', JSON.stringify(lockedMerge.shots[0]))
const lockedPrompt = P.mergePromptDraft(
  [mkShot('S01', { handEdited: ['keyframe_prompt'], keyframe_prompt: '我手写的首帧' })],
  [{ no: 'S01', keyframe_prompt: '导入的首帧' }],
  1,
  [],
  { partial: true },
)
check('提示词导入后 handEdited 仍在', (lockedPrompt.shots[0].handEdited ?? []).includes('keyframe_prompt'))

// 剧本：只导入第 2 集时其他集不变
const eps = [
  { no: 1, title: '第一集', scenes: [] },
  { no: 2, title: '旧第二集', scenes: [] },
  { no: 3, title: '第三集', scenes: [] },
]
const scriptMerge = D.mergeScriptDraft(eps, [{ no: 2, title: '新第二集', scenes: [] }], 'merge')
check('剧本：只改出现的集', scriptMerge.episodes.find((e) => e.no === 1)?.title === '第一集' && scriptMerge.episodes.find((e) => e.no === 2)?.title === '新第二集')
check('剧本：未出现的集保留', scriptMerge.episodes.find((e) => e.no === 3)?.title === '第三集')
check('剧本：mode 透传', scriptMerge.mode === 'merge')

fs.rmSync(outDir, { recursive: true, force: true })
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项未通过`)
process.exit(bad === 0 ? 0 : 1)
