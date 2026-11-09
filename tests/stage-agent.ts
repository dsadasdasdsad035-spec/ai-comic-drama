import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createStageToolSet, bindSkillTools } from '../src/agent/stageTools'
import { runStageAgent } from '../src/agent/pi/stageRunner'
import type { WorkbenchChatAdapter } from '../src/agent/workbenchChat'
import { parseSkillText } from '../src/skills/parse'
import type { AgentEvent } from '../src/agent/sceneAgentTypes'

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
  parseSkillText(id, fs.readFileSync(path.join(root, 'skills', id, 'SKILL.md'), 'utf8'), 'builtin')
const shotlistSkill = readSkill('shotlist')
const characterSkill = readSkill('character')

const validShots = {
  shots: [
    {
      no: 'S01',
      scene_no: 1,
      scene_slug: '街口',
      seconds: 3,
      size: '中景',
      move: '固定',
      desc: '夜色街口',
      dialogue: [],
      cast: ['A'],
    },
  ],
}

let ownShots = [{ id: 'E01-S01', episode: 1, no: 'S01', desc: 'OLD' }]
let applied: unknown = null
const adapter: WorkbenchChatAdapter = {
  surface: 'shots',
  skillId: 'shotlist',
  stage: 'shot',
  artifact: 'shots',
  writeTool: 'submit_shots',
  writeContract: 'shots-v1',
  threadKey: { project: 'demo', surface: 'shots', episode: 1 },
  inputs: () => ({ style: 'S', aspect: '16:9', brief: 'B', target: 60 }),
  ownDraft: () => ownShots,
  projectSnapshot: async () => ({
    source: 'SAVED_SOURCE',
    shots: [{ id: 'E01-S02', episode: 1, no: 'S02' }],
    characters: [{ name: 'A' }],
  }),
  applyDraft: (payload) => {
    applied = payload
    const shots = Array.isArray((payload as { shots?: unknown[] }).shots)
      ? ((payload as { shots: unknown[] }).shots as typeof ownShots)
      : []
    ownShots = shots as typeof ownShots
    return { ok: true, summary: `已写入 ${shots.length} 镜`, counts: { total: shots.length, added: 1, updated: 0 } }
  },
}

const set = createStageToolSet(adapter)
const hostTools = bindSkillTools(set, [{ skill: shotlistSkill, mode: 'host' }])
const mixedTools = bindSkillTools(set, [
  { skill: shotlistSkill, mode: 'host' },
  { skill: characterSkill, mode: 'readonly' },
])

await check('宿主绑定读工具和写工具', () => {
  const names = hostTools.map((t) => t.name).sort()
  assert.ok(names.includes('read_source'))
  assert.ok(names.includes('read_episodes'))
  assert.ok(names.includes('submit_shots'))
})

await check('只读技能不获得写工具', () => {
  const names = mixedTools.map((t) => t.name)
  assert.ok(names.includes('read_characters'))
  assert.ok(names.includes('submit_shots'), '宿主写工具仍在')
  assert.ok(!names.includes('submit_characters'), '只读技能不引入自己的写工具')
})

await check('read_source 读已保存项目梗概', async () => {
  const tool = set.byName.get('read_source')
  const r = (await tool!.invoke({})) as { source: string }
  assert.equal(r.source, 'SAVED_SOURCE')
})

await check('read_shots 在读活草稿', async () => {
  const tool = set.byName.get('read_shots')
  const r = (await tool!.invoke({})) as { shots: { desc: string }[] }
  assert.equal(r.shots[0].desc, 'OLD')
})

await check('submit_shots 调用宿主合并并回摘要', async () => {
  const tool = set.byName.get('submit_shots')
  const r = (await tool!.invoke(validShots)) as { ok: boolean; summary: string; counts?: Record<string, number> }
  assert.equal(r.ok, true)
  assert.ok(r.summary.includes('1 镜'))
  assert.deepEqual(r.counts, { total: 1, added: 1, updated: 0 })
})

await check('submit_shots 拒绝空镜表', async () => {
  const tool = set.byName.get('submit_shots')
  await assert.rejects(async () => tool!.invoke({ shots: [] }))
})

await check('runStageAgent 执行工具循环并发出事件', async () => {
  let call = 0
  const events: AgentEvent[] = []
  const ask = async (o: { messages: { role: string; content: string }[]; tools?: unknown[] }) => {
    call++
    const system = o.messages.find((m) => m.role === 'system')?.content || ''
    if (call === 1) {
      assert.ok(system.includes('你是分镜师'), 'system 应包含技能角色层')
      assert.ok(Array.isArray(o.tools) && o.tools.length > 0, '应声明原生工具')
      const user = o.messages.find((m) => m.role === 'user')?.content || ''
      assert.ok(!user.includes('你是分镜师'), '技能正文不应混进 user 消息')
      return {
        text: '提交镜头草稿',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'submit_shots', arguments: JSON.stringify(validShots) }],
        modelLabel: 'mock',
      } as never
    }
    assert.ok(
      o.messages.some((m) => m.role === 'tool'),
      '第二轮应看到工具结果',
    )
    return { text: '镜头草稿已更新', finishReason: 'stop', modelLabel: 'mock' } as never
  }
  const result = await runStageAgent({
    userText: '再拆一镜',
    system: `${shotlistSkill.role}\n\n【固定协议】`,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
    maxSteps: 8,
    onEvent: (e) => events.push(e),
  })
  assert.equal(result.error, undefined)
  assert.ok(call >= 2)
  assert.ok(events.some((e) => e.type === 'tool_start' && e.toolName === 'submit_shots'))
  assert.ok(events.some((e) => e.type === 'tool_end' && e.toolName === 'submit_shots'))
  assert.ok(events.some((e) => e.type === 'agent_step' && e.phase === 'end' && e.text?.includes('已更新')))
})

await check('runStageAgent 超过步数上限报错', async () => {
  const ask = async () =>
    ({
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: `c${Math.random()}`, name: 'read_source', arguments: '{}' }],
      modelLabel: 'mock',
    }) as never
  const events: AgentEvent[] = []
  const result = await runStageAgent({
    userText: '一直读',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
    maxSteps: 2,
    onEvent: (e) => events.push(e),
  })
  assert.ok(result.error?.includes('上限'))
  assert.ok(events.some((e) => e.type === 'error'))
})

await check('契约失败不写草稿', async () => {
  applied = null
  const tool = set.byName.get('submit_shots')
  await assert.rejects(async () => tool!.invoke({ shots: [] }))
  assert.equal(applied, null)
})

await check('模型失败不写草稿', async () => {
  applied = null
  const ask = async () => {
    throw new Error('网络失败')
  }
  const result = await runStageAgent({
    userText: '拆镜',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
  })
  assert.ok(result.error?.includes('网络失败'))
  assert.equal(applied, null)
})

await check('取消后不写草稿', async () => {
  applied = null
  const controller = new AbortController()
  const events: AgentEvent[] = []
  const ask = async () => {
    controller.abort()
    return {
      text: '',
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'call_1', name: 'submit_shots', arguments: JSON.stringify(validShots) }],
      modelLabel: 'mock',
    } as never
  }
  const result = await runStageAgent({
    userText: '拆镜',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
    signal: controller.signal,
    onEvent: (e) => events.push(e),
  })
  assert.equal(result.cancelled, true)
  assert.equal(applied, null)
  assert.ok(events.some((e) => e.type === 'cancelled'))
})

await check('镜头工作台读自己的未保存草稿、读上游已保存角色', async () => {
  let shotApplied: unknown = null
  const shotsAdapter: WorkbenchChatAdapter = {
    surface: 'shots',
    skillId: 'shotlist',
    stage: 'shot',
    artifact: 'shots',
    writeTool: 'submit_shots',
    writeContract: 'shots-v1',
    threadKey: { project: 'demo', surface: 'shots', episode: 1 },
    inputs: () => ({ style: 'S', aspect: '16:9', brief: 'B', target: 60 }),
    ownDraft: () => [{ id: 'E01-S01', episode: 1, no: 'S01', desc: 'UNSAVED' }],
    projectSnapshot: async () => ({
      shots: [{ id: 'E02-S99', episode: 2, no: 'S99', desc: 'SAVED' }],
      characters: [{ name: '陈默', look_en: 'LOOK' }],
    }),
    applyDraft: (payload) => {
      shotApplied = payload
      return { ok: true, summary: '已写入 1 镜', counts: { total: 1, added: 0, updated: 1 } }
    },
  }
  const shotSet = createStageToolSet(shotsAdapter)
  const own = (await shotSet.byName.get('read_shots')!.invoke({ episode: 1 })) as { shots: { desc: string }[] }
  assert.equal(own.shots[0].desc, 'UNSAVED')
  const upstream = (await shotSet.byName.get('read_characters')!.invoke({})) as { characters: { name: string }[] }
  assert.equal(upstream.characters[0].name, '陈默')
  const submitted = (await shotSet.byName.get('submit_shots')!.invoke({
    shots: [{ no: 'S01', scene_no: 1, scene_slug: '街口', seconds: 3, size: '中景', move: '固定', desc: 'NEW' }],
  })) as { ok: boolean; summary: string }
  assert.equal(submitted.ok, true)
  assert.ok(submitted.summary.includes('1 镜'))
  assert.ok(shotApplied)
})


await check('工具执行中取消不产生后续事件', async () => {
  applied = null
  const controller = new AbortController()
  const events: AgentEvent[] = []
  let askRound = 0
  const ask = async () => {
    askRound += 1
    if (askRound === 1) {
      return {
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_1', name: 'read_source', arguments: '{}' }],
        modelLabel: 'mock',
      } as never
    }
    // 第二轮请求在取消后不应再发生
    return { text: '不应到达', finishReason: 'stop', toolCalls: [], modelLabel: 'mock' } as never
  }
  const result = await runStageAgent({
    userText: '读一下再取消',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
    signal: controller.signal,
    onEvent: (e) => {
      events.push(e)
      // READ 工具执行期间触发取消
      if (e.type === 'tool_start' && e.toolName === 'read_source') controller.abort()
    },
  })
  assert.equal(result.cancelled, true)
  assert.equal(applied, null, '取消后不得写草稿')
  const afterCancel = events.slice(events.findIndex((e) => e.type === 'cancelled') + 1)
  assert.deepEqual(
    afterCancel.filter((e) => e.type === 'tool_start' || e.type === 'tool_end'),
    [],
    '取消后不得出现新的工具事件',
  )
  assert.ok(!events.some((e) => e.type === 'agent_step' && e.phase === 'end' && e.text === '不应到达'))
})

await check('超时返回可读错误并提前结束', async () => {
  const started = Date.now()
  const ask = async () => {
    // 模拟渠道挂住：直到被取消才返回
    await new Promise((resolve) => setTimeout(resolve, 5000))
    return { text: '慢', finishReason: 'stop', toolCalls: [], modelLabel: 'mock' } as never
  }
  const events: AgentEvent[] = []
  const result = await runStageAgent({
    userText: '超时',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
    totalMs: 800,
    onEvent: (e) => events.push(e),
  })
  const elapsed = Date.now() - started
  assert.ok(result.error?.includes('运行超时'), String(result.error))
  assert.ok(elapsed < 4000, `超时未提前结束：${elapsed}ms`)
  assert.ok(events.some((e) => e.type === 'error'))
})

await check('有图时第二条参数进入用户消息，无图时仍是字符串', async () => {
  const seen: { content: unknown }[] = []
  const ask = async (o: { messages: { role: string; content: unknown }[] }) => {
    const user = o.messages.find((m) => m.role === 'user')
    if (user) seen.push({ content: user.content })
    return { text: '收到', finishReason: 'stop', modelLabel: 'mock' } as never
  }
  await runStageAgent({
    userText: '只看文字',
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
  })
  assert.equal(typeof seen[0]?.content, 'string')
  seen.length = 0
  await runStageAgent({
    userText: '看图',
    images: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    system: shotlistSkill.role,
    tools: hostTools,
    stage: 'shot',
    ask: ask as never,
  })
  const content = seen[0]?.content
  assert.ok(Array.isArray(content))
  assert.equal((content as { type: string; data?: string }[]).some((part) => part.type === 'image' && part.data === 'AAAA'), true)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
