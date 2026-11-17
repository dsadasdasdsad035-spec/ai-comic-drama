import assert from 'node:assert/strict'
import {
  applyHistoryBudget,
  HISTORY_BUDGET_CHARS,
  HISTORY_KEEP_ROUNDS,
} from '../src/agent/pi/budget'
import type { AgentMessage } from '@earendil-works/pi-agent-core'

/**
 * 历史预算投影：
 * - 未超预算一条都不动
 * - 最近几轮工具结果保持原文
 * - 更早的工具结果换成指针 stub（含重取工具名），原文不被改写
 * - 仍超预算才摘要化更早正文，并报告轮数
 * - 界面/持久化内容不归它管：入参不被原地修改
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

const toolCall = (id: string, name: string, args: Record<string, unknown> = {}) => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
})

const toolResult = (id: string, name: string, text: string): AgentMessage =>
  ({
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 0,
  }) as unknown as AgentMessage

const assistantWithCall = (id: string, name: string, text = ''): AgentMessage =>
  ({
    role: 'assistant',
    content: [...(text ? [{ type: 'text', text }] : []), toolCall(id, name)],
    timestamp: 0,
  }) as unknown as AgentMessage

const userMessage = (text: string): AgentMessage =>
  ({ role: 'user', content: text, timestamp: 0 }) as unknown as AgentMessage

/** 造 n 轮「读工具 + 结果」，每轮结果 payload 可控 */
function buildRounds(n: number, size: number): AgentMessage[] {
  const out: AgentMessage[] = [userMessage('把这集拆成分镜')]
  for (let i = 0; i < n; i++) {
    out.push(assistantWithCall(`c${i}`, 'read_shots', `第 ${i} 轮：先读镜头`))
    out.push(toolResult(`c${i}`, 'read_shots', 'x'.repeat(size)))
  }
  out.push(userMessage('继续'))
  return out
}

await check('未超预算时一条都不改', () => {
  const messages = buildRounds(3, 100)
  const r = applyHistoryBudget(messages)
  assert.equal(r.stubbed, 0)
  assert.equal(r.summarized, 0)
  assert.deepEqual(r.messages, messages, '不应产生任何折叠')
  assert.equal(r.charsAfter, r.charsBefore)
})

await check('最近几轮工具结果保持原文', () => {
  const messages = buildRounds(6, 4000)
  const r = applyHistoryBudget(messages, { budget: 12_000, keepRounds: HISTORY_KEEP_ROUNDS })
  for (const i of [4, 5]) {
    const found = r.messages.find(
      (m) => (m as unknown as { toolCallId?: string }).toolCallId === `c${i}`,
    ) as unknown as { content: { text: string }[] }
    assert.equal(found.content[0].text, 'x'.repeat(4000), `第 ${i} 轮不应被卸载`)
  }
})

await check('更早的工具结果换成含重取工具的 stub', () => {
  const messages = buildRounds(6, 4000)
  const r = applyHistoryBudget(messages, { budget: 12_000, keepRounds: 2 })
  assert.ok(r.stubbed >= 3, `早期轮次应被卸载，实际 ${r.stubbed}`)
  const first = r.messages.find(
    (m) => (m as unknown as { toolCallId?: string }).toolCallId === 'c0',
  ) as unknown as { content: { text: string }[] }
  assert.match(first.content[0].text, /read_shots/)
  assert.match(first.content[0].text, /已卸载/)
  assert.ok(!first.content[0].text.includes('xxxxxxxxxx'), 'stub 不能保留原文片段')
})

await check('stub 与摘要可分辨', () => {
  const messages = buildRounds(4, 3000)
  const r = applyHistoryBudget(messages, { budget: 8000, keepRounds: 1 })
  const stubbedTexts = r.messages
    .filter((m) => (m as unknown as { role?: string }).role === 'toolResult')
    .map((m) => (m as unknown as { content: { text: string }[] }).content[0].text)
  assert.ok(stubbedTexts.some((t) => t.startsWith('[') && t.includes('已卸载')))
})

await check('指针化后仍超预算才摘要化更早正文', () => {
  const messages = buildRounds(8, 4000)
  const r = applyHistoryBudget(messages, { budget: 3000, keepRounds: 1 })
  assert.ok(r.summarized > 0, '应摘要化早期正文')
  const summarized = r.messages.find(
    (m) =>
      (m as unknown as { role?: string }).role === 'assistant' &&
      JSON.stringify(m).includes('早期输出已摘要'),
  )
  assert.ok(summarized, '摘要标记必须可见')
})

await check('入参不被原地修改', () => {
  const messages = buildRounds(6, 4000)
  const before = JSON.stringify(messages)
  applyHistoryBudget(messages, { budget: 10_000 })
  assert.equal(JSON.stringify(messages), before, '投影不能改写调用方的历史')
})

await check('默认预算与规格口径一致', () => {
  assert.equal(HISTORY_BUDGET_CHARS, 48_000)
  assert.equal(HISTORY_KEEP_ROUNDS, 2)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
