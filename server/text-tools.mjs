/**
 * OpenAI 兼容工具请求的纯归一化：不碰网络、不碰 provider，便于单测。
 * - messages：限制数量与角色，保留 assistant.tool_calls 与 tool.tool_call_id
 * - tools：限制数量，只保留 function 定义
 * - tool_calls：统一成 { id, name, arguments }，arguments 始终是字符串
 */
export const MAX_TOOL_MESSAGES = 200
export const MAX_TOOLS = 64

const ROLES = new Set(['system', 'user', 'assistant', 'tool'])

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function normalizeChatMessages(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw.slice(0, MAX_TOOL_MESSAGES)) {
    if (!isObject(item)) continue
    const role = String(item.role || '')
    if (!ROLES.has(role)) continue
    const content =
      typeof item.content === 'string' ? item.content : item.content == null ? '' : String(item.content)
    const message = { role, content }
    if (role === 'assistant' && Array.isArray(item.tool_calls) && item.tool_calls.length) {
      message.tool_calls = item.tool_calls
    }
    if (role === 'tool') {
      if (!item.tool_call_id) continue
      message.tool_call_id = String(item.tool_call_id)
      if (item.name) message.name = String(item.name)
    }
    out.push(message)
  }
  return out
}

export function normalizeToolCalls(raw, prefix = 'call') {
  if (!Array.isArray(raw)) return []
  const out = []
  raw.forEach((item, index) => {
    if (!isObject(item)) return
    const fn = isObject(item.function) ? item.function : {}
    const name = String(fn.name || '')
    if (!name) return
    const args =
      typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {})
    out.push({ id: String(item.id || `${prefix}_${index}`), name, arguments: args })
  })
  return out
}

export function normalizeToolSchemas(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw.slice(0, MAX_TOOLS)) {
    if (!isObject(item) || !isObject(item.function)) continue
    const fn = item.function
    const name = String(fn.name || '')
    if (!name) continue
    const parameters = isObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} }
    out.push({
      type: 'function',
      function: {
        name,
        ...(typeof fn.description === 'string' && fn.description
          ? { description: fn.description }
          : {}),
        parameters,
      },
    })
  }
  return out
}

/** 服务端守卫：带 tools 的请求只允许已声明支持原生工具调用的模型。 */
export function toolRequestError({ tools, providerId, model, supported }) {
  if (!Array.isArray(tools) || !tools.length) return ''
  if (supported) return ''
  return `模型「${providerId || '未知渠道'} / ${model || '未配置'}」未声明支持原生工具调用；请换模型或把工具协议切回 auto/json`
}
