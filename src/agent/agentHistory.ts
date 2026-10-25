import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'

const DRAFT_OPS = new Set(['begin_scene_draft', 'append_scene_draft', 'patch_scene_draft'])
const COMMIT_OP = 'commit_scene_draft'
/** 未提交/提交后的近期编辑保留次数；更早的分片操作折叠成一行摘要。 */
const KEEP_RECENT = 4

function messageText(message: BaseMessage): string {
  const content = message.content as unknown
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text || '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return String(content ?? '')
}

function parseToolResult(message: ToolMessage): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(messageText(message)) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * 长代码分片会把每次 append/patch 的完整参数留在历史里。
 * 这里把已提交之前的旧分片折叠成一行，保留最近 4 次编辑和 read/commit 结果。
 * 草稿文件仍在，模型需要细节时用 read_scene_draft 重新读取。
 */
export function compactDraftHistory(messages: BaseMessage[]): BaseMessage[] {
  type Op = { callId: string; name: string; messageIndex: number }
  const ops: Op[] = []
  let lastCommitIndex = -1
  messages.forEach((message, messageIndex) => {
    if (!(message instanceof AIMessage) || !message.tool_calls?.length) return
    for (const call of message.tool_calls) {
      if (DRAFT_OPS.has(call.name)) {
        ops.push({ callId: String(call.id), name: call.name, messageIndex })
      }
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
  // 优先用 commit 结果的行数/哈希；append 结果的 lines 只是草稿当前行数。
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!(message instanceof ToolMessage)) continue
    const parsed = parseToolResult(message)
    if (!parsed) continue
    if (typeof parsed.lineCount === 'number' || typeof parsed.codeHash === 'string') {
      if (typeof parsed.lineCount === 'number') lines = parsed.lineCount
      if (typeof parsed.codeHash === 'string') codeHash = parsed.codeHash
      break
    }
  }
  if (!lines && !codeHash) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (!(message instanceof ToolMessage)) continue
      const parsed = parseToolResult(message)
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
  const summary = new SystemMessage(
    `[场景草稿] ${details}。草稿文件仍在；需要查看细节或修改时先 read_scene_draft。`,
  )

  const out: BaseMessage[] = []
  let inserted = false
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (i === firstDroppedIndex && !inserted) {
      out.push(summary)
      inserted = true
    }
    if (message instanceof ToolMessage && droppedIds.has(String(message.tool_call_id))) continue
    if (message instanceof AIMessage && message.tool_calls?.length) {
      const keptCalls = message.tool_calls.filter((call) => !droppedIds.has(String(call.id)))
      if (keptCalls.length !== message.tool_calls.length) {
        const text = messageText(message).trim()
        if (!keptCalls.length && !text) continue
        out.push(
          new AIMessage({
            content: message.content,
            ...(keptCalls.length ? { tool_calls: keptCalls } : {}),
          }),
        )
        continue
      }
    }
    out.push(message)
  }
  return out
}
