/**
 * JSON action 协议的解析与修复。
 *
 * 模型返回 `{"content","tool_calls"}` 文本；少数情况会：
 * - 末尾多出 `]}` 之类的收尾括号；
 * - 把代码里的换行原样塞进字符串（未转义）；
 * - 输出被长度上限截断。
 *
 * 这里只做安全的修复：能捞回完整对象就捞；捞不回来交给调用方重试，
 * 绝不把截断的代码片段当成一次成功写入。
 */

function escapeControlCharsInJsonStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\' && inString) {
      out += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      out += ch
      continue
    }
    if (inString && ch === '\n') {
      out += '\\n'
    } else if (inString && ch === '\r') {
      out += '\\r'
    } else if (inString && ch === '\t') {
      out += '\\t'
    } else {
      out += ch
    }
  }
  return out
}

/** 从第一个 `{` 起，按字符串/转义规则找到第一个配平的 JSON 对象；忽略其后的杂字符。 */
export function extractBalancedJson(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
      if (depth < 0) return undefined
    }
  }
  return undefined
}

export function parseActionJson(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  const text = String(raw || '').trim()
  if (!text) return undefined
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : text
  const balanced = extractBalancedJson(body)
  const candidates = [body, balanced].filter((x): x is string => Boolean(x))
  for (const candidate of candidates) {
    for (const variant of [candidate, escapeControlCharsInJsonStrings(candidate)]) {
      try {
        return JSON.parse(variant)
      } catch {
        /* 继续尝试下一种 */
      }
    }
  }
  // 最后兜底：首尾花括号之间再试一次（字段顺序异常的模型输出）
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const sliced = body.slice(start, end + 1)
    try {
      return JSON.parse(sliced)
    } catch {
      try {
        return JSON.parse(escapeControlCharsInJsonStrings(sliced))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** 解析失败但文本明显是想发起工具调用（而不是普通回答）。 */
export function looksLikeActionPayload(text: string): boolean {
  return /"(?:tool_calls|toolCalls)"\s*:/.test(String(text || ''))
}

/** 解析失败后回喂给模型的纠正说明；只给可执行的小提示，不重复整份输出。 */
export function actionRetryHint(raw: string, finishReason?: string): string {
  const truncated = finishReason === 'length'
  const reason = truncated
    ? '上一次输出被长度上限截断。'
    : '上一次输出的 JSON 不合法（常见原因：末尾多出括号、字符串未闭合，或被截断）。'
  // 被截断时不给结尾片段，避免模型顺着半截代码续写；只针对尾部多括号的情况给定位。
  const tail = truncated ? '' : String(raw || '').replace(/\s+/g, ' ').slice(-120)
  return [
    '【上一次输出没有形成合法的工具调用】',
    reason,
    '请重新只输出一个合法 JSON 对象：{"content":"给用户的简短说明","tool_calls":[{"name":"工具名","args":{}}]}。',
    '不要输出 Markdown 围栏，不要在 JSON 前后加说明，也不要重复多余的结束括号。',
    truncated
      ? '不要延续上一次的内容；重新发起更小的工具调用（单次 append_scene_draft 的 chunk ≤1500 字符）。'
      : '长代码请分多次 append_scene_draft，每次 chunk 不超过 1500 字符；看到工具结果后再写下一段。',
    tail ? `上一次输出的结尾片段（供定位，不要原样重发）：${tail}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
