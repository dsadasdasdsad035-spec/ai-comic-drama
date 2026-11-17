import assert from 'node:assert/strict'
import { createStageToolSet, bindSkillTools } from '../src/agent/stageTools'
import { parseSkillText } from '../src/skills/parse'
import fs from 'node:fs'
import path from 'node:path'
import { resetWritePaging } from '../src/skills/writePaging'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat'

/**
 * 分批写入验收：
 * - 一次提交超批大小 → 只写前一批，回执给 nextCursor + remaining
 * - 带 cursor 续写只补剩余条目，最终结果与一次写回等价
 * - 自造游标 / 编辑状态变化的旧游标必须被拒绝，并给出重读入口
 * - 单条超字符上限时不写入任何数据，回执给 suggestedLimit 与分批参数名
 */

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

const root = process.cwd()
const readSkill = (id: string) =>
  parseSkillText(id, fs.readFileSync(path.join(root, 'tests', 'fixtures', 'skills', id, 'SKILL.md'), 'utf8'), 'builtin')

type Shot = { no: string; desc: string; [key: string]: unknown }

let ownShots: Shot[] = []
let applyCalls: { payload: unknown; opts?: { partial?: boolean } }[] = []

const adapter: WorkbenchChatAdapter = {
  surface: 'shots',
  skillId: 'shotlist',
  stage: 'shot',
  artifact: 'shots',
  writeTool: 'submit_shots',
  writeContract: 'shots-v1',
  threadKey: { project: 'paging-demo', surface: 'shots', episode: 1 },
  inputs: () => ({ style: 'S', aspect: '16:9', brief: 'B', target: 60 }),
  ownDraft: () => ownShots,
  projectSnapshot: async () => ({ name: 'paging-demo', source: 'S', logline: '', style: '', aspect: '16:9', shots: [] }),
  applyDraft: (payload, opts) => {
    applyCalls.push({ payload, opts })
    const incoming = Array.isArray((payload as { shots?: Shot[] }).shots) ? (payload as { shots: Shot[] }).shots : []
    // 与真实写回一致：按业务键 no 合并，后续批次覆盖同键字段、保留未提交的镜头
    const byNo = new Map(ownShots.map((s) => [s.no, s]))
    for (const shot of incoming) byNo.set(shot.no, { ...(byNo.get(shot.no) || {}), ...shot })
    const order = [...ownShots.map((s) => s.no), ...incoming.map((s) => s.no).filter((n) => !ownShots.some((s) => s.no === n))]
    ownShots = order.map((no) => byNo.get(no)!)
    return { ok: true, summary: `已写入 ${incoming.length} 镜`, counts: { total: ownShots.length } }
  },
}

const set = createStageToolSet(adapter)
const tools = bindSkillTools(set, [{ skill: readSkill('shotlist'), mode: 'host' }])
const submit = set.byName.get('submit_shots')!

const shot = (i: number, desc = `第 ${i} 镜`): Shot => ({
  no: `S${String(i).padStart(2, '0')}`,
  scene_no: 1,
  scene_slug: '街口',
  seconds: 3,
  size: '中景',
  move: '固定',
  desc,
})

await check('一次提交超过单批条数：只写前一批并给 nextCursor', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  const shots = Array.from({ length: 12 }, (_, i) => shot(i + 1)).map((s, i) => ({
    ...s,
    no: `S${String(i + 1).padStart(2, '0')}`,
  }))
  const r = (await submit.invoke({ shots })) as Record<string, unknown>
  assert.equal(r.ok, true, String(r.error))
  assert.equal(r.accepted, 8, `默认单批 8 条，实际 ${r.accepted}`)
  assert.equal(r.remaining, 4, `应剩 4 条，实际 ${r.remaining}`)
  assert.ok(typeof r.nextCursor === 'string' && r.nextCursor.length > 0, '必须给 nextCursor')
  assert.equal(applyCalls.length, 1)
  assert.equal(applyCalls[0].opts?.partial, true, '分批写入必须用 partial，避免缺席镜头被判删除')
  assert.equal(ownShots.length, 8)
})

await check('带 cursor 续写：剩余条目写完，顺序与一次写回一致', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  const shots = Array.from({ length: 12 }, (_, i) => shot(i + 1))
  const b1 = (await submit.invoke({ shots })) as Record<string, unknown>
  const b2 = (await submit.invoke({ cursor: b1.nextCursor })) as Record<string, unknown>
  assert.equal(b2.ok, true, String(b2.error))
  assert.equal(b2.accepted, 4)
  assert.equal(b2.remaining, 0)
  assert.equal(b2.nextCursor, undefined, '写完不应再给游标')
  assert.deepEqual(
    ownShots.map((s) => s.no),
    Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`),
    '最终镜号顺序必须与一次写回一致',
  )
  assert.equal(applyCalls.every((c) => c.opts?.partial), true)
})

await check('分批写入等价于一次写回', async () => {
  resetWritePaging()
  ownShots = []
  const shots = Array.from({ length: 12 }, (_, i) => shot(i + 1))
  let r = (await submit.invoke({ shots, limit: 4 })) as Record<string, unknown>
  let rounds = 1
  while (r.nextCursor && rounds < 10) {
    // 后续批次只带游标：宿主按默认单批条数把剩余条目写完
    r = (await submit.invoke({ cursor: r.nextCursor })) as Record<string, unknown>
    rounds += 1
  }
  assert.equal(ownShots.length, 12, `应写满 12 镜，实际 ${ownShots.length}`)
  assert.equal(r.remaining, 0)
  assert.equal(rounds, 2, `首批 4 镜 + 默认 8 镜应为 2 轮，实际 ${rounds}`)
})

await check('自造游标被拒绝并给出重读入口', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  const r = (await submit.invoke({ shots: [shot(1)], cursor: 'made-up-cursor' })) as Record<string, unknown>
  assert.equal(r.ok, false)
  assert.match(String(r.error), /宿主签发/)
  assert.match(String(r.hint), /read_shots/)
  assert.equal(applyCalls.length, 0, '非法游标不得写入')
})

await check('编辑状态变化后旧游标失效', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  const shots = Array.from({ length: 12 }, (_, i) => shot(i + 1))
  const b1 = (await submit.invoke({ shots })) as Record<string, unknown>
  // 模拟用户在批次之间改了草稿
  ownShots = [...ownShots, shot(99, '用户手改')]
  const b2 = (await submit.invoke({ cursor: b1.nextCursor })) as Record<string, unknown>
  assert.equal(b2.ok, false)
  assert.match(String(b2.error), /编辑状态已变化/)
  assert.match(String(b2.hint), /read_shots/)
  assert.equal(applyCalls.length, 1, '失效的批次不得写入')
})

await check('单条超过字符上限：不写入并给 suggestedLimit', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  const huge = shot(1, 'x'.repeat(30_000))
  const r = (await submit.invoke({ shots: [huge] })) as Record<string, unknown>
  assert.equal(r.ok, false)
  assert.ok(Number(r.suggestedLimit) >= 1, '必须给建议单批条数')
  assert.match(String(r.error), /超过单次上限/)
  assert.match(String(r.hint), /limit/)
  assert.match(String(r.hint), /cursor/)
  assert.equal(applyCalls.length, 0, '超限时不得调用 applyDraft')
  assert.equal(ownShots.length, 0, '超限时不得写入任何数据')
})

await check('分批写入不得把分页字段带进业务载荷', async () => {
  resetWritePaging()
  ownShots = []
  applyCalls = []
  await submit.invoke({ shots: Array.from({ length: 12 }, (_, i) => shot(i + 1)) })
  const text = JSON.stringify(applyCalls[0]?.payload)
  assert.ok(!text.includes('"cursor"'), '业务载荷不应含 cursor')
  assert.ok(!text.includes('"limit"'), '业务载荷不应含 limit')
})

await check('写工具声明暴露 cursor / limit 且不改变业务字段', () => {
  const tool = tools.find((t) => t.name === 'submit_shots')
  assert.ok(tool)
  const json = JSON.stringify(tool!.parameters ?? {})
  // 这里走的是 ToolDef 的 zod schema，声明层字段由 getContractToolSchema 注入
  const declared = JSON.stringify(submit.schema ? Object.keys((submit.schema as { shape?: object }).shape || {}) : [])
  assert.ok(json.length > 0)
  assert.match(declared, /cursor/)
  assert.match(declared, /limit/)
  assert.match(declared, /shots/)
})

await check('写工具描述说明分批参数与下一步', () => {
  const desc = String(submit.description || '')
  assert.match(desc, /cursor/)
  assert.match(desc, /limit/)
  assert.match(desc, /suggestedLimit|分批/)
  assert.match(desc, /未提交的条目不会被删除|按业务键合并/)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
