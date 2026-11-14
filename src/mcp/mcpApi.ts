export type McpMarketItem = {
  id: string
  name: string
  description: string
  category: string
  tags?: string[]
  iconUrl?: string
  url: string
  transport: string
  authType: string
  official?: boolean
  aliases?: string[]
}

export type McpServerConfig = {
  id: string
  marketId: string
  name: string
  description: string
  transport: 'http' | 'stdio'
  url: string
  command: string
  args: string[]
  headers: Record<string, string>
  environment: Record<string, string>
  authType: string
  authSecret: string
  hasAuthSecret?: boolean
  timeoutSec: number
  creativeChat: boolean
  iconUrl: string
  installedAt?: string
}

export type McpToolDescriptor = {
  serverId: string
  name: string
  description: string
  externalName: string
  inputSchema?: Record<string, unknown>
  error?: string
}

type JsonOut = { ok?: boolean; message?: string }

async function readJson<T>(res: Response): Promise<T & JsonOut> {
  const j = (await res.json().catch(() => ({}))) as T & JsonOut
  if (!res.ok || j.ok === false) throw new Error(j.message || `请求失败（HTTP ${res.status}）`)
  return j
}

export async function fetchMcpMarket(params?: { keyword?: string; category?: string }): Promise<McpMarketItem[]> {
  const q = new URLSearchParams()
  if (params?.keyword) q.set('keyword', params.keyword)
  if (params?.category) q.set('category', params.category)
  const res = await fetch(`/api/mcp/market?${q}`)
  const j = await readJson<{ items?: McpMarketItem[] }>(res)
  return j.items || []
}

export async function listMcpServers(): Promise<McpServerConfig[]> {
  const res = await fetch('/api/mcp/servers')
  const j = await readJson<{ servers?: McpServerConfig[] }>(res)
  return j.servers || []
}

export async function installMcpFromMarket(marketId: string): Promise<McpServerConfig> {
  const res = await fetch('/api/mcp/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId }),
  })
  const j = await readJson<{ server?: McpServerConfig }>(res)
  if (!j.server) throw new Error('安装响应缺少 server')
  return j.server
}

export async function patchMcpServer(id: string, patch: Partial<McpServerConfig>): Promise<McpServerConfig> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJson<{ server?: McpServerConfig }>(res)
  if (!j.server) throw new Error('保存响应缺少 server')
  return j.server
}

export async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(`/api/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await readJson(res)
}

export async function fetchCreativeMcpToolDescriptors(): Promise<McpToolDescriptor[]> {
  const res = await fetch('/api/mcp/creative-tools')
  const j = await readJson<{ tools?: McpToolDescriptor[] }>(res)
  return j.tools || []
}
