import type { AgentMessage } from '@earendil-works/pi-agent-core'

const DRAFT_OPS = new Set(['begin_scene_draft', 'append_scene_draft', 'patch_scene_draft'])
const COMMIT_OP = 'commit_scene_draft'
/** 未提交/提交后的近期编辑保留次数；更早的分片折叠成一行摘要。 */
const KEEP_RECENT = 4

type ToolCallBlock = { type: 'toolCall'; id: string; name: string; arguments: unknown }
type Shaped = { role?: unknown; content?: unknown; toolCallId?: unknown }

function shape(message: AgentMessage): Shaped {
  return message as unknown as Shaped
}

function isAssistant(message: AgentMessage): boolean {
  return shape(message).role === 'assistant'
}

function isToolResult(message: AgentMessage): boolean {
  return shape(message).role === 'toolResult'
}

function blocksOf(message: AgentMessage): unknown[] {
  const content = shape(message).content
  return Array.isArray(content) ? content : []
}

function callsOf(message: AgentMessage): ToolCallBlock[] {
  if (!isAssistant(message)) return []
  return blocksOf(message).filter((part): part is ToolCallBlock => {
    if (!part || typeof part !== 'object') return false
    const block = part as { type?: unknown; id?: unknown; name?: unknown }
    return block.type === 'toolCall' && Boolean(block.id) && Boolean(block.name)
  }) as ToolCallBlock[]
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as { type?: unknown; text?: unknown }
      return block.type === 'text' ? String(block.text ?? '') : ''
    })
    .filter(Boolean)
    .join('')
}

function resultOf(message: AgentMessage): Record<string, unknown> | undefined {
  if (!isToolResult(message)) return undefined
  try {
    const parsed = JSON.parse(textOfContent(shape(message).content)) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * 与 agentHistory.compactDraftHistory 同一规则，作用于 pi 消息：
 * 把最近一次 commit 之前的早期 begin/append/patch 折叠成一条 system 摘要。
 * 同时成对删除 assistant 的 toolCall 与对应 toolResult，避免孤立工具调用。
 */
export function compactPiHistory(messages: AgentMessage[]): AgentMessage[] {
  type Op = { callId: string; messageIndex: number }
  const ops: Op[] = []
  let lastCommitIndex = -1

  messages.forEach((message, messageIndex) => {
    for (const call of callsOf(message)) {
      if (DRAFT_OPS.has(call.name)) ops.push({ callId: String(call.id), messageIndex })
      if (call.name === COMMIT_OP) lastCommitIndex = messageIndex
    }
  })
  if (!ops.length) return messages

  const keep = new Set<string>()
  if (lastCommitIndex >= 0) {
    const beforeCommit = ops.filter((op) => op.messageIndex < lastCommitIndex)
    const afterCommit = ops.filter((op) => op.messageIndex >= lastCommitIndex)
    for (const op of beforeCommit.slice(-KEEP_RECENT)) keep.add(op.callId)
    for (const op of afterCommit) keep.add(op.callId)
  } else {
    for (const op of ops.slice(-KEEP_RECENT)) keep.add(op.callId)
  }

  const dropped = ops.filter((op) => !keep.has(op.callId))
  if (!dropped.length) return messages
  const droppedIds = new Set(dropped.map((op) => op.callId))
  const firstDroppedIndex = Math.min(...dropped.map((op) => op.messageIndex))

  let lines = 0
  let codeHash = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const parsed = resultOf(messages[i])
    if (!parsed) continue
    if (typeof parsed.lineCount === 'number' || typeof parsed.codeHash === 'string') {
      if (typeof parsed.lineCount === 'number') lines = parsed.lineCount
      if (typeof parsed.codeHash === 'string') codeHash = parsed.codeHash
      break
    }
  }
  if (!lines && !codeHash) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const parsed = resultOf(messages[i])
      if (parsed && typeof parsed.lines === 'number') {
        lines = parsed.lines
        break
      }
    }
  }

  const details = [
    `${dropped.length} 次早期 begin/append/patch 已折叠`,
    lines ? `草稿 ${lines} 行` : '',
    codeHash ? `最近提交 hash ${codeHash.slice(0, 10)}` : '',
  ]
    .filter(Boolean)
    .join('，')
  const summary: AgentMessage = {
    role: 'system',
    content: `[场景草稿] ${details}。草稿文件仍在；需要查看细节或修改时先 read_scene_draft。`,
    timestamp: Date.now(),
  }

  const out: AgentMessage[] = []
  let inserted = false
  messages.forEach((message, index) => {
    if (index === firstDroppedIndex && !inserted) {
      out.push(summary)
      inserted = true
    }
    if (isToolResult(message) && droppedIds.has(String(shape(message).toolCallId ?? ''))) return

    if (isAssistant(message)) {
      const calls = callsOf(message)
      const kept = calls.filter((call) => !droppedIds.has(String(call.id)))
      if (kept.length !== calls.length) {
        const rest = blocksOf(message).filter(
          (part) => !(part && typeof part === 'object' && (part as { type?: unknown }).type === 'toolCall'),
        )
        const next = [...rest, ...kept]
        if (!next.length) return
        out.push({ ...(message as object), content: next } as AgentMessage)
        return
      }
    }
    out.push(message)
  })
  return out
}
