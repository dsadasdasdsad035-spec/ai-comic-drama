/**
 * 分镜表导入保真回归（纯函数，无浏览器）。
 *
 * 覆盖：
 * 1) 四个新列被表头识别，不出现在「忽略列」里
 * 2) 台词内联标注解析成台词表演；空槽不写默认值
 * 3) 台词被写入时台词表演整组重建，下标不错位
 * 4) 表演列写入，缺项不补动作/视线/是否说话
 * 5) 选角列写入；参考列按名字解析成节点 id
 * 6) 运镜参照按中文名或 key 解析，歧义与不存在都进预览
 * 7) 导入白名单含五个字段，且与产线字段无交集
 * 8) 参考连线导入是增补语义；旧九列文件不创建新字段
 *
 * 跑法：node verify-intake-fidelity.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-intake-fidelity-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [
    `export * from ${abs('src/intake/rows.ts')}`,
    `export * from ${abs('src/intake/normalize.ts')}`,
    `export * from ${abs('src/intake/tableMap.ts')}`,
    `export * from ${abs('src/shotCellSyntax.ts')}`,
    `export * from ${abs('src/shotRefIndex.ts')}`,
    `export * from ${abs('src/shotSync.ts')}`,
    `export * from ${abs('src/agent/shotDraft.ts')}`,
    `export * from ${abs('src/storyboardMarkdown.ts')}`,
    `export * from ${abs('src/intake/notices.ts')}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry,
  '--bundle',
  '--platform=node',
  '--format=esm',
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

// ------------------------------------------------------------ 表头识别
const HEADERS = [
  '镜头', '场次', '时长', '景别', '运镜', '画面与动作', '台词与声音',
  '首帧提示词', '视频提示词', '选角', '表演', '运镜参照', '参考',
]
const mapped = lib.mapHeaders(HEADERS)
check('四个新列都被识别', mapped.columns.size === 13, String(mapped.columns.size))
check('没有忽略列', mapped.ignored.length === 0, mapped.ignored.join('、'))
check('选角识别为 cast', lib.columnOf('选角') === 'cast' && lib.columnOf('出场角色') === 'cast')
check('表演识别为 performance', lib.columnOf('表演') === 'performance')
check('运镜参照识别为 lexicon', lib.columnOf('运镜参照') === 'lexicon_ref_key' && lib.columnOf('镜头语言') === 'lexicon_ref_key')
check('参考识别为 reference', lib.columnOf('参考') === 'reference' && lib.columnOf('素材参考') === 'reference')

// ------------------------------------------------------------ 解析整张表
const EPISODES = [{ no: 1, title: '雨夜', scenes: [{ no: 1, slug: '天台', place: '天台', time: '夜' }] }]
const TABLE = [
  `| ${HEADERS.join(' | ')} |`,
  `| ${HEADERS.map(() => '---').join(' | ')} |`,
  '| S01 | 1 | 4 | 中景 | 推 | 雨夜街头 | 陈默[angry/4/slow/soft]{又是这里}：又是这里。<br>林小雨[sad//fast/]：你认得这条路？ | rain | push in | 陈默、林小雨 | 陈默:angry/4/拍桌/盯镜头/说<br>林小雨:calm/2/// | 横摇 | 角色:陈默、林小雨;素材:会议室全景 |',
  '| S02 | 1 | 3 | 近景 | 固定 | 巷口空无一人 | 陈默：这里没人。 | alley | hold | 陈默 |  |  |  |',
].join('\n')

const parsed = lib.rowsFromTable(TABLE, 'markdown-table', { epNo: 1, episodes: EPISODES })
check('解析出两行', parsed.rows.length === 2, String(parsed.rows.length))
check('没有忽略列', parsed.diff.ignoredColumns.length === 0, parsed.diff.ignoredColumns.join('、'))

const r1 = parsed.rows[0]
check('选角写入两个角色', same(r1.cast, ['陈默', '林小雨']), JSON.stringify(r1.cast))
check('表演写入两条', (r1.performance ?? []).length === 2, JSON.stringify(r1.performance))
check(
  '表演槽位正确',
  same(r1.performance?.[0], { character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true }),
  JSON.stringify(r1.performance?.[0]),
)
check(
  '表演缺项不补动作',
  r1.performance?.[1].action === undefined && r1.performance?.[1].gaze === undefined && r1.performance?.[1].speaks === undefined,
  JSON.stringify(r1.performance?.[1]),
)
check('台词两条', (r1.dialogue ?? []).length === 2, JSON.stringify(r1.dialogue))
check('台词文本不含标注', r1.dialogue?.[0].text === '又是这里。', r1.dialogue?.[0].text)
check('说话人不含标注', r1.dialogue?.[0].speaker === '陈默', r1.dialogue?.[0].speaker)
check('台词表演与台词等长', same(r1.dialogue_delivery?.length, r1.dialogue?.length), JSON.stringify(r1.dialogue_delivery))
check('完整标注解析', same(r1.dialogue_delivery?.[0], { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft', emphasis: '又是这里' }), JSON.stringify(r1.dialogue_delivery?.[0]))
check('部分标注只留已填槽', same(r1.dialogue_delivery?.[1], { emotion: 'sad', pace: 'fast' }), JSON.stringify(r1.dialogue_delivery?.[1]))
check('运镜参照按中文名解析', r1.lexicon_ref_key === '03_pan', r1.lexicon_ref_key)
check('参考列暂存名字', same(r1.reference, { characters: ['陈默', '林小雨'], assets: ['会议室全景'] }), JSON.stringify(r1.reference))
check('无未解析项', (r1.unresolvedRefs ?? []).length === 0, JSON.stringify(r1.unresolvedRefs))

const r2 = parsed.rows[1]
check('无标注时表演为空对象', r2.dialogue_delivery?.length === 1 && same(r2.dialogue_delivery[0], {}), JSON.stringify(r2.dialogue_delivery))
check('无标注不编造情绪', r2.dialogue?.length === 1 && r2.dialogue_delivery?.[0].emotion === undefined)

// ------------------------------------------------------------ 空槽与歧义
check('空槽不等同零值', same(lib.parseDialogueAnnotation('[/4///]'), { intensity: 4 }))
const lexKey = lib.rowsFromTable(
  `| 镜头 | 运镜参照 |\n| --- | --- |\n| S01 | 01_dolly_in |`,
  'markdown-table',
  { epNo: 1, episodes: EPISODES },
).rows[0]
check('运镜参照按 key 解析', lexKey.lexicon_ref_key === '01_dolly_in', lexKey.lexicon_ref_key)
const lexBad = lib.rowsFromTable(
  `| 镜头 | 运镜参照 |\n| --- | --- |\n| S01 | 不存在的运镜 |`,
  'markdown-table',
  { epNo: 1, episodes: EPISODES },
).rows[0]
check('运镜参照不存在时跳过并点名', lexBad.lexicon_ref_key === undefined && /不存在/.test(lexBad.unresolvedRefs?.[0] ?? ''))

// 冒号之后的方括号属于台词本身，不能被当成标注吃掉
check(
  '冒号后的方括号留在台词里',
  lib.splitDialogueCell('陈默：他说[系统]警告').lines[0]?.text === '他说[系统]警告',
  JSON.stringify(lib.splitDialogueCell('陈默：他说[系统]警告')),
)
check(
  '冒号后的方括号不产生情绪',
  lib.splitDialogueCell('陈默：他说[系统]警告').lines[0]?.emotion === undefined,
  JSON.stringify(lib.splitDialogueCell('陈默：他说[系统]警告').lines[0]),
)

// 表演末端槽位的三种写法
const perfSay = lib.parsePerformanceCell('陈默:angry/4/拍桌/盯镜头/说')
check('是否说话 说', perfSay.entries[0]?.speaks === true, JSON.stringify(perfSay.entries[0]))
const perfNo = lib.parsePerformanceCell('陈默:angry/4/拍桌/盯镜头/不说')
check('是否说话 不说', perfNo.entries[0]?.speaks === false, JSON.stringify(perfNo.entries[0]))
const perfBlank = lib.parsePerformanceCell('陈默:angry/4//')
check('末端空槽不写值', perfBlank.entries[0]?.speaks === undefined && perfBlank.entries[0]?.action === undefined && perfBlank.entries[0]?.gaze === undefined, JSON.stringify(perfBlank.entries[0]))
const perfAllEmpty = lib.parsePerformanceCell('陈默:////')
check('全空槽仍保留角色并计补全', perfAllEmpty.entries[0]?.character === '陈默' && perfAllEmpty.filled === 1, JSON.stringify(perfAllEmpty))

// 选角与参考的边界
check('选角去重保序', same(lib.parseCastCell('陈默、林小雨、陈默'), ['陈默', '林小雨']), JSON.stringify(lib.parseCastCell('陈默、林小雨、陈默')))
check('参考重复项只留一份', same(lib.parseRefCell('角色:陈默、陈默'), { characters: ['陈默'], assets: [] }), JSON.stringify(lib.parseRefCell('角色:陈默、陈默')))
check('参考只剩素材', same(lib.parseRefCell('素材:会议室全景'), { characters: [], assets: ['会议室全景'] }), JSON.stringify(lib.parseRefCell('素材:会议室全景')))
check('参考空值不产生分组', lib.parseRefCell('  ').characters.length === 0 && lib.parseRefCell('  ').assets.length === 0)
check('参考容忍全角空格与分号', same(lib.parseRefCell('角色：　陈默　;　素材：　会议室全景　'), { characters: ['陈默'], assets: ['会议室全景'] }), JSON.stringify(lib.parseRefCell('角色：　陈默　;　素材：　会议室全景　')))

// ------------------------------------------------------------ 参考解析
const index = lib.buildShotRefIndex(
  [{ id: 'c1', name: '陈默' }, { id: 'c2', name: '林小雨' }],
  [{ id: 'asset-a1', type: 'asset', data: { title: '会议室全景' } }],
)
const resolved = lib.resolveRowRefs(parsed.rows, index)
check('参考解析出角色与素材', same(resolved[0].refIds, ['char-c1', 'char-c2', 'asset-a1']), JSON.stringify(resolved[0].refIds))
check('参考解析无未解析', (resolved[0].unresolvedRefs ?? []).length === 0)

const dupIndex = lib.buildShotRefIndex(
  [{ id: 'c1', name: '陈默' }],
  [
    { id: 'asset-a1', type: 'asset', data: { title: '会议室全景' } },
    { id: 'asset-a2', type: 'asset', data: { title: '会议室全景' } },
  ],
)
const dup = lib.resolveRefNames({ assets: ['会议室全景'] }, dupIndex)
check('同名素材按歧义处理', dup.refIds.length === 0 && /同名/.test(dup.unresolved[0] ?? ''), JSON.stringify(dup))

const missing = lib.resolveRefNames({ characters: ['不存在的人'], assets: ['没这张图'] }, index)
check('名字不存在时点名', missing.refIds.length === 0 && missing.unresolved.length === 2, JSON.stringify(missing.unresolved))

// ------------------------------------------------------------ 构建与落库
const inputs = lib.rowsToShotInputs(resolved)
const built = lib.buildShotsFromImport(inputs, EPISODES, 1)
const s1 = built.shots[0]
check('构建后带选角', same(s1.cast, ['陈默', '林小雨']))
check('构建后带参考连线', same(s1.refIds, ['char-c1', 'char-c2', 'asset-a1']), JSON.stringify(s1.refIds))
check('构建后带运镜参照', s1.lexicon_ref_key === '03_pan', s1.lexicon_ref_key)
check('构建后台词表演整组保留', s1.dialogue_delivery?.length === 2, JSON.stringify(s1.dialogue_delivery))
check('构建后表演两条', (s1.performance ?? []).length === 2)
// S02 的表演单元格是空的，说话角色陈默的表演仍是系统补的，必须如实计数
check('空表演格仍计入补全', built.filledPerformance === 1, String(built.filledPerformance))
check('补全明细指向空表演的镜', /S02 陈默/.test(built.filledPerformanceDetail[0] ?? ''), JSON.stringify(built.filledPerformanceDetail))

const allPerf = lib.buildShotsFromImport(
  [
    {
      no: 'S04',
      dialogue: [{ speaker: '陈默', text: '喂。' }],
      performance: [{ character: '陈默', emotion: 'calm', intensity: 2 }],
    },
  ],
  EPISODES,
  1,
)
check('说话角色都有表演时不算补全', allPerf.filledPerformance === 0, String(allPerf.filledPerformance))

const noperf = lib.buildShotsFromImport([{ no: 'S03', dialogue: [{ speaker: '陈默', text: '喂。' }] }], EPISODES, 1)
check('无表演列时补默认并计数', noperf.filledPerformance === 1, String(noperf.filledPerformance))
check('补全明细点名角色', /S03 陈默/.test(noperf.filledPerformanceDetail[0] ?? ''), JSON.stringify(noperf.filledPerformanceDetail))

// 模型路径也不能凭空写空台词：没提台词就留空，合并时既不覆盖也不清空
const modelNoDialogue = lib.buildShotsFromModel([{ no: 'S09', desc: '只给画面' }], EPISODES, 1).shots[0]
check('模型没提台词时不写空数组', modelNoDialogue.dialogue === undefined, JSON.stringify(modelNoDialogue.dialogue))
const modelEmptyDialogue = lib.buildShotsFromModel([{ no: 'S09', dialogue: [] }], EPISODES, 1).shots[0]
check('模型明确给空台词时写成空数组', same(modelEmptyDialogue.dialogue, []), JSON.stringify(modelEmptyDialogue.dialogue))

// ------------------------------------------------------------ 白名单
for (const f of ['cast', 'performance', 'dialogue_delivery', 'refIds', 'lexicon_ref_key']) {
  check(`导入白名单含 ${f}`, lib.SHOT_IMPORT_FIELDS.includes(f))
}
const overlap = lib.SHOT_IMPORT_FIELDS.filter((f) => lib.SHOT_PIPELINE_FIELDS.includes(f))
check('导入白名单与产线字段无交集', overlap.length === 0, overlap.join('、'))

// 增补语义：既有的其他连线不能被文件抹掉
const old = [{ id: 'E01-S01', episode: 1, no: 'S01', refIds: ['char-c9'] }]
const merged = lib.mergeShotsDraft(old, built.shots, 1, 'merge', 'import')
const mergedShot = merged.shots.find((s) => s.no === 'S01')
check('参考连线是增补不是替换', mergedShot?.refIds?.includes('char-c9') && mergedShot?.refIds?.includes('asset-a1'), JSON.stringify(mergedShot?.refIds))
check('导入写入了选角', same(mergedShot?.cast, ['陈默', '林小雨']))
check('导入写入了运镜参照', mergedShot?.lexicon_ref_key === '03_pan')

// ------------------------------------------------------------ 旧九列文件
const LEGACY_TABLE = [
  '| 镜头 | 时长 | 景别 | 运镜 | 画面与动作 | 台词与声音 | 首帧提示词 | 视频提示词 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| S01 | 4 | 中景 | 推 | 雨夜街头 | 陈默：又是这里。 | rain | push in |',
].join('\n')
const legacyRows = lib.rowsFromTable(LEGACY_TABLE, 'markdown-table', { epNo: 1, episodes: EPISODES }).rows
check('旧文件不产生选角', legacyRows[0].cast === undefined)
check('旧文件不产生表演', legacyRows[0].performance === undefined)
check('旧文件不产生运镜参照', legacyRows[0].lexicon_ref_key === undefined)
check('旧文件不产生参考', legacyRows[0].reference === undefined)
const legacyBuilt = lib.buildShotsFromImport(lib.rowsToShotInputs(legacyRows), EPISODES, 1)
check('旧文件构建后无参考连线', legacyBuilt.shots[0].refIds === undefined)
check('旧文件构建后无运镜参照', legacyBuilt.shots[0].lexicon_ref_key === undefined)

// 只给提示词的文件：台词与表演必须原样不动
const promptOnly = lib.rowsFromTable(
  `| 镜头 | 首帧提示词 |\n| --- | --- |\n| S01 | new keyframe |`,
  'markdown-table',
  { epNo: 1, episodes: EPISODES },
).rows
check('只给提示词时不产生台词列', promptOnly[0].dialogue === undefined)
check('只给提示词时不产生表演列', promptOnly[0].dialogue_delivery === undefined)
const promptMerged = lib.mergeShotsDraft(
  [{ id: 'E01-S01', episode: 1, no: 'S01', dialogue: [{ speaker: '陈默', text: '旧台词' }], dialogue_delivery: [{ emotion: 'angry' }] }],
  lib.buildShotsFromImport(lib.rowsToShotInputs(promptOnly), EPISODES, 1).shots,
  1,
  'merge',
  'import',
)
const promptShot = promptMerged.shots.find((s) => s.no === 'S01')
check('只给提示词时台词不变', same(promptShot?.dialogue, [{ speaker: '陈默', text: '旧台词' }]), JSON.stringify(promptShot?.dialogue))
check('只给提示词时表演不变', same(promptShot?.dialogue_delivery, [{ emotion: 'angry' }]), JSON.stringify(promptShot?.dialogue_delivery))
check('只给提示词时提示词被写入', promptShot?.keyframe_prompt === 'new keyframe', String(promptShot?.keyframe_prompt))

// 没有参考列时，既有参考连线保持原样
const keepOld = lib.mergeShotsDraft(
  [{ id: 'E01-S01', episode: 1, no: 'S01', refIds: ['char-c9'] }],
  legacyBuilt.shots,
  1,
  'merge',
  'import',
)
check('无参考列时既有连线不变', same(keepOld.shots.find((s) => s.no === 'S01')?.refIds, ['char-c9']))

// 台词被重写时表演整体重建：旧的标注不能留下来
const previous = [{ id: 'E01-S01', episode: 1, no: 'S01', dialogue: [{ speaker: '陈默', text: '旧' }], dialogue_delivery: [{ emotion: 'angry' }] }]
const rewritten = lib.mergeShotsDraft(previous, legacyBuilt.shots, 1, 'merge', 'import')
check('台词重写时表演被重建', rewritten.shots.find((s) => s.no === 'S01')?.dialogue_delivery?.length === 1, JSON.stringify(rewritten.shots.find((s) => s.no === 'S01')?.dialogue_delivery))
check(
  '重建后不含旧的 angry',
  (rewritten.shots.find((s) => s.no === 'S01')?.dialogue_delivery?.[0] ?? {}).emotion === undefined,
  JSON.stringify(rewritten.shots.find((s) => s.no === 'S01')?.dialogue_delivery),
)

// ------------------------------------------------------------ 导出→导入往返
const ROUND_INDEX = lib.buildShotRefIndex(
  [{ id: 'c1', name: '陈默' }, { id: 'c2', name: '林小雨' }],
  [
    { id: 'asset-a1', type: 'asset', data: { title: '会议室全景' } },
    { id: 'asset-a2', type: 'asset', data: { title: '雨夜天台' } },
  ],
)
const roundShots = [
  {
    id: 'E01-S01',
    episode: 1,
    no: 'S01',
    seconds: 4,
    size: '中景',
    move: '推',
    desc: '雨夜街头，霓虹倒影',
    dialogue: [
      { speaker: '陈默', text: '又是这里。' },
      { speaker: '林小雨', text: '你认得这条路？' },
    ],
    dialogue_delivery: [
      { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft', emphasis: '又是这里' },
      { emotion: 'sad', pace: 'fast' },
    ],
    cast: ['陈默', '林小雨'],
    performance: [
      { character: '陈默', emotion: 'angry', intensity: 4, action: '拍桌', gaze: '盯镜头', speaks: true },
      { character: '林小雨', emotion: 'calm', intensity: 2, speaks: false },
    ],
    refIds: ['char-c1', 'char-c2', 'asset-a1', 'asset-a2'],
    lexicon_ref_key: '03_pan',
    keyframe_prompt: 'rain-soaked street',
    video_prompt: 'slow push in',
  },
]
const exported = lib.renderShotTable(roundShots, ROUND_INDEX)
check('导出 13 列表头', exported.split('\n')[0].split('|').filter((c) => c.trim()).length === 13)
check('导出不写节点 id', !/asset-a1|char-c1/.test(exported))
check('导出写角色名', /角色:陈默、林小雨/.test(exported))
check('导出写素材标题', /素材:会议室全景、雨夜天台/.test(exported))
check('导出台词带内联标注', /陈默\[angry\/4\/slow\/soft\]\{又是这里\}：又是这里。/.test(exported))

const back = lib.rowsFromTable(exported, 'markdown-table', { epNo: 1, episodes: EPISODES })
check('往返后无忽略列', back.diff.ignoredColumns.length === 0, back.diff.ignoredColumns.join('、'))
const b1 = back.rows[0]
check('往返保留时长景别运镜', b1.seconds === 4 && b1.size === '中景' && b1.move === '推', JSON.stringify([b1.seconds, b1.size, b1.move]))
check('往返保留画面描述', b1.desc === '雨夜街头，霓虹倒影', b1.desc)
check('往返保留选角', same(b1.cast, ['陈默', '林小雨']), JSON.stringify(b1.cast))
check('往返保留台词表演', same(b1.dialogue_delivery, roundShots[0].dialogue_delivery), JSON.stringify(b1.dialogue_delivery))
check('往返保留台词文本', same((b1.dialogue ?? []).map((d) => [d.speaker, d.text]), [['陈默', '又是这里。'], ['林小雨', '你认得这条路？']]), JSON.stringify(b1.dialogue))
check('往返保留表演含是否说话', same(b1.performance, roundShots[0].performance), JSON.stringify(b1.performance))
check('往返保留运镜参照', b1.lexicon_ref_key === '03_pan', b1.lexicon_ref_key)
const bResolved = lib.resolveRowRefs(back.rows, ROUND_INDEX)[0]
check('往返还原同样的参考连线', same(bResolved.refIds, roundShots[0].refIds), JSON.stringify(bResolved.refIds))
check('往返无未解析参考', (bResolved.unresolvedRefs ?? []).length === 0, JSON.stringify(bResolved.unresolvedRefs))
check('往返保留提示词', b1.keyframe_prompt === 'rain-soaked street' && b1.video_prompt === 'slow push in')

// ------------------------------------------------------------ 预览提示文案
const cleanDiff = lib.rowsFromTable(TABLE, 'markdown-table', { epNo: 1, episodes: EPISODES }).diff
check('13 列文件不产生提示', cleanDiff.notices.length === 0, JSON.stringify(cleanDiff.notices))
check('13 列文件无补全统计', Object.keys(cleanDiff.defaultsFilled).length === 0, JSON.stringify(cleanDiff.defaultsFilled))
check(
  '接上演出后整体无提示',
  lib.intakeNotices({ notices: cleanDiff.notices, defaultsFilled: cleanDiff.defaultsFilled }).length === 0,
)

const ignoredDiff = lib.rowsFromTable(
  '| 镜头 | 制作方式 |\n| --- | --- |\n| S01 | 手工 |',
  'markdown-table',
  { epNo: 1, episodes: EPISODES },
).diff
check('认不出的列如实点名', /无法识别为镜头字段的列：制作方式/.test(ignoredDiff.notices[0] ?? ''), JSON.stringify(ignoredDiff.notices))

const noticePerf = lib.intakeNotices({
  defaultsFilled: { performance: 2 },
  filledPerformance: 1,
  filledPerformanceDetail: ['S02 陈默'],
})
check('表演缺项与表演缺失分开说', noticePerf.length === 2, JSON.stringify(noticePerf))
check('缺项说的是情绪强度', /表演列有 2 镜/.test(noticePerf[0] ?? ''), noticePerf[0])
check('缺失点名到镜与人', /S02 陈默/.test(noticePerf[1] ?? ''), noticePerf[1])

const noticeRef = lib.intakeNotices({
  notices: ['参考未能解析（这些字段会被跳过）：S01：角色「不存在的人」在当前项目里不存在'],
  prefix: 'E01.md',
})
check('压缩包提示带文件名前缀', /^E01\.md：参考未能解析/.test(noticeRef[0] ?? ''), noticeRef[0])
check('未解析参考只出现一次', noticeRef.length === 1, JSON.stringify(noticeRef))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 分镜表导入保真回归通过')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
