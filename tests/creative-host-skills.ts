/**
 * 创意宿主门：宿主候选只看形态、下拉分组、空态文案、专家列表白名单。
 *
 * 这组断言针对一次真实故障：宿主候选曾按 `source ∈ {skillhub, upload}` 过滤，
 * 技能来源统一成内置后候选集变空，顶栏「偏好技能」只剩「自动」，而正文读取链路本身是好的。
 * 所以这里把「来源不该参与判定」写死成断言，避免再靠人眼复查。
 */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { defineTool } from '../src/agent/tool'
import {
  creativeHostBanner,
  groupCreativeHostSkills,
  isCreativeHostSkill,
  listCreativeHostSkills,
} from '../src/creative/creativeSkillHost'
import { wrapSkillListForExpert } from '../src/creative/expertTools'
import type { Skill, SkillSource } from '../src/skills/types'

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

function packSkill(id: string, source: SkillSource): Skill {
  return {
    id,
    manifest: {
      name: id,
      description: `${id} 说明`,
      stage: 'creative',
      runtime: 'tools',
      tools: ['read_skill_text'],
      inputs: [],
      output: 'agent-pack',
      contracts: [],
      version: 1,
    },
    role: '',
    task: '',
    text: `---\nname: ${id}\n---\n正文\n`,
    source,
    builtinText: '',
    profile: 'agent-pack',
    agentPack: { allowedTools: [] },
  }
}

/** 旧工作台技能：没有 agent-pack 形态，不能作宿主 */
function workbenchSkill(id: string, source: SkillSource): Skill {
  return {
    ...packSkill(id, source),
    profile: 'workbench',
    agentPack: undefined,
  }
}

const builtin = packSkill('builtin-drama', 'builtin')
const override = packSkill('overridden', 'override')
const market = packSkill('market-pack', 'skillhub')
const uploaded = packSkill('uploaded-pack', 'upload')
const legacy = workbenchSkill('legacy-workbench', 'builtin')
const all = [builtin, override, market, uploaded, legacy]

await check('四种来源的 Agent 包都算宿主', () => {
  for (const s of [builtin, override, market, uploaded]) {
    assert.equal(isCreativeHostSkill(s), true, `${s.id}（${s.source}）应可作宿主`)
  }
})

await check('旧工作台形态不算宿主', () => {
  assert.equal(isCreativeHostSkill(legacy), false)
})

await check('宿主候选集包含内置包，不按来源过滤', () => {
  const ids = listCreativeHostSkills(all).map((s) => s.id)
  assert.deepEqual(ids.sort(), ['builtin-drama', 'market-pack', 'overridden', 'uploaded-pack'])
})

await check('宿主候选集按名称排序且不含工作台技能', () => {
  const hosts = listCreativeHostSkills(all)
  assert.ok(!hosts.some((s) => s.id === 'legacy-workbench'))
  const names = hosts.map((s) => s.manifest.name)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'zh')))
})

await check('下拉按来源分组：内置与市场各一组', () => {
  const groups = groupCreativeHostSkills(listCreativeHostSkills(all))
  assert.deepEqual(groups.map((g) => g.label), ['内置技能', '市场安装'])
  assert.deepEqual(groups[0]!.options.map((o) => o.id).sort(), ['builtin-drama', 'overridden'])
  assert.deepEqual(groups[1]!.options.map((o) => o.id).sort(), ['market-pack', 'uploaded-pack'])
})

await check('空分组不出现在下拉里', () => {
  const onlyBuiltin = groupCreativeHostSkills([builtin])
  assert.deepEqual(onlyBuiltin.map((g) => g.label), ['内置技能'])
  const onlyMarket = groupCreativeHostSkills([market])
  assert.deepEqual(onlyMarket.map((g) => g.label), ['市场安装'])
})

await check('没有宿主时不渲染横幅前的分组', () => {
  assert.deepEqual(groupCreativeHostSkills([]), [])
})

await check('有宿主时不显示横幅', () => {
  assert.equal(creativeHostBanner(20, 20), null)
})

await check('有技能但无宿主：文案说明缺的是宿主而不是技能', () => {
  const banner = creativeHostBanner(3, 0)
  assert.ok(banner)
  assert.match(banner!.text, /已有 3 个技能/)
  assert.match(banner!.text, /没有可作宿主的 Agent 包/)
  assert.doesNotMatch(banner!.text, /技能目录为空/)
})

await check('技能目录为空：文案才说目录为空', () => {
  const banner = creativeHostBanner(0, 0)
  assert.ok(banner)
  assert.match(banner!.text, /技能目录为空/)
})

/** 构造一个假的 list_installed_skills，只关心返回结构 */
function fakeListTool(rows: Array<{ id: string }>): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'list_installed_skills',
    description: '假实现',
    schema: z.object({}),
    run: async () => ({ ok: true, count: rows.length, skills: rows, loadIssues: [] }),
  })
}

const expertOf = (skillIds: string[]) => ({ id: 'e1', name: '测试专家', skillIds })

await check('专家白名单过滤 list_installed_skills', async () => {
  const tool = wrapSkillListForExpert(
    fakeListTool([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    expertOf(['a', 'c']),
  )
  const out = (await tool.run({})) as { count: number; skills: Array<{ id: string }>; note?: string }
  assert.deepEqual(out.skills.map((s) => s.id), ['a', 'c'])
  assert.equal(out.count, 2)
})

await check('受限专家回执说明被限制的数量', async () => {
  const tool = wrapSkillListForExpert(
    fakeListTool([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    expertOf(['a']),
  )
  const out = (await tool.run({})) as { note?: string }
  assert.match(String(out.note), /另有 2 个技能/)
  assert.match(String(out.note), /测试专家/)
})

await check('通配专家不过滤也不加说明', async () => {
  const tool = wrapSkillListForExpert(
    fakeListTool([{ id: 'a' }, { id: 'b' }]),
    expertOf(['*']),
  )
  const out = (await tool.run({})) as { count: number; skills: Array<{ id: string }>; note?: string }
  assert.deepEqual(out.skills.map((s) => s.id), ['a', 'b'])
  assert.equal(out.note, undefined)
})

await check('空白名单专家列表为空且说明未配置', async () => {
  const tool = wrapSkillListForExpert(fakeListTool([{ id: 'a' }]), expertOf([]))
  const out = (await tool.run({})) as { count: number; skills: unknown[]; note?: string }
  assert.deepEqual(out.skills, [])
  assert.equal(out.count, 0)
  assert.match(String(out.note), /未配置可读技能/)
})

await check('非 list 工具不被包装（无专家路径不受影响）', () => {
  const other = defineTool({
    name: 'read_shots',
    description: '别的工具',
    schema: z.object({}),
    run: async () => ({ ok: true }),
  })
  assert.equal(wrapSkillListForExpert(other, expertOf([])), other)
})

/**
 * 用假 `/api/skills` 驱动真实的 `list_installed_skills`，验证 `hostsOnly`
 * 与 `listCreativeHostSkills` 是同一个口径——两处各写一遍正是这次故障的来源。
 */
const recordOf = (s: Skill) => ({
  id: s.id,
  text: s.text,
  builtinText: '',
  source: s.source,
})
const records = [
  recordOf(builtin),
  recordOf(override),
  recordOf(market),
  recordOf(uploaded),
  // 工作台形态：有 stage / ## 任务，解析期就该被拒，不能进宿主候选
  {
    id: 'legacy-workbench',
    text: '---\nname: legacy-workbench\nstage: creative\n---\n## 任务\n旧形态\n',
    builtinText: '',
    source: 'builtin' as SkillSource,
  },
]

globalThis.fetch = (async (url: string) => {
  if (String(url).includes('/api/skills')) {
    return new Response(JSON.stringify({ ok: true, skills: records }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
  throw new Error(`未预期的请求：${url}`)
}) as typeof fetch

const { createPiNativeToolSet } = await import('../src/agent/stageTools')
const { parseSkillRecords } = await import('../src/skills/validate')

await check('hostsOnly 与宿主候选集完全一致（含内置来源）', async () => {
  const tool = createPiNativeToolSet().byName.get('list_installed_skills')
  assert.ok(tool, '缺少 list_installed_skills')
  const out = (await tool!.run({ hostsOnly: true })) as {
    ok: boolean
    count: number
    skills: Array<{ id: string; source: string }>
  }
  assert.equal(out.ok, true)
  const viaFilter = listCreativeHostSkills(parseSkillRecords(records).skills.values())
    .map((s) => s.id)
    .sort()
  assert.deepEqual(out.skills.map((s) => s.id).sort(), viaFilter)
  assert.equal(out.count, viaFilter.length)
  assert.deepEqual(out.skills.map((s) => s.source).sort(), ['builtin', 'override', 'skillhub', 'upload'])
})

await check('hostsOnly 剔除旧工作台形态', async () => {
  const tool = createPiNativeToolSet().byName.get('list_installed_skills')!
  const out = (await tool.run({ hostsOnly: true })) as { skills: Array<{ id: string }> }
  assert.ok(!out.skills.some((s) => s.id === 'legacy-workbench'))
})

await check('不带 hostsOnly 时仍列出全部可解析技能', async () => {
  const tool = createPiNativeToolSet().byName.get('list_installed_skills')!
  const out = (await tool.run({})) as { skills: Array<{ id: string }> }
  assert.deepEqual(out.skills.map((s) => s.id).sort(), [
    'builtin-drama',
    'market-pack',
    'overridden',
    'uploaded-pack',
  ])
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 创意宿主门全部通过')
process.exit(bad ? 1 : 0)
