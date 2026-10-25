import type { AgentMessage, AgentMessagePart } from './sceneAgentTypes'

export type ChatSurface = 'script' | 'characters' | 'assets' | 'shots' | 'prompts' | 'scene3d' | 'publish'

export type ChatThreadKey = {
  project: string
  surface: ChatSurface | string
  episode?: number
  shotId?: string
}

export type ActiveSkill = {
  id: string
  mode: 'host' | 'readonly'
  version: number
  source: 'builtin' | 'override'
}

export type ChatThreadRecord = {
  project: string
  surface: string
  episode: number
  shotId: string
  messages: AgentMessage[]
  activeSkills: ActiveSkill[]
  updatedAt?: string
}

function queryOf(key: ChatThreadKey, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({
    project: key.project,
    surface: String(key.surface),
    episode: String(Math.max(0, Math.floor(Number(key.episode) || 0))),
    shotId: key.shotId || '',
    ...extra,
  })
  return q.toString()
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON */
  }
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!res.ok || o.ok === false) throw new Error(String(o.message || `线程请求失败（HTTP ${res.status}）`))
  return o
}

export async function loadChatThread(key: ChatThreadKey): Promise<ChatThreadRecord | null> {
  if (!key.project) return null
  const res = await fetch(`/api/chat-thread?${queryOf(key)}`)
  const j = await readJson(res)
  const thread = j.thread as ChatThreadRecord | null | undefined
  if (!thread) return null
  if (!Array.isArray(thread.messages)) thread.messages = []
  if (!Array.isArray(thread.activeSkills)) thread.activeSkills = []
  return thread
}

export async function saveChatThread(
  key: ChatThreadKey,
  messages: AgentMessage[],
  activeSkills: ActiveSkill[] = [],
): Promise<ChatThreadRecord | null> {
  if (!key.project) return null
  const res = await fetch('/api/chat-thread', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: key.project,
      surface: key.surface,
      episode: key.episode || 0,
      shotId: key.shotId || '',
      messages: serializeThreadMessages(messages),
      activeSkills,
    }),
  })
  const j = await readJson(res)
  return (j.thread as ChatThreadRecord | null | undefined) ?? null
}

export async function clearChatThread(key: ChatThreadKey): Promise<void> {
  if (!key.project) return
  const res = await fetch(`/api/chat-thread?${queryOf(key)}`, { method: 'DELETE' })
  await readJson(res)
}

function shrinkResult(result: unknown): unknown {
  if (result === undefined) return undefined
  try {
    const text = JSON.stringify(result)
    if (text.length <= 4000) return result
    const o = result && typeof result === 'object' ? (result as Record<string, unknown>) : {}
    return {
      truncated: true,
      chars: text.length,
      summary: String(o.summary || o.error || '结果较大，已折叠'),
    }
  } catch {
    return null
  }
}

function serializePart(part: AgentMessagePart): AgentMessagePart {
  if (part.type === 'tool-call') {
    const args = part.args ? { ...(part.args as Record<string, unknown>) } : undefined
    if (args && typeof args.code === 'string' && args.code.length > 2000) {
      args.code = `（代码 ${args.code.length} 字，已折叠）`
    }
    return {
      ...part,
      ...(args ? { args } : {}),
      ...(part.result !== undefined ? { result: shrinkResult(part.result) } : {}),
    }
  }
  return part
}

/** 持久化前折叠大结果；线程只保留可恢复的最小信息。 */
export function serializeThreadMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((m) => ({ ...m, parts: m.parts.map(serializePart) }))
}

function textOf(parts: AgentMessagePart[]): string {
  return parts
    .filter((p): p is Extract<AgentMessagePart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .filter(Boolean)
    .join(' ')
    .trim()
}

function summaryOf(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '')
  const o = result as Record<string, unknown>
  return String(o.summary || o.error || (o.ok === false ? '失败' : '完成'))
}

/**
 * 送给模型的历史：最近若干轮文本 + 工具摘要。
 * 不重放完整工具协议，避免在 JSON action 里伪造工具调用历史。
 */
export function threadTranscript(messages: AgentMessage[], maxTurns = 12): string {
  const recent = messages.slice(-Math.max(2, maxTurns * 2))
  const lines: string[] = []
  for (const m of recent) {
    if (m.role === 'user') {
      const text = textOf(m.parts)
      if (text) lines.push(`用户：${text}`)
      continue
    }
    const text = textOf(m.parts)
    const tools = m.parts
      .filter((p): p is Extract<AgentMessagePart, { type: 'tool-call' }> => p.type === 'tool-call')
      .map((p) => `[${p.toolName}] ${summaryOf(p.result)}`)
    // 内置动作只把摘要带进下一轮，不重放整份产物。
    const builtins = m.parts
      .filter((p): p is Extract<AgentMessagePart, { type: 'builtin' }> => p.type === 'builtin')
      .map((p) => `[${p.label}] ${p.result?.summary || (p.status === 'cancelled' ? '已取消' : p.status)}`)
    if (text || tools.length || builtins.length) {
      lines.push(`助手：${[text, ...tools, ...builtins].filter(Boolean).join('；')}`)
    }
  }
  return lines.join('\n')
}
