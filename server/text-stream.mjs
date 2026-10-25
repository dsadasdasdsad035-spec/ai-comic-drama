/**
 * OpenAI 兼容 /chat/completions 的 SSE 增量解析。
 *
 * 只做纯解析：不碰网络、不碰响应对象，便于单测和回退。
 * - 支持 `data: {...}` 行与 `[DONE]`
 * - 只收集 delta.content；reasoning/thinking 明确丢弃
 * - 有些模型把推理包在 <think>…</think> / <thinking>…</thinking> 里（MiniMax M3 实测），
 *   标签可能被 chunk 切断，这里用 pending 缓冲 + 部分标签回退来处理
 * - 跨 chunk 边界安全：未闭合的行留到下一次 push
 */
const OPEN_TAGS = ['<think>', '<thinking>']
const CLOSE_TAGS = ['</think>', '</thinking>']

export class ChatStreamParser {
  constructor() {
    this.buffer = ''
    this.pending = ''
    this.inThink = false
    this.text = ''
    this.reasoningChars = 0
    this.done = false
    this.finishReason = ''
    this.error = ''
    /** 原生工具调用：按 index 聚合；id 缺失时生成稳定 id */
    this.toolCalls = []
    this.toolDeltas = []
    this.callPrefix = Math.random().toString(36).slice(2, 8)
    this.usage = null
  }

  push(chunk) {
    this.buffer += String(chunk || '')
    const deltas = []
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      const out = this.consumeLine(line)
      if (out === 'done') {
        this.done = true
        break
      }
      if (out) deltas.push(out)
      newline = this.buffer.indexOf('\n')
    }
    return {
      deltas,
      chars: this.text.length,
      done: this.done,
      finishReason: this.finishReason,
      error: this.error,
      toolDeltas: this.takeToolDeltas(),
    }
  }

  consumeLine(line) {
    const trimmed = String(line || '').trim()
    if (!trimmed || trimmed.startsWith(':')) return null
    if (!trimmed.startsWith('data:')) return null
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return 'done'
    let json
    try {
      json = JSON.parse(payload)
    } catch {
      return null
    }
    // APIMart 可能把 OpenAI chunk 包在 {code, data} 里；两种形态都接受
    const body = json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json
    const error = json?.error || body?.error
    if (error) {
      this.error = String(error.message || error)
      return null
    }
    if (typeof json?.code === 'number' && json.code !== 200 && !json?.data) {
      this.error = String(json.message || `上游返回 code ${json.code}`)
      return null
    }
    if (body?.usage && typeof body.usage === 'object') this.usage = body.usage
    const choice = body?.choices?.[0]
    if (!choice) return null
    if (choice.finish_reason) this.finishReason = String(choice.finish_reason)
    const delta = choice.delta || {}
    const reasoning = delta.reasoning_content ?? delta.reasoning
    if (typeof reasoning === 'string' && reasoning) this.reasoningChars += reasoning.length
    // 原生工具调用参数先于文本判断处理：工具调用时 content 通常为空。
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) this.consumeToolCall(call)
    }
    const content = normalizeContent(delta.content)
    if (!content) return null
    const visible = this.consumeContent(content)
    if (!visible) return null
    this.text += visible
    return visible
  }

  consumeToolCall(raw) {
    if (!raw || typeof raw !== 'object') return
    const index = Number.isInteger(raw.index) ? raw.index : this.toolCalls.length
    let entry = this.toolCalls[index]
    if (!entry) {
      entry = { id: '', name: '', arguments: '' }
      this.toolCalls[index] = entry
    }
    if (typeof raw.id === 'string' && raw.id) entry.id = raw.id
    if (!entry.id) entry.id = `call_${this.callPrefix}_${index}`
    const fn = raw.function && typeof raw.function === 'object' ? raw.function : {}
    if (typeof fn.name === 'string' && fn.name) entry.name = fn.name
    const argsDelta = typeof fn.arguments === 'string' ? fn.arguments : ''
    if (argsDelta) entry.arguments += argsDelta
    this.toolDeltas.push({ index, id: entry.id, name: entry.name, delta: argsDelta })
  }

  takeToolDeltas() {
    const out = this.toolDeltas
    this.toolDeltas = []
    return out
  }

  finalToolCalls() {
    return this.toolCalls
      .filter((call) => call && call.name)
      .map((call) => ({
        id: call.id || `call_${this.callPrefix}_${call.name}`,
        name: call.name,
        arguments: call.arguments,
      }))
  }

  /** 过滤 <think> 块；返回值是本次可以展示给用户的文本。 */
  consumeContent(content) {
    this.pending += content
    let out = ''
    for (;;) {
      if (this.inThink) {
        const hit = findEarliest(this.pending, CLOSE_TAGS)
        if (!hit) {
          this.pending = keepPartialTagSuffix(this.pending, CLOSE_TAGS)
          return out
        }
        this.pending = this.pending.slice(hit.index + hit.tag.length)
        this.inThink = false
        continue
      }
      const hit = findEarliest(this.pending, OPEN_TAGS)
      if (hit) {
        out += this.pending.slice(0, hit.index)
        this.pending = this.pending.slice(hit.index + hit.tag.length)
        this.inThink = true
        continue
      }
      const keep = partialSuffixLength(this.pending, OPEN_TAGS)
      out += this.pending.slice(0, this.pending.length - keep)
      this.pending = this.pending.slice(this.pending.length - keep)
      return out
    }
  }

  /** 流结束时把被标签检测扣住的尾巴放出来；未闭合的 think 块直接丢弃。 */
  flush() {
    if (this.inThink) {
      this.pending = ''
      return ''
    }
    const tail = this.pending
    this.pending = ''
    this.text += tail
    return tail
  }

  end() {
    this.flush()
    return {
      text: this.text,
      chars: this.text.length,
      done: this.done,
      finishReason: this.finishReason,
      error: this.error,
      toolCalls: this.finalToolCalls(),
      toolDeltas: this.takeToolDeltas(),
      usage: this.usage,
    }
  }
}

function findEarliest(text, tags) {
  let best = null
  for (const tag of tags) {
    const index = text.indexOf(tag)
    if (index >= 0 && (!best || index < best.index)) best = { index, tag }
  }
  return best
}

function partialSuffixLength(text, tags) {
  let max = 0
  for (const tag of tags) {
    const limit = Math.min(tag.length - 1, text.length)
    for (let n = limit; n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) {
        max = Math.max(max, n)
        break
      }
    }
  }
  return max
}

function keepPartialTagSuffix(text, tags) {
  const n = partialSuffixLength(text, tags)
  return n ? text.slice(text.length - n) : ''
}

function normalizeContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  return ''
}
