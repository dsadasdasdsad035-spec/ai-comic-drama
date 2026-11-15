/**
 * 分镜表单元格语法与导出列回归（纯函数，无浏览器）。
 *
 * 覆盖：
 * 1) 台词标注渲染与解析的往返、空槽、无标注
 * 2) 表演列渲染与解析的往返、空槽、多条
 * 3) 选角列与参考列的渲染与解析
 * 4) 参考 id → 可读名字的解析与未解析项
 * 5) 表头 13 列、行内 13 格、运镜参照只认绑定 key
 *
 * 跑法：node verify-shot-cell-syntax.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cell-syntax-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/shotCellSyntax.ts')}`,
    `export * from ${abs('src/storyboardMarkdown.ts')}`,
    `export * from ${abs('src/shotRefIndex.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--loader:.json=json',
  '--log-level=error',
  `--outfile=${bundle}`,
])
const lib = await import(bundle)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const cellCount = (row) => row.split('|').length - 2
const cellsOf = (row) => row.split('|').slice(1, -1).map((x) => x.trim())

// ------------------------------------------------------------ 台词标注
const full = { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft', emphasis: '又是这里' }
const lineFull = lib.renderDialogueLine('陈默', '又是这里。', full)
check('台词完整标注', lineFull === '陈默[angry/4/slow/soft]{又是这里}：又是这里。', lineFull)
check('标注往返', same(lib.parseDialogueAnnotation(lib.renderDialogueAnnotation(full)), full))

const partial = { emotion: 'sad', pace: 'fast' }
const linePartial = lib.renderDialogueLine('林小雨', '你认得这条路？', partial)
check('部分空槽保留位置', linePartial === '林小雨[sad//fast/]：你认得这条路？', linePartial)
check('部分空槽往返', same(lib.parseDialogueAnnotation(lib.renderDialogueAnnotation(partial)), partial))

check('无表演不写方括号', lib.renderDialogueLine('陈默', '又是这里。') === '陈默：又是这里。')
check('无表演解析为空', lib.parseDialogueAnnotation('') === undefined)

const onlyIntensity = lib.parseDialogueAnnotation('[/4///]')
check('空槽不是零值', same(onlyIntensity, { intensity: 4 }), JSON.stringify(onlyIntensity))

const brackets = lib.renderDialogueLine('陈默', '[系统]警告：电池耗尽')
check('原文方括号不参与解析', brackets === '陈默：[系统]警告：电池耗尽', brackets)
check('说话人后无标注', lib.parseDialogueAnnotation('') === undefined)

const emptySpeaker = lib.renderDialogueLine('', '雨声。', { emotion: 'calm' })
check('说话人为空也保住标注', emptySpeaker === '[calm///]：雨声。', emptySpeaker)

// ------------------------------------------------------------ 表演列
const one = lib.renderPerformanceLine({ character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true })
check('表演单条渲染', one === '陈默:angry/4/拍桌/盯镜头/说', one)
check(
  '表演单条往返',
  same(lib.parsePerformanceLine(one), { character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true }),
  JSON.stringify(lib.parsePerformanceLine(one)),
)

const lack = lib.renderPerformanceLine({ character: '林小雨', emotion: 'calm', intensity: 2 })
check('表演缺项留空槽', lack === '林小雨:calm/2///', lack)
const lackParsed = lib.parsePerformanceLine(lack)
check(
  '缺项不留默认动作',
  lackParsed.action === undefined && lackParsed.gaze === undefined && lackParsed.speaks === undefined,
  JSON.stringify(lackParsed),
)

const multi = lib.renderPerformanceCell([
  { character: '陈默', emotion: 'angry', intensity: 4, speaks: true },
  { character: '林小雨', emotion: 'sad', intensity: 2, speaks: false },
])
check('多条表演用 br 分隔', multi.split('<br>').length === 2, multi)
check('多条表演解析回两条', lib.parsePerformanceCell(multi).entries.length === 2)
check('空表演列', lib.renderPerformanceCell([]) === '' && lib.parsePerformanceCell('').entries.length === 0)

const filled = lib.parsePerformanceCell('林小雨:calm/2//').filled
check('补默认值被计数', filled === 0, String(filled))
check('补默认值计数正确', lib.parsePerformanceCell('林小雨://只做动作/').filled === 1)

// ------------------------------------------------------------ 选角与参考
check('选角渲染', lib.renderCastCell(['陈默', '林小雨']) === '陈默、林小雨')
check('选角往返', same(lib.parseCastCell('陈默、林小雨'), ['陈默', '林小雨']))
check('空选角', lib.renderCastCell([]) === '' && lib.parseCastCell('').length === 0)

const refBoth = lib.renderRefCell({ characters: ['陈默', '林小雨'], assets: ['会议室全景'] })
check('参考双向渲染', refBoth === '角色:陈默、林小雨;素材:会议室全景', refBoth)
check('参考双向往返', same(lib.parseRefCell(refBoth), { characters: ['陈默', '林小雨'], assets: ['会议室全景'] }))
check('参考只有角色', lib.renderRefCell({ characters: ['陈默'], assets: [] }) === '角色:陈默')
check('参考为空', lib.renderRefCell({ characters: [], assets: [] }) === '')

// ------------------------------------------------------------ 参考解析
const index = {
  characterNames: { 'c1': '陈默', '陈默': '陈默', 'c2': '林小雨' },
  assetTitles: { 'asset-a1b2': '会议室全景' },
}
const ok = lib.resolveShotRefs(['char-c1', 'char-c2', 'asset-a1b2'], index)
check('参考解析出角色名', same(ok.characters, ['陈默', '林小雨']), JSON.stringify(ok.characters))
check('参考解析出素材标题', same(ok.assets, ['会议室全景']))
check('全部解析时无未解析', ok.unresolved.length === 0)

const gone = lib.resolveShotRefs(['asset-dead', 'char-gone'], index)
check('已删素材进未解析', gone.unresolved.some((x) => x.includes('asset-dead')), JSON.stringify(gone.unresolved))
check('已删角色进未解析', gone.unresolved.some((x) => x.includes('角色「gone」')))
check('未解析不写进参考列', gone.assets.length === 0 && gone.characters.length === 0)

const miss = lib.resolveShotRefs(['char-miss-陈默'], index)
check('缺角色卡按名字保留', same(miss.characters, ['陈默']), JSON.stringify(miss))

const noIndex = lib.resolveShotRefs(['asset-a1b2'], undefined)
check('缺索引时素材按未解析处理', noIndex.assets.length === 0 && noIndex.unresolved.length === 1)

const dedupe = lib.resolveShotRefs(['char-c1', 'char-c1'], index)
check('重复参考去重', dedupe.characters.length === 1)

// ------------------------------------------------------------ 索引构造
const built = lib.buildShotRefIndex(
  [{ id: 'c1', name: '陈默' }],
  [
    { id: 'asset-z9', type: 'asset', data: { title: '会议室全景' } },
    { id: 'shot-1', type: 'shot', data: {} },
  ],
)
check('索引登记角色 id 与名字', built.characterNames.c1 === '陈默' && built.characterNames['陈默'] === '陈默')
check('索引只收素材节点', built.assetTitles['asset-z9'] === '会议室全景' && !('shot-1' in built.assetTitles))

// ------------------------------------------------------------ 列与行
check('表头 13 列', lib.SHOT_TABLE_HEADER.length === 13, String(lib.SHOT_TABLE_HEADER.length))
check(
  '前九列保持旧写法',
  same(lib.SHOT_TABLE_HEADER.slice(0, 9), ['镜头', '场次', '时长', '景别', '运镜', '画面与动作', '台词与声音', '首帧提示词', '视频提示词']),
)
check(
  '新四列在末尾',
  same(lib.SHOT_TABLE_HEADER.slice(9), ['选角', '表演', '运镜参照', '参考']),
)

const shot = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  scene_no: 1,
  seconds: 4,
  size: '中景',
  move: '推',
  desc: '雨夜街头',
  dialogue: [{ speaker: '陈默', text: '又是这里。' }],
  dialogue_delivery: [{ emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft', emphasis: '又是这里' }],
  cast: ['陈默', '林小雨'],
  performance: [{ character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true }],
  lexicon_ref_key: '03_pan',
  refIds: ['char-c1', 'asset-a1b2'],
  keyframe_prompt: 'rain',
  video_prompt: 'push in',
}
const row = lib.renderShotRow(shot, index)
check('行内 13 格', cellCount(row) === 13, String(cellCount(row)))
check('台词列内联表演', row.includes('陈默[angry/4/slow/soft]{又是这里}：又是这里。'))
check('选角列写出角色', row.includes('陈默、林小雨'))
check('表演列写出槽位', row.includes('陈默:angry/4/拍桌/盯镜头/说'))
check('运镜参照写中文名', cellsOf(row)[11] === '横摇', cellsOf(row)[11])

const emptyShot = { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3 }
const emptyRow = lib.renderShotRow(emptyShot, index)
check('空镜仍是 13 格', cellCount(emptyRow) === 13, String(cellCount(emptyRow)))
check('空镜新四列为空', /(?:^\|.*\|)\s*\|\s*\|\s*\|\s*\|\s*\|$/.test(emptyRow.trim()), emptyRow)

// 运镜参照只认绑定 key：move 有值但没有绑定必须留空
const unbound = lib.renderShotRow({ id: 'X', episode: 1, no: 'S09', move: '推', seconds: 2 }, index)
check('未绑定不从 move 反推', cellsOf(unbound)[11] === '' && cellsOf(unbound)[4] === '推', JSON.stringify(cellsOf(unbound)))
check('死 key 退化写 key', cellsOf(lib.renderShotRow({ id: 'X', episode: 1, no: 'S09', lexicon_ref_key: 'no_such' }, index))[11] === 'no_such')

// 竖线不打断表格
const piped = lib.renderShotRow({ id: 'X', episode: 1, no: 'S09', desc: 'a|b', seconds: 2 }, index)
check('竖线换全角', piped.includes('a｜b') && cellCount(piped) === 13)

// 未解析参考进附注
const doc = lib.episodeMarkdown({
  projectName: '导出验证',
  episodes: [{ no: 1, title: '雨夜', scenes: [] }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 2, refIds: ['asset-dead'] }],
  refIndex: index,
}, 1)
check('附注点名未解析参考', /未解析参考：S01 .*asset-dead/.test(doc.text), doc.text.split('\n').slice(-3).join(' | '))
check('参考列不含原始 id', !/\| .*asset-dead.* \|/.test(doc.text))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 单元格语法与导出列回归通过')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
