/**
 * HTTP 传输 MCP：JSON-RPC tools/list 与 tools/call（创意聊天服务端代理）。
 */
const PROTOCOL = '2024-11-05'
let rpcId = 1

function nextId() {
  rpcId += 1
  return rpcId
}

function buildHeaders(server) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  }
  const envHeaders = server.headers && typeof server.headers === 'object' ? server.headers : {}
  for (const [k, v] of Object.entries(envHeaders)) {
    if (k && v != null) headers[k] = String(v)
  }
  const secret = String(server.authSecret || '').trim()
  if (secret) {
    if (server.authType === 'github-token' || server.authType === 'bearer') {
      headers.Authorization = secret.startsWith('Bearer ') ? secret : `Bearer ${secret}`
    } else {
      headers.Authorization = secret.startsWith('Bearer ') ? secret : `Bearer ${secret}`
    }
  }
  return headers
}

async function rpcOnce(url, headers, method, params, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), Math.max(1000, timeoutMs))
  try {
    const body = { jsonrpc: '2.0', id: nextId(), method, params: params || {} }
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ac.signal })
    const text = await res.text()
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}：${text.slice(0, 200)}`)
    let data
    try {
      data = JSON.parse(text)
    } catch {
      const line = text
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('data:'))
      if (!line) throw new Error('MCP 返回非 JSON')
      data = JSON.parse(line.slice(5).trim())
    }
    if (data.error) throw new Error(data.error.message || 'MCP 调用失败')
    return data.result
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('MCP 请求超时')
    throw e
  } finally {
    clearTimeout(t)
  }
}

async function ensureSession(server) {
  const url = String(server.url || '').trim()
  if (!url) throw new Error(`MCP「${server.name}」未配置 URL`)
  const headers = buildHeaders(server)
  const timeout = Math.max(5, Number(server.timeoutSec) || 60) * 1000
  await rpcOnce(
    url,
    headers,
    'initialize',
    {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'ai-comic-drama', version: '0.1.0' },
    },
    timeout,
  )
  return { url, headers, timeout }
}

export function mcpToolExternalName(serverId, toolName) {
  return `mcp.${String(serverId || '')}.${String(toolName || '')}`
}

export function parseMcpToolExternalName(external, serverIds) {
  const name = String(external || '')
  if (!name.startsWith('mcp.')) return null
  const rest = name.slice(4)
  for (const id of serverIds) {
    const prefix = `${id}.`
    if (rest.startsWith(prefix)) {
      return { serverId: id, toolName: rest.slice(prefix.length) }
    }
  }
  return null
}

/** 列出单个 HTTP MCP 的工具定义 */
export async function listMcpTools(server) {
  const { url, headers, timeout } = await ensureSession(server)
  const result = await rpcOnce(url, headers, 'tools/list', {}, timeout)
  const tools = Array.isArray(result?.tools) ? result.tools : []
  return tools.map((t) => ({
    serverId: server.id,
    name: String(t.name || ''),
    description: String(t.description || t.name || ''),
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
    externalName: mcpToolExternalName(server.id, t.name),
  }))
}

export async function callMcpTool(server, toolName, args) {
  const { url, headers, timeout } = await ensureSession(server)
  const result = await rpcOnce(url, headers, 'tools/call', { name: toolName, arguments: args || {} }, timeout)
  const content = Array.isArray(result?.content) ? result.content : []
  const text = content
    .map((c) => (c?.type === 'text' ? String(c.text || '') : ''))
    .filter(Boolean)
    .join('\n')
  return {
    ok: !result?.isError,
    text: text || JSON.stringify(result ?? null),
    raw: result,
  }
}

export async function listCreativeMcpToolDescriptors(servers) {
  const out = []
  for (const server of servers) {
    try {
      const tools = await listMcpTools(server)
      out.push(...tools)
    } catch (e) {
      out.push({
        serverId: server.id,
        name: '',
        description: '',
        externalName: '',
        error: e?.message || String(e),
      })
    }
  }
  return out.filter((t) => t.name || t.error)
}
