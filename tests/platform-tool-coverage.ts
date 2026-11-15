/**
 * 平台工具覆盖面与一致性验收（纯函数，不需要 dev server）。
 *
 * 覆盖：清单↔注册双向一致、默认专家白名单包含关系、技能声明缺失工具的可见提示。
 */
import assert from 'node:assert/strict'
import {
  assertPlatformToolConsistency,
  builtinPlatformToolNames,
  createBuiltinPlatformTools,
  platformToolNameDiff,
} from '../src/agent/builtinPlatformTools'
import { bindSkillTools, bindSkillToolsDetailed, createPiNativeToolSet } from '../src/agent/stageTools'
import { DEFAULT_EXPERT_PLATFORM_TOOLS } from '../src/creative/expertToolGroups'
import type { Skill } from '../src/skills/types'

let bad = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✅ ${name}`)
    })
    .catch((e) => {
      bad++
      console.log(`❌ ${name}\n   ${(e as Error).message}`)
    })
}

const platform = createBuiltinPlatformTools({ projectName: 'verify', epNo: 1 })
const registered = platform.map((t) => t.name)

function fakeSkill(id: string, tools: string[]): Skill {
  return {
    id,
    source: 'builtin',
    manifest: {
      id,
      name: id,
      version: 1,
      stage: 'script',
      output: 'script-v1',
      tools,
      contracts: [],
      description: '',
    },
  } as unknown as Skill
}

async function main() {
  await check('真实工具集通过清单一致性校验', () => {
    const diff = platformToolNameDiff(registered)
    assert.deepEqual(diff.declaredNotRegistered, [])
    assert.deepEqual(diff.registeredNotDeclared, [])
    assert.deepEqual(diff.expertNotDeclared, [])
    assert.doesNotThrow(() => assertPlatformToolConsistency(registered))
  })

  await check('清单有、注册无时抛错并指出缺失名字', () => {
    const missing = registered.filter((n) => n !== 'read_shots')
    const diff = platformToolNameDiff(missing)
    assert.deepEqual(diff.declaredNotRegistered, ['read_shots'])
    assert.throws(
      () => assertPlatformToolConsistency(missing),
      (e: Error) => e.message.includes('清单有但未注册') && e.message.includes('read_shots'),
    )
  })

  await check('注册有、清单无时抛错并指出多余名字', () => {
    const extra = [...registered, 'ghost_tool']
    const diff = platformToolNameDiff(extra)
    assert.deepEqual(diff.registeredNotDeclared, ['ghost_tool'])
    assert.throws(
      () => assertPlatformToolConsistency(extra),
      (e: Error) => e.message.includes('已注册但未列入清单') && e.message.includes('ghost_tool'),
    )
  })

  await check('默认专家白名单是平台清单的子集', () => {
    const declared = new Set(builtinPlatformToolNames())
    const ghost = DEFAULT_EXPERT_PLATFORM_TOOLS.filter((n) => !declared.has(n))
    assert.deepEqual(ghost, [], `白名单里出现未注册名字：${ghost.join('、')}`)
    for (const name of DEFAULT_EXPERT_PLATFORM_TOOLS) {
      assert.ok(registered.includes(name), `默认专家工具 ${name} 应真实注册`)
    }
  })

  await check('submit_prompt_renders 不再出现在默认专家白名单', () => {
    assert.ok(!DEFAULT_EXPERT_PLATFORM_TOOLS.includes('submit_prompt_renders'))
  })

  await check('技能声明未注册工具时回报缺失且不绑定', () => {
    const { tools, skipped } = bindSkillToolsDetailed(createPiNativeToolSet(), [
      { skill: fakeSkill('fake-host', ['read_skill', 'not_a_real_tool']), mode: 'host' },
    ])
    const names = tools.map((t) => t.name)
    assert.ok(names.includes('read_skill'), '已注册工具应被绑定')
    assert.ok(!names.includes('not_a_real_tool'), '未注册工具不应被绑定')
    const hit = skipped.find((s) => s.name === 'not_a_real_tool')
    assert.ok(hit, '缺失工具应出现在 skipped 清单')
    assert.equal(hit?.skillId, 'fake-host')
    assert.ok(hit?.reason.includes('没有注册'))
  })

  await check('只读技能声明写回工具时回报原因且不绑定', () => {
    const { tools, skipped } = bindSkillToolsDetailed(createPiNativeToolSet(), [
      { skill: fakeSkill('fake-readonly', ['submit_shots']), mode: 'readonly' },
    ])
    assert.ok(!tools.map((t) => t.name).includes('submit_shots'))
    const hit = skipped.find((s) => s.name === 'submit_shots')
    assert.ok(hit?.reason.includes('只读技能'))
  })

  await check('bindSkillTools 把跳过清单交给调用方', () => {
    let seen: string[] = []
    bindSkillTools(
      createPiNativeToolSet(),
      [{ skill: fakeSkill('fake-host', ['ghost_one', 'ghost_two']), mode: 'host' }],
      { onSkipped: (list) => (seen = list.map((s) => s.name)) },
    )
    assert.deepEqual(seen.sort(), ['ghost_one', 'ghost_two'])
  })

  await check('没有跳过时不触发回调', () => {
    let called = false
    bindSkillTools(
      createPiNativeToolSet(),
      [{ skill: fakeSkill('fake-ok', ['read_skill']), mode: 'host' }],
      { onSkipped: () => (called = true) },
    )
    assert.equal(called, false)
  })

  await check('画风未填时 read_source 返回空值而不是默认画风', async () => {
    const tools = createBuiltinPlatformTools({
      projectName: 'verify-empty-style',
      epNo: 1,
      getSnapshot: () =>
        ({ name: '空设定项目', source: '正文', shots: [], characters: [], designs: [] }) as never,
    })
    const readSource = tools.find((t) => t.name === 'read_source')
    assert.ok(readSource, 'read_source 应存在')
    const r = (await readSource!.invoke({})) as Record<string, unknown>
    assert.equal(r.title, '空设定项目')
    assert.equal(r.style, '')
    assert.equal(r.aspect, '')
    assert.equal(r.logline, '')
  })

  console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 平台工具一致性全部通过')
  process.exit(bad ? 1 : 0)
}

void main()
