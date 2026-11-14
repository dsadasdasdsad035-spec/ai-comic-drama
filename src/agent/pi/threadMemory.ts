import type { AgentMessage as PiMessage } from '@earendil-works/pi-agent-core'
import type { AgentMessage as UiMessage, AgentMessagePart } from '../sceneAgentTypes'
import { modelFacingResult } from '../agentToolResult'

function textOf(parts: AgentMessagePart[]): string {
  return parts
    .filter((p): p is Extract<AgentMessagePart, { type: 'text' }> => p.type === 'text' && !p.discarded)
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * 工具结果转历史文本：原样序列化，不做长度裁剪。
 * 技能全文、物料详情与普通结果走同一条路径，模型下一轮看到的与界面看到的一致。
 */
function stringifyResult(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return String(value ?? '')
  }
}

function builtinLine(part: Extract<AgentMessagePart, { type: 'builtin' }>): string {
  const summary =
    part.result?.summary ||
    (part.status === 'cancelled' ? '已取消' : part.status === 'error' ? '失败' : '完成')
  return `[${part.label}] ${summary}`
}

/**
 * 界面线程 → Pi Agent 消息轨迹（user / assistant / toolResult）。
 * 不含当前正在跑的助手占位消息。
 *
 * 历史保真：这里只做格式转换，不折叠、不截断、不摘要化任何工具结果。
 */
export function uiThreadToPiMessages(messages: UiMessage[]): PiMessage[] {
  const out: PiMessage[] = []
  const baseTs = Date.now()

  for (const m of messages) {
    if (m.role === 'assistant' && m.status === 'running') continue

    if (m.role === 'user') {
      const text = textOf(m.parts)
      if (!text) continue
      out.push({ role: 'user', content: text, timestamp: baseTs })
      continue
    }

    const text = textOf(m.parts)
    const toolParts = m.parts.filter(
      (p): p is Extract<AgentMessagePart, { type: 'tool-call' }> =>
        p.type === 'tool-call' && p.status === 'done' && p.result !== undefined,
    )
    const builtinParts = m.parts.filter((p): p is Extract<AgentMessagePart, { type: 'builtin' }> => p.type === 'builtin')

    if (!text && !toolParts.length && !builtinParts.length) continue

    if (toolParts.length) {
      const content: unknown[] = []
      if (text) content.push({ type: 'text', text })
      for (const part of builtinParts) content.push({ type: 'text', text: builtinLine(part) })
      for (const part of toolParts) {
        content.push({
          type: 'toolCall',
          id: part.toolCallId,
          name: part.toolName,
          arguments: part.args ?? {},
        })
      }
      out.push({ role: 'assistant', content, timestamp: baseTs } as PiMessage)

      for (const part of toolParts) {
        const payload = part.isError
          ? { ok: false, error: stringifyResult(part.result) }
          : modelFacingResult(part.toolName, part.result)
        out.push({
          role: 'toolResult',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          content: [{ type: 'text', text: stringifyResult(payload) }],
          isError: Boolean(part.isError),
          timestamp: baseTs,
        } as PiMessage)
      }
      continue
    }

    const chunks = [text, ...builtinParts.map(builtinLine)].filter(Boolean).join('\n')
    if (!chunks) continue
    out.push({ role: 'assistant', content: [{ type: 'text', text: chunks }], timestamp: baseTs } as PiMessage)
  }

  return out
}

/** 模型可见体积（字符数）：只用于展示，不再据此裁剪或丢弃历史。 */
export function estimateChars(messages: PiMessage[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return messages.length * 200
  }
}

/** 检查器用：展示本轮送入模型的历史规模（历史按原文送出，不折叠）。 */
export function describePiThreadMemory(messages: UiMessage[], draftText: string): string {
  const prior = uiThreadToPiMessages(messages)
  const lines = [
    '【Pi 历史】',
    `线程消息 ${prior.length} 条，约 ${estimateChars(prior)} 字符；全文按原文送入模型，不做折叠。`,
  ]
  const draft = String(draftText || '').trim()
  lines.push(draft ? `本轮输入草稿：${draft}` : '本轮输入草稿：（空）')
  return lines.join('\n')
}
