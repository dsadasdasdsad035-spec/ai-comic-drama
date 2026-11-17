import assert from 'node:assert/strict'
import { runStageAgent } from '../src/agent/pi/stageRunner'
import { createPiStreamFn } from '../src/agent/pi/streamFn'
import { lengthExhaustedMessage } from '../src/agent/pi/lengthContinuation'
import type { AgentEvent } from '../src/agent/sceneAgentTypes'
import type { SceneCodeAsk } from '../src/sceneCodeJob'

/**
 * 创意/分镜聊天的输出链路：
 * - 正文必须真流式（ask 还没返回，增量就已进事件流）
 * - 撞上限时已经流出的正文不能丢
 * - 没有显式要求时不下发 maxTokens
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

const textOf = (events: AgentEvent[]): string =>
  events
    .filter((e): e is Extract<AgentEvent, { type: 'text_message_content' }> => e.type === 'text_message_content')
    .map((e) => e.delta)
    .join('')

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms))

await check('正文在 ask 返回前就进事件流（真流式，不是整段回灌）', async () => {
  const events: AgentEvent[] = []
  let seenMidway = false

  const ask: SceneCodeAsk = async (o) => {
    o.onTextDelta?.('第一段')
    // 让 pi 的迭代器有机会消费已推入的事件；随后再检查。
    await sleep(5)
    seenMidway = textOf(events) === '第一段'
    o.onTextDelta?.('第二段')
    await sleep(5)
    return { text: '第一段第二段', finishReason: 'stop' }
  }

  const result = await runStageAgent({
    userText: '随便写两句',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: (e) => events.push(e),
  })

  assert.equal(result.error, undefined, `不应报错：${result.error}`)
  assert.ok(seenMidway, '第一段必须在 ask 返回前就出现在事件流里')
  assert.equal(textOf(events), '第一段第二段', '拼接后的正文应与模型输出一致')
  // message_end 会把整段正文回填到 step 事件，供线程保存使用。
  const stepEnd = events.find(
    (e): e is Extract<AgentEvent, { type: 'agent_step' }> =>
      e.type === 'agent_step' && e.phase === 'end' && Boolean(e.text),
  )
  assert.ok(stepEnd, 'step 结束事件应带完整正文')
  assert.ok(String(stepEnd.text).includes('第一段第二段'))
})

await check('输出被截断时保留已流出的正文（工具参数不完整）', async () => {
  const events: AgentEvent[] = []
  let calls = 0

  const ask: SceneCodeAsk = async (o) => {
    calls += 1
    o.onTextDelta?.(`第${calls}次尝试。`)
    await sleep(5)
    return {
      text: `第${calls}次尝试。`,
      finishReason: 'length',
      // 被截断的半个 JSON：绝不能拿去执行，否则会按 partial 语义删掉镜头字段。
      toolCalls: [{ id: `c${calls}`, name: 'submit_shots', arguments: '{"shots":[{"no":' }],
    }
  }

  const result = await runStageAgent({
    userText: '把这集拆成分镜',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: (e) => events.push(e),
  })

  assert.ok(result.error, '续写次数用尽后必须报错，不能静默当成功')
  assert.ok(/长度上限/.test(result.error!), `错误里应说明长度上限：${result.error}`)
  assert.ok(/分批/.test(result.error!), `工具参数截断应给出拆批出路：${result.error}`)
  // 首发 + 2 次工具续写
  assert.equal(calls, 3, `应连续续写 2 次后再放弃，实际调用 ${calls} 次`)
  assert.equal(textOf(events), '第1次尝试。第2次尝试。第3次尝试。', '每段已流出的正文都要保留')
  assert.ok(
    !events.some((e) => e.type === 'tool_start'),
    '半截工具参数绝不能触发工具执行',
  )
  const nudges = events.filter((e) => e.type === 'custom' && e.name === 'continuation')
  assert.equal(nudges.length, 2, '每次续写都要有可见的续写事件')
})

await check('纯文本被截断时自动续写并拼接正文', async () => {
  const events: AgentEvent[] = []
  let calls = 0

  const ask: SceneCodeAsk = async (o) => {
    calls += 1
    if (calls < 3) {
      o.onTextDelta?.(`SHOT-0${calls} 推门而入，`)
      await sleep(5)
      return { text: `SHOT-0${calls} 推门而入，`, finishReason: 'length' }
    }
    o.onTextDelta?.('SHOT-03 转身。')
    await sleep(5)
    return { text: 'SHOT-03 转身。', finishReason: 'stop' }
  }

  const result = await runStageAgent({
    userText: '继续写',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: (e) => events.push(e),
  })

  assert.equal(result.error, undefined, `续写成功不应报错：${result.error}`)
  assert.equal(calls, 3, '应续写 2 次后正常收尾')
  assert.equal(textOf(events), 'SHOT-01 推门而入，SHOT-02 推门而入，SHOT-03 转身。', '正文首尾相接')
  // 推动消息不能伪装成用户气泡：accept 的只有续写事件
  const userMsgs = events.filter((e) => e.type === 'message' && e.role === 'user')
  assert.equal(userMsgs.length, 0, '续写推动消息不能进用户消息事件')
})

await check('撞长度上限的纯文本：正常收尾并标记可续写', async () => {
  const kinds: string[] = []
  const stream = createPiStreamFn({
    ask: async (o) => {
      o.onTextDelta?.('SHOT-01 推门而入，SHOT-02')
      await sleep(5)
      return { text: 'SHOT-01 推门而入，SHOT-02', finishReason: 'length' }
    },
    onLengthStop: (kind) => kinds.push(kind),
  })({ id: 'm', api: 'openai-completions', provider: 'p' } as never, { messages: [] } as never, {})

  const events: unknown[] = []
  for await (const event of stream) events.push(event)
  const final = await stream.result()

  const types = (events as { type: string }[]).map((e) => e.type)
  assert.ok(!types.includes('error'), '截断不应编码成 error 事件')
  assert.ok(types.includes('done'), '应正常收尾')
  assert.equal(kinds[0], 'text', '应标记为正文截断')
  assert.equal(final.stopReason, 'length')
  assert.deepEqual(final.content, [{ type: 'text', text: 'SHOT-01 推门而入，SHOT-02' }], '已流出的正文必须保留')
})

await check('撞长度上限时丢弃半截工具调用', async () => {
  const kinds: string[] = []
  const stream = createPiStreamFn({
    ask: async (o) => {
      o.onTextDelta?.('准备写回分镜')
      await sleep(5)
      return {
        text: '准备写回分镜',
        finishReason: 'length',
        toolCalls: [{ id: 'c1', name: 'submit_shots', arguments: '{"shots":[{"no":' }],
      }
    },
    onLengthStop: (kind) => kinds.push(kind),
  })({ id: 'm', api: 'openai-completions', provider: 'p' } as never, { messages: [] } as never, {})

  const events: unknown[] = []
  for await (const event of stream) events.push(event)
  const final = await stream.result()

  const types = (events as { type: string }[]).map((e) => e.type)
  assert.ok(!types.some((t) => t.startsWith('toolcall_')), '半截参数不能进工具调用事件')
  assert.equal(kinds[0], 'tools', '应标记为工具参数截断')
  assert.ok(
    !final.content.some((part) => (part as { type?: string }).type === 'toolCall'),
    '截断的工具调用不能留在消息里',
  )
  assert.deepEqual(final.content, [{ type: 'text', text: '准备写回分镜' }])
})

await check('没有显式要求时不下发 maxTokens', async () => {
  let seen: number | undefined
  let sawKey = false

  const ask: SceneCodeAsk = async (o) => {
    sawKey = Object.prototype.hasOwnProperty.call(o, 'maxTokens')
    seen = o.maxTokens
    o.onTextDelta?.('ok')
    await sleep(5)
    return { text: 'ok', finishReason: 'stop' }
  }

  await runStageAgent({
    userText: 'hi',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: () => {},
  })

  assert.equal(seen, undefined, '创意环节不应再写死 8192')
  assert.equal(sawKey, false, '不传就不要带这个字段')
})

await check('显式要求时仍然下发 maxTokens', async () => {
  let seen: number | undefined

  const ask: SceneCodeAsk = async (o) => {
    seen = o.maxTokens
    o.onTextDelta?.('ok')
    await sleep(5)
    return { text: 'ok', finishReason: 'stop' }
  }

  await runStageAgent({
    userText: 'hi',
    system: 'sys',
    tools: [],
    maxTokens: 2048,
    ask,
    onEvent: () => {},
  })

  assert.equal(seen, 2048)
})

await check('续写用尽后的错误说明预算来源（渠道默认）', async () => {
  let calls = 0
  const ask: SceneCodeAsk = async (o) => {
    calls += 1
    o.onTextDelta?.('写到一半')
    await sleep(3)
    return { text: '写到一半', finishReason: 'length' }
  }
  const result = await runStageAgent({
    userText: '一直写',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: () => {},
  })
  assert.ok(result.error, '用尽续写次数应返回可读错误')
  assert.match(String(result.error), /长度上限/)
  assert.match(String(result.error), /渠道默认/, String(result.error))
  assert.equal(calls, 4, '首轮 + 3 次续写后停止')
})

await check('续写用尽后的错误带上配置的实际预算数字', async () => {
  const ask: SceneCodeAsk = async () => ({ text: '片段', finishReason: 'length' })
  const result = await runStageAgent({
    userText: '一直写',
    system: 'sys',
    tools: [],
    maxTokens: 6400,
    ask,
    onEvent: () => {},
  })
  assert.ok(result.error, '应返回可读错误')
  assert.match(String(result.error), /6400/, String(result.error))
  assert.match(String(result.error), /设置页配置/, String(result.error))
})

await check('环节默认预算与未配置预算的文案可区分', () => {
  assert.match(lengthExhaustedMessage('text', { maxTokens: 8000, source: 'stage-default' }), /8000 tokens（环节默认）/)
  assert.match(lengthExhaustedMessage('tools', { source: 'unset' }), /渠道默认/)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
