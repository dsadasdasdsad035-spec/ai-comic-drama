/**
 * 表演数据纯函数回归：台词表演对齐、镜头往返、旧数据、手改保护。
 * 跑法：node verify-performance.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-performance-'))
const entry = path.join(tmp, 'entry.ts')
const abs = (p) => JSON.stringify(path.join(root, p))
fs.writeFileSync(
  entry,
  [`export * from ${abs('src/prompts.ts')}`, `export * from ${abs('src/shotSync.ts')}`].join('\n') + '\n',
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

const A = { speaker: '陈默', text: '你来了。' }
const B = { speaker: '林岚', text: '我不该来。' }
const C = { speaker: '陈默', text: '已经晚了。' }
const dA = { emotion: 'angry', intensity: 4, pace: 'slow', volume: 'soft' }
const dB = { emotion: 'surprised', intensity: 3 }

// ---- 台词表演对齐 ----
let r = lib.reconcileDialogueDelivery([A, B], [dA, dB], [A, B])
check('未改：表演原样保留', JSON.stringify(r.delivery) === JSON.stringify([dA, dB]) && r.dropped === 0)

r = lib.reconcileDialogueDelivery([A, B], [dA, dB], [{ ...A, text: '你终于来了。' }, B])
check('改字：按行下标兜底', r.delivery[0].emotion === 'angry' && r.delivery[1].emotion === 'surprised')

r = lib.reconcileDialogueDelivery([A, B], [dA, dB], [A, B, C])
check('增行：旧两行保留，新行空', r.delivery.length === 3 && r.delivery[2].emotion === undefined)

r = lib.reconcileDialogueDelivery([A, B], [dA, dB], [B])
check('删行：保留 B，丢弃 A 并计数', r.delivery.length === 1 && r.delivery[0].emotion === 'surprised' && r.dropped === 1)

const text = lib.dialogueToText([A, B])
check('台词文本不含表演标签', !text.includes('angry') && !text.includes('情绪') && text.includes('你来了'))

const withDelivery = lib.dialogueWithDelivery([A], [dA])
check('带表演台词只附加元数据', withDelivery[0].text === A.text && withDelivery[0].emotion === 'angry')

// ---- 镜头往返 ----
const shotData = {
  no: 'S01',
  seconds: 3,
  size: '中景',
  move: '固定',
  dialogue: '陈默：你来了。\n林岚：我不该来。',
  prompt: 'kf',
  videoPrompt: 'vp',
  performance: [
    { character: '陈默', emotion: 'angry', intensity: 4, action: '压住桌沿', gaze: '林岚', speaks: true },
    { character: '林岚', emotion: 'fearful', intensity: 3, action: '后退半步', speaks: true },
  ],
  dialogueDelivery: [dA, dB],
  lipSync: { mode: 'prompt' },
  voiceMeta: {
    engine: 'minimax:male-qn-qingse',
    applied: ['emotion', 'pace'],
    unsupported: ['intensity'],
    fingerprint: 'abc',
    createdAt: '2026-10-24T00:00:00.000Z',
  },
  cast: ['陈默', '林岚'],
  marks: [],
}
const project = lib.nodeToShot(shotData, 'E01-S01')
check('画布→项目：表演两角色', project.performance?.length === 2 && project.performance[0].action === '压住桌沿')
check('画布→项目：逐行表演', project.dialogue_delivery?.[0]?.emotion === 'angry' && project.dialogue_delivery?.[1]?.emotion === 'surprised')
check('画布→项目：口型/配音元数据', project.lip_sync?.mode === 'prompt' && project.voice_meta?.fingerprint === 'abc')

const back = lib.shotToData(project, { ...shotData, performance: undefined, dialogueDelivery: undefined, lipSync: undefined, voiceMeta: undefined })
check('项目→画布：表演恢复', back.performance?.[1]?.emotion === 'fearful')
check('项目→画布：逐行表演恢复', back.dialogueDelivery?.[1]?.emotion === 'surprised')
check('项目→画布：台词仍是纯文本', back.dialogue === shotData.dialogue)
check('项目→画布：口型恢复', back.lipSync?.mode === 'prompt')

const legacy = lib.shotToData(
  { id: 'E01-S01', dialogue: [{ speaker: '陈默', text: '你来了。' }] },
  { ...shotData, performance: undefined, dialogueDelivery: undefined, lipSync: undefined, voiceMeta: undefined },
)
check('旧项目：表演读空', legacy.performance === undefined || legacy.performance.length === 0)
check('旧项目：不报错', legacy.dialogue === '陈默：你来了。')

// ---- 手改保护 ----
const oldShot = {
  id: 'E01-S01',
  performance: [{ character: '陈默', emotion: 'sad', intensity: 2 }],
  dialogue_delivery: [{ emotion: 'sad' }],
  handEdited: ['performance', 'dialogue_delivery'],
}
const generatedShot = {
  id: 'E01-S01',
  performance: [{ character: '陈默', emotion: 'happy', intensity: 5 }],
  dialogue_delivery: [{ emotion: 'happy' }],
}
let merged = lib.mergeGenerated([oldShot], [generatedShot])[0]
check('手改：表演保留', merged.performance[0].emotion === 'sad' && merged.dialogue_delivery[0].emotion === 'sad')
const cleared = lib.clearHandEdited(merged, ['performance', 'dialogue_delivery'])
check('清除标记：字段清空且可被模型接管', !cleared.handEdited && cleared.performance[0].emotion === 'sad')

merged = lib.mergeGenerated([{ ...oldShot, handEdited: [] }], [generatedShot])[0]
check('未手改：模型值生效', merged.performance[0].emotion === 'happy')

// ---- 两台“项目”互不影响 ----
const p1 = lib.mergeGenerated([], [{ id: 'A', performance: [{ character: 'A', emotion: 'angry', intensity: 3 }] }])
const p2 = lib.mergeGenerated([], [{ id: 'B', performance: [{ character: 'B', emotion: 'calm', intensity: 1 }] }])
check('项目隔离：两条数据互不被改写', p1[0].performance[0].character === 'A' && p2[0].performance[0].character === 'B')

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
