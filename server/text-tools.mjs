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

/** 字符串保持原样；内容数组只留 text / image，未知块丢掉。 */
function normalizeContent(raw) {
  if (typeof raw === 'string') return raw
  if (raw == null) return ''
  if (!Array.isArray(raw)) return String(raw)
  const parts = []
  for (const block of raw) {
    if (!isObject(block)) continue
    if (block.type === 'text') {
      const text = String(block.text || '')
      if (text) parts.push({ type: 'text', text })
    } else if (block.type === 'image') {
      const data = String(block.data || '')
      const mimeType = String(block.mimeType || '')
      if (!data || !mimeType) continue
      const label = String(block.label || '').trim()
      parts.push({ type: 'image', data, mimeType, ...(label ? { label } : {}) })
    }
  }
  if (!parts.length) return ''
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

export function normalizeChatMessages(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const item of raw.slice(0, MAX_TOOL_MESSAGES)) {
    if (!isObject(item)) continue
    const role = String(item.role || '')
    if (!ROLES.has(role)) continue
    const content = normalizeContent(item.content)
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

/** 已移除能力表拦截；保留空实现供旧测试 import。 */
export function toolRequestError() {
  return ''
}

/** APIMart 等严格网关：function.parameters 顶层必须是 object。 */
export function assertChatToolsObjectParameters(tools, { providerId, providerKind } = {}) {
  const strict = providerKind === 'apimart' || providerId === 'apimart'
  if (!strict || !Array.isArray(tools)) return
  for (const item of tools) {
    const fn = item?.function
    if (!fn || typeof fn !== 'object') continue
    const name = String(fn.name || '未知工具')
    const params = fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : null
    if (params?.type !== 'object') {
      const got = params?.type ?? (params?.anyOf ? 'anyOf' : params?.oneOf ? 'oneOf' : '无')
      throw new Error(
        `工具「${name}」的 parameters 必须是顶层 type: "object"（当前：${got}），无法发往 APIMart`,
      )
    }
  }
}
