import type { Message } from '@earendil-works/pi-ai'
import type { ProviderChatMessage } from '../../api'

/** pi 的 system/user 内容可能是字符串，也可能是文本/图片块数组。 */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: unknown; text?: unknown; thinking?: unknown }
      // 只取面向用户的文本；thinking 明确排除，不进入模型历史。
      if (block.type === 'text') return String(block.text ?? '')
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

type AssistantLike = {
  content?: unknown
}

function assistantCalls(block: AssistantLike): { id: string; name: string; arguments: string }[] {
  if (!Array.isArray(block.content)) return []
  return block.content
    .map((part) => {
      if (!part || typeof part !== 'object') return null
      const call = part as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
      if (call.type !== 'toolCall') return null
      const name = String(call.name ?? '').trim()
      if (!name) return null
      let args = '{}'
      try {
        args = JSON.stringify(call.arguments ?? {})
      } catch {
        args = '{}'
      }
      return { id: String(call.id ?? ''), name, arguments: args }
    })
    .filter((x): x is { id: string; name: string; arguments: string } => Boolean(x))
}

/**
 * pi 消息 → 项目 provider 消息。
 *
 * 与 NativeToolChatModel.toProviderMessages 保持同一组规则：
 * - 中间的 system 合并到首条（多数渠道不接受中间 system）
 * - assistant 的 toolCall 还原成 OpenAI tool_calls
 * - 没有对应 tool_call 的 toolResult 丢弃，避免渠道报“孤立工具结果”
 */
export function toProviderMessages(messages: readonly Message[]): ProviderChatMessage[] {
  const systems: string[] = []
  const rest: ProviderChatMessage[] = []

  for (const message of messages) {
    switch (message.role) {
      case 'system': {
        const text = contentText(message.content).trim()
        if (text) systems.push(text)
        break
      }
      case 'user': {
        const text = contentText(message.content).trim()
        if (text) rest.push({ role: 'user', content: text })
        break
      }
      case 'assistant': {
        const text = contentText(message.content).trim()
        const calls = assistantCalls(message)
        if (calls.length) {
          rest.push({
            role: 'assistant',
            content: text,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments },
            })),
          })
        } else if (text) {
          rest.push({ role: 'assistant', content: text })
        }
        break
      }
      case 'toolResult': {
        const text = contentText(message.content).trim()
        rest.push({
          role: 'tool',
          content: text,
          tool_call_id: String(message.toolCallId || ''),
          ...(message.toolName ? { name: String(message.toolName) } : {}),
        })
        break
      }
      default:
        break
    }
  }

  const callIds = new Set<string>()
  for (const message of rest) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue
    for (const call of message.tool_calls as { id?: unknown }[]) {
      if (call && typeof call === 'object' && call.id) callIds.add(String(call.id))
    }
  }
  const cleaned = rest.filter(
    (message) => message.role !== 'tool' || callIds.has(String(message.tool_call_id || '')),
  )

  return [
    ...(systems.length ? [{ role: 'system' as const, content: systems.join('\n\n') }] : []),
    ...cleaned,
  ]
}
