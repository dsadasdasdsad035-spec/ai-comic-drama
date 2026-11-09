/**
 * 验收/本地开发用的 Mock 文本渠道：不访问外网，避免 defaults 落到 mock.invalid 时出现 fetch failed。
 */

export function isMockTextProvider(provider, entry) {
  const id = String(provider?.id || '')
  const base = String(provider?.baseUrl || '')
  const key = String(provider?.apiKey || '').trim().toLowerCase()
  const modelKey = String(entry?.key || '')
  if (modelKey.startsWith('mock-') || id.startsWith('mock')) return true
  if (/mock\.invalid/i.test(base)) return true
  if (key === 'mock') return true
  return false
}

function lastUserLine(messages, prompt) {
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i]
    if (m?.role !== 'user') continue
    const c = m.content
    if (typeof c === 'string' && c.trim()) return c.trim()
    if (Array.isArray(c)) {
      const text = c
        .map((p) => (typeof p === 'string' ? p : typeof p?.text === 'string' ? p.text : ''))
        .join('')
        .trim()
      if (text) return text
    }
  }
  return String(prompt || '').trim()
}

/** 生成一句可读的 mock 回复；工具模式下只回文本，不伪造 tool_calls。 */
export function mockAssistantReply({ messages, prompt, toolMode = false }) {
  const user = lastUserLine(messages, prompt) || '（空）'
  const prefix = toolMode ? '（本地 Mock · 工具模式）' : '（本地 Mock）'
  if (/技能|能力|工具/.test(user)) {
    return `${prefix}我是创意助手 Mock。真实模型请在「设置 → 环节模型」把创意/文本默认从 mock-text 换成豆包或 APIMart，并填写 API Key。当前用户说：${user}`
  }
  return `${prefix}收到：${user}`
}

export function explainTextFetchError(err, provider, baseUrl) {
  const raw = String(err?.message || err || 'fetch failed')
  if (raw !== 'fetch failed' && !/^fetch failed\b/i.test(raw)) return raw.slice(0, 600)
  const label = String(provider?.label || provider?.id || '模型渠道')
  const base = String(baseUrl || provider?.baseUrl || '').replace(/\/+$/, '') || '（未配置 baseUrl）'
  return [
    `无法连接 ${label}（${base}）`,
    '请检查：网络、API Key、baseUrl 是否正确；',
    '若默认模型是验收用的 mock-text，请到设置页改为真实文本模型。',
  ].join('')
}
