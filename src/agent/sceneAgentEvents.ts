import type { AgentEvent } from './sceneAgentTypes'

export type RawLangGraphEvent = {
  event?: string
  name?: string
  run_id?: string
  metadata?: Record<string, unknown>
  data?: Record<string, unknown>
  error?: unknown
}

const MAX_TEXT = 2000
const MAX_RESULT = 2_000_000

function safe(value: unknown, max = 6000): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.slice(0, max)
  try {
    const json = JSON.stringify(value)
    if (json.length <= max) return value
    return { truncated: true, preview: json.slice(0, max) }
  } catch {
    return String(value).slice(0, max)
  }
}

function contentText(value: unknown, depth = 0): string {
  if (depth > 4 || value == null) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
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
  if (typeof value !== 'object') return ''
  const o = value as Record<string, unknown>
  // 只读取面向用户的消息 content；reasoning_content/additional_kwargs 明确不读取。
  if (typeof o.content === 'string') return o.content
  if (Array.isArray(o.content)) return contentText(o.content, depth + 1)
  if (o.kwargs && typeof o.kwargs === 'object') return contentText(o.kwargs, depth + 1)
  return ''
}

function isAiMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  const id = Array.isArray(o.id) ? o.id.map((x) => String(x)).join('.') : ''
  return id.includes('AIMessage') || o.type === 'ai' || o.type === 'AIMessage' || o.role === 'assistant'
}

function aiMessageText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const o = value as Record<string, unknown>
  if (isAiMessage(o)) return contentText(o)
  // ChatResult / generation 包装
  if (Array.isArray(o.generations)) {
    for (const g of o.generations) {
      const text = aiMessageText(g)
      if (text) return text
    }
  }
  if (o.message) return aiMessageText(o.message)
  return ''
}

export function extractModelText(value: unknown, max = MAX_TEXT): string {
  if (!value || typeof value !== 'object') return ''
  const o = value as Record<string, unknown>
  // agent 节点输出是 { messages: [AIMessage] }；只找 AI message，绝不回退到 ToolMessage。
  if (Array.isArray(o.messages)) {
    for (let i = o.messages.length - 1; i >= 0; i--) {
      const text = aiMessageText(o.messages[i])
      if (text.trim()) return text.replace(/\s+$/g, '').trim().slice(0, max)
    }
    return ''
  }
  return aiMessageText(value).replace(/\s+$/g, '').trim().slice(0, max)
}

function lineCount(code: string): number {
  return code ? code.split('\n').length : 0
}

/** 工具参数只保留可观察摘要；代码和 data URL 不进入事件。 */
export function sanitizeToolInput(raw: unknown, max = 6000): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { value: safe(raw, max) }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === 'code' && typeof value === 'string') {
      out.codeLines = lineCount(value)
      out.codeChars = value.length
      continue
    }
    if (typeof value === 'string' && /^data:(?:image|video|audio)\//i.test(value)) {
      out[key] = '[data-url omitted]'
      continue
    }
    if (key === 'reasoning' || key === 'reasoning_content') continue
    out[key] = safe(value, Math.min(max, 2000))
  }
  return out
}

function toolOutput(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    // LangChain ToolMessage 的 content 是 JSON 字符串；还原成工具实际返回。
    if (typeof o.content === 'string' && (o.tool_call_id || o.name || o.type === 'tool')) {
      try {
        return JSON.parse(o.content)
      } catch {
        return o.content
      }
    }
  }
  return value
}

function errorMessage(raw: RawLangGraphEvent): string {
  const err = raw.error
  if (typeof err === 'string') return err.slice(0, MAX_TEXT)
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message || 'agent 执行失败').slice(0, MAX_TEXT)
  }
  return String(raw.data?.error || 'agent 执行失败').slice(0, MAX_TEXT)
}

function toolResultForEvent(result: unknown): unknown {
  if (result && typeof result === 'object') {
    const o = result as Record<string, unknown>
    // 抓帧结果需要保留图片给聊天缩略图；其余工具结果只保留摘要。
    if (Array.isArray(o.frames)) return safe(result, MAX_RESULT)
    return safe(result, 6000)
  }
  return safe(result, 6000)
}

function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const o = result as Record<string, unknown>
  return o.ok === false || o.status === 'error' || Boolean(o.error)
}

/**
 * 消费 LangGraph streamEvents，并把它变成聊天可消费的稳定事件。
 * 模型轮次和工具生命周期以 run_id 去重；领域事件仍由工具本身发出。
 */
export function createAgentEventBridge() {
  const modelTurns = new Map<string, number>()
  const startedTools = new Set<string>()
  const endedTools = new Set<string>()
  const seenErrors = new Set<string>()
  let nextTurn = 0

  const map = (raw: RawLangGraphEvent): AgentEvent | null => {
    const data = raw.data || {}
    const runId = String(raw.run_id || '')
    const name = String(raw.name || '')

    // 浏览器内的 streamEvents 不保证发出 on_chat_model_*；
    // agent 节点的链事件稳定包含本轮 AIMessage，作为模型轮次来源。
    if (raw.event === 'on_chain_start' && name === 'agent') {
      if (runId && modelTurns.has(runId)) return null
      const turn = ++nextTurn
      if (runId) modelTurns.set(runId, turn)
      return { type: 'agent_step', turn, phase: 'start' }
    }

    if (raw.event === 'on_chain_end' && name === 'agent') {
      let turn = runId ? modelTurns.get(runId) : undefined
      if (!turn) {
        turn = ++nextTurn
        if (runId) modelTurns.set(runId, turn)
      }
      const text = extractModelText(data.output)
      return { type: 'agent_step', turn, phase: 'end', ...(text ? { text } : {}) }
    }

    if (raw.event === 'on_chat_model_start' || raw.event === 'on_chat_model_end' || raw.event === 'on_chat_model_stream') {
      // 模型轮次已由 agent 节点链事件覆盖；避免重复步骤。
      return null
    }

    if (raw.event === 'on_tool_start') {
      const id = String(runId || data.tool_call_id || name || `tool-${startedTools.size + 1}`)
      if (startedTools.has(id)) return null
      startedTools.add(id)
      return {
        type: 'tool_start',
        toolCallId: id,
        toolName: name || String(data.name || 'tool'),
        ...(data.input && typeof data.input === 'object'
          ? { args: sanitizeToolInput(data.input) }
          : {}),
      }
    }

    if (raw.event === 'on_tool_end' || raw.event === 'on_tool_error') {
      const id = String(runId || data.tool_call_id || name || `tool-${endedTools.size + 1}`)
      if (endedTools.has(id)) return null
      endedTools.add(id)
      const result = toolOutput(data.output)
      const isError = raw.event === 'on_tool_error' || isErrorResult(result)
      return {
        type: 'tool_end',
        toolCallId: id,
        toolName: name || String(data.name || 'tool'),
        result:
          result === undefined && raw.event === 'on_tool_error'
            ? { error: errorMessage(raw) }
            : toolResultForEvent(result),
        isError,
      }
    }

    if (raw.event === 'on_chain_error') {
      const message = errorMessage(raw)
      if (seenErrors.has(message)) return null
      seenErrors.add(message)
      return { type: 'error', message }
    }

    return null
  }

  return {
    map,
    get turnCount() {
      return nextTurn
    },
  }
}

export type AgentEventBridge = ReturnType<typeof createAgentEventBridge>

/** 无状态兼容入口；需要跨事件去重时使用 createAgentEventBridge。 */
export function mapLangGraphEvent(raw: RawLangGraphEvent): AgentEvent | null {
  return createAgentEventBridge().map(raw)
}

export function appendAgentEvent(events: AgentEvent[], event: AgentEvent | null, max = 200): AgentEvent[] {
  if (!event) return events
  const next = [...events, event]
  return next.length > max ? next.slice(next.length - max) : next
}

export function eventsForDisplay(events: AgentEvent[]): AgentEvent[] {
  return events.map((event) => {
    if (event.type === 'tool_start') {
      return { ...event, args: sanitizeToolInput(event.args, 4000) }
    }
    if (event.type === 'tool_end') {
      return { ...event, result: safe(event.result, 6000) }
    }
    return event
  })
}
