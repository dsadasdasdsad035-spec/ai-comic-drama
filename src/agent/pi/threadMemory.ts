import type { AgentMessage as PiMessage } from '@earendil-works/pi-agent-core'
import type { AgentMessage as UiMessage, AgentMessagePart } from '../sceneAgentTypes'
import { modelFacingResult } from '../agentToolResult'

const KEEP_USER_TURNS = 24
const MAX_CONTEXT_CHARS = 48_000
const TOOL_RESULT_MAX = 4_000

function textOf(parts: AgentMessagePart[]): string {
  return parts
    .filter((p): p is Extract<AgentMessagePart, { type: 'text' }> => p.type === 'text' && !p.discarded)
    .map((p) => String(p.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function shrinkJson(value: unknown, max = TOOL_RESULT_MAX): string {
  let text = ''
  try {
    text = JSON.stringify(value ?? null)
  } catch {
    text = String(value ?? '')
  }
  if (text.length <= max) return text
  try {
    const o = JSON.parse(text) as Record<string, unknown>
    return JSON.stringify({
      truncated: true,
      chars: text.length,
      summary: String(o.summary || o.error || o.id || '结果较大，已折叠'),
    })
  } catch {
    return JSON.stringify({ truncated: true, chars: text.length, summary: text.slice(0, 200) })
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
          ? { ok: false, error: shrinkJson(part.result) }
          : modelFacingResult(part.toolName, part.result)
        out.push({
          role: 'toolResult',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          content: [{ type: 'text', text: shrinkJson(payload) }],
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

function estimateChars(messages: PiMessage[]): number {
  try {
    return JSON.stringify(messages).length
  } catch {
    return messages.length * 200
  }
}

function tailFromUserTurns(messages: PiMessage[], keepTurns: number): number {
  let users = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      users += 1
      if (users >= keepTurns) return i
    }
  }
  return 0
}

function shrinkOldToolResults(messages: PiMessage[], tailStart: number): PiMessage[] {
  return messages.map((m, index) => {
    if (index >= tailStart || m.role !== 'toolResult') return m
    const shaped = m as { content?: unknown; isError?: boolean }
    const text = Array.isArray(shaped.content)
      ? shaped.content
          .map((part) =>
            part && typeof part === 'object' && (part as { type?: string }).type === 'text'
              ? String((part as { text?: string }).text ?? '')
              : '',
          )
          .join('')
      : String(shaped.content ?? '')
    if (text.length <= TOOL_RESULT_MAX) return m
    return {
      ...m,
      content: [{ type: 'text', text: shrinkJson({ truncated: true, chars: text.length, summary: '早期工具结果已折叠' }) }],
    } as PiMessage
  })
}

/**
 * Pi transformContext：远期工具结果折叠 + 超长轨迹尾部保留（长期记忆）。
 */
export function compactPiThreadMemory(messages: PiMessage[]): PiMessage[] {
  if (!messages.length) return messages

  const tailStart = tailFromUserTurns(messages, KEEP_USER_TURNS)
  let out = shrinkOldToolResults(messages, tailStart)

  if (estimateChars(out) <= MAX_CONTEXT_CHARS) return out

  const keepFrom = Math.max(0, out.length - 48)
  const dropped = keepFrom
  const tail = out.slice(keepFrom)
  if (!dropped) return tail

  const summary: PiMessage = {
    role: 'system',
    content: `[长期记忆] 此前 ${dropped} 条消息已由 Pi 上下文压枝；完整对话仍保存在创意会话线程中。`,
    timestamp: Date.now(),
  }
  out = [summary, ...tail]
  return out
}

/** 检查器用：展示压枝前后的规模（与运行时同一套 compact）。 */
export function describePiThreadMemory(messages: UiMessage[], draftText: string): string {
  const prior = uiThreadToPiMessages(messages)
  const compacted = compactPiThreadMemory(prior)
  const lines = [
    '【Pi 长期记忆】',
    `线程消息 ${prior.length} 条 → transformContext 后 ${compacted.length} 条；本轮 user 仅发送输入框正文，历史走 Pi 多轮 messages。`,
  ]
  if (prior.length) lines.push(`（压枝后首条角色：${compacted[0]?.role || '—'}）`)
  const draft = String(draftText || '').trim()
  lines.push(draft ? `本轮输入草稿：${draft}` : '本轮输入草稿：（空）')
  return lines.join('\n')
}
