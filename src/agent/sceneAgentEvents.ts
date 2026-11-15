import type { AgentEvent } from './sceneAgentTypes'

/** 错误信息仍限制长度，避免整段堆栈进聊天。 */
const MAX_ERROR_TEXT = 2000

/**
 * 超预算的结果只做显式标记，不切片：
 * 以前会把 JSON.stringify 后的字符串切一半塞进 `preview`，下游看到的是一段坏 JSON，
 * 无法分辨哪里被切掉。现在整份返回，另附 `truncated` / `chars` 说明原始长度。
 */
function safe(value: unknown, max = 6000): unknown {
  if (value == null) return value
  let text: string | null = null
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = null
    }
  }
  if (text == null) return String(value)
  if (text.length <= max) return value
  return { truncated: true, chars: text.length, value }
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
    if ((key === 'chunk' || key === 'text') && typeof value === 'string' && value.length > 200) {
      out[`${key}Lines`] = lineCount(value)
      out[`${key}Chars`] = value.length
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

/** 错误文本的长度上限；UI 展示与轨迹记录共用。 */
export function clipErrorText(text: unknown): string {
  return String(text ?? '').slice(0, MAX_ERROR_TEXT)
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
