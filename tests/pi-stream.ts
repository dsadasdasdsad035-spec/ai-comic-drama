import assert from 'node:assert/strict'
import { runStageAgent } from '../src/agent/pi/stageRunner'
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

  const ask: SceneCodeAsk = async (o) => {
    o.onTextDelta?.('我先写个开场，然后准备写回分镜。')
    await sleep(5)
    return {
      text: '我先写个开场，然后准备写回分镜。',
      finishReason: 'length',
      // 被截断的半个 JSON：绝不能拿去执行，否则会按 partial 语义删掉镜头字段。
      toolCalls: [{ id: 'c1', name: 'submit_shots', arguments: '{"shots":[{"no":' }],
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

  assert.ok(result.error, '截断必须报错，不能静默当成功')
  assert.ok(/长度上限/.test(result.error!), `错误里应说明长度上限：${result.error}`)
  assert.equal(textOf(events), '我先写个开场，然后准备写回分镜。', '已流出的正文不能丢')
})

await check('纯文本被截断时给出可继续的提示', async () => {
  const events: AgentEvent[] = []

  const ask: SceneCodeAsk = async (o) => {
    o.onTextDelta?.('写到一半的镜号表：SHOT-01 推门而入，SHOT-02')
    await sleep(5)
    return { text: '写到一半的镜号表：SHOT-01 推门而入，SHOT-02', finishReason: 'length' }
  }

  const result = await runStageAgent({
    userText: '继续写',
    system: 'sys',
    tools: [],
    stage: 'creative',
    ask,
    onEvent: (e) => events.push(e),
  })

  assert.ok(result.error, '应提示内容被截断')
  assert.ok(/截断/.test(result.error!), `提示应说明截断：${result.error}`)
  assert.ok(textOf(events).startsWith('写到一半的镜号表'), '正文应保留在事件流里')
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

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
