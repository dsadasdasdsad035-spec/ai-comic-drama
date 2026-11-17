import assert from 'node:assert/strict'
import { applyAgentEvent } from '../src/agent/agentMessageReducer'
import { isNoticeEventName, AGENT_NOTICE_EVENTS } from '../src/agent/sceneAgentTypes'
import type { AgentEvent, AgentMessage, AgentNoticePart } from '../src/agent/sceneAgentTypes'

/**
 * 续写 / 上下文压缩必须「看得见且可回看」：
 * - 落成独立 notice 部件，不覆盖轮次步骤、不生成用户气泡
 * - 同类提示不重复堆叠
 * - 不在正文里伪造助手说的话
 */

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

const base = (): AgentMessage => ({ id: 'm1', role: 'assistant', parts: [], status: 'running' })
const notices = (message: AgentMessage) =>
  message.parts.filter((p): p is AgentNoticePart => p.type === 'notice')

check('两种提示事件名被登记为 notice', () => {
  assert.deepEqual([...AGENT_NOTICE_EVENTS], ['continuation', 'context_compaction'])
  assert.equal(isNoticeEventName('continuation'), true)
  assert.equal(isNoticeEventName('progress'), false)
})

check('续写事件生成一条 notice，不生成用户气泡', () => {
  const event: AgentEvent = {
    type: 'custom',
    name: 'continuation',
    value: { attempt: 2, total: 3, reason: 'text' },
  }
  const next = applyAgentEvent(base(), event)
  const list = notices(next)
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'continuation')
  assert.match(list[0].text, /长度上限/)
  assert.match(list[0].text, /2\/3/)
  assert.equal(next.parts.some((p) => p.type === 'text'), false, '提示不能混进助手正文')
})

check('工具参数截断的续写提示说明「分批」', () => {
  const next = applyAgentEvent(base(), {
    type: 'custom',
    name: 'continuation',
    value: { attempt: 1, total: 2, reason: 'tools' },
  } as AgentEvent)
  assert.match(notices(next)[0].text, /工具参数|分批/)
})

check('上下文溢出压缩事件生成 notice 且说明历史仍保留', () => {
  const next = applyAgentEvent(base(), {
    type: 'custom',
    name: 'context_compaction',
    value: { reason: 'context-overflow', retry: 1, budget: 12000 },
  } as AgentEvent)
  const list = notices(next)
  assert.equal(list.length, 1)
  assert.equal(list[0].kind, 'context_compaction')
  assert.match(list[0].text, /上下文超限/)
  assert.match(list[0].text, /保留/)
})

check('历史预算压缩事件报告卸载与摘要数量', () => {
  const next = applyAgentEvent(base(), {
    type: 'custom',
    name: 'context_compaction',
    value: { stubbed: 7, summarized: 3, charsBefore: 91000, charsAfter: 40500 },
  } as AgentEvent)
  const text = notices(next)[0].text
  assert.match(text, /7 条/)
  assert.match(text, /3 轮/)
  assert.match(text, /40500/)
})

check('同类提示不重复堆叠', () => {
  const event: AgentEvent = {
    type: 'custom',
    name: 'continuation',
    value: { attempt: 1, total: 3, reason: 'text' },
  }
  const once = applyAgentEvent(base(), event)
  const twice = applyAgentEvent(once, event)
  assert.equal(notices(twice).length, 1)
})

check('不挤掉已有的轮次步骤', () => {
  const withStep = applyAgentEvent(base(), { type: 'agent_step', turn: 1, phase: 'start' })
  const next = applyAgentEvent(withStep, {
    type: 'custom',
    name: 'continuation',
    value: { attempt: 1, total: 3, reason: 'text' },
  } as AgentEvent)
  assert.equal(next.parts.filter((p) => p.type === 'step').length, 1, '步骤部件必须保留')
  assert.equal(notices(next).length, 1)
})

check('未知 custom 事件不产生任何部件', () => {
  const next = applyAgentEvent(base(), {
    type: 'custom',
    name: 'tool_protocol',
    value: { protocol: 'native' },
  } as AgentEvent)
  assert.equal(next.parts.length, 0)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
