/**
 * MCP 服务配置：SQLite mcp_servers + 内置市场目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  upsertMcpServer,
} from './db.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let catalogCache = null

export function mcpMarketCatalog() {
  if (catalogCache) return catalogCache
  // 打包时本文件被 esbuild 内联进 server-build/app.mjs，__dirname 变成 server-build，
  // 而目录数据随源码留在 server/ 下。两处都找一遍，否则桌面端打开 MCP 会 500。
  const candidates = [
    path.join(__dirname, 'mcpMarketCatalog.json'),
    path.join(__dirname, '..', 'server', 'mcpMarketCatalog.json'),
  ]
  const file = candidates.find((f) => fs.existsSync(f))
  if (!file) throw new Error(`MCP 市场目录缺失，已查找：${candidates.join('、')}`)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  catalogCache = Array.isArray(raw.items) ? raw.items : []
  return catalogCache
}

export function mcpMarketSearch({ keyword = '', category = '' } = {}) {
  const q = String(keyword || '')
    .trim()
    .toLowerCase()
  const cat = String(category || '').trim().toLowerCase()
  let items = mcpMarketCatalog()
  if (cat) items = items.filter((i) => String(i.category || '').toLowerCase() === cat)
  if (q) {
    items = items.filter((i) => {
      const hay = [
        i.id,
        i.name,
        i.description,
        i.category,
        ...(i.tags || []),
        ...(i.aliases || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  return items
}

export function mcpMarketItem(marketId) {
  const id = String(marketId || '').trim()
  return mcpMarketCatalog().find((i) => i.id === id)
}

function safeId(marketId) {
  return `mcp-${String(marketId || 'custom')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 48)}`
}

const BUILTIN_PLATFORM_MCP_ID = 'mcp-storyboard-platform'

/** 平台 Pi 工具在应用内直接绑定；SQLite 里保留一条「已安装」记录供设置页展示。 */
export function ensureBuiltinPlatformMcp() {
  if (getMcpServer(BUILTIN_PLATFORM_MCP_ID)) return redactMcpServer(getMcpServer(BUILTIN_PLATFORM_MCP_ID))
  const item = mcpMarketItem('storyboard-platform')
  const row = {
    id: BUILTIN_PLATFORM_MCP_ID,
    marketId: 'storyboard-platform',
    name: item?.name || '分镜平台能力',
    description:
      item?.description ||
      '内置 read_* / submit_*；创意 Pi 已默认绑定。不可通过 HTTP 调用，仅 settings 展示。',
    transport: 'builtin',
    url: '',
    command: '',
    args: [],
    headers: {},
    environment: {},
    authType: 'none',
    authSecret: '',
    timeoutSec: 60,
    creativeChat: true,
    iconUrl: '',
  }
  upsertMcpServer(row)
  return redactMcpServer(getMcpServer(BUILTIN_PLATFORM_MCP_ID))
}

export function listConfiguredMcpServers() {
  ensureBuiltinPlatformMcp()
  return listMcpServers().map(redactMcpServer)
}

/** 响应里不回传 authSecret 原文 */
export function redactMcpServer(row) {
  const secret = String(row.authSecret || '')
  return {
    ...row,
    authSecret: '',
    hasAuthSecret: Boolean(secret),
  }
}

export function getConfiguredMcpServer(id) {
  const row = getMcpServer(id)
  return row ? redactMcpServer(row) : undefined
}

export function getMcpServerWithSecret(id) {
  return getMcpServer(id)
}

export function installMcpFromMarket(marketId) {
  const item = mcpMarketItem(marketId)
  if (!item) throw new Error('市场条目不存在')
  const id = safeId(item.id)
  const existing = getMcpServer(id)
  if (existing) return redactMcpServer(existing)
  const row = {
    id,
    marketId: item.id,
    name: item.name || item.id,
    description: item.description || '',
    transport: item.transport === 'stdio' ? 'stdio' : 'http',
    url: String(item.url || ''),
    command: '',
    args: [],
    headers: {},
    environment: {},
    authType: String(item.authType || ''),
    authSecret: '',
    timeoutSec: 60,
    creativeChat: false,
    iconUrl: item.iconUrl || '',
  }
  upsertMcpServer(row)
  return redactMcpServer(getMcpServer(id))
}

export function saveMcpServerPatch(id, patch) {
  const cur = getMcpServer(id)
  if (!cur) throw new Error('找不到 MCP 配置')
  const next = {
    ...cur,
    ...(patch.name != null ? { name: String(patch.name) } : {}),
    ...(patch.description != null ? { description: String(patch.description) } : {}),
    ...(patch.url != null ? { url: String(patch.url) } : {}),
    ...(patch.command != null ? { command: String(patch.command) } : {}),
    ...(patch.args != null ? { args: Array.isArray(patch.args) ? patch.args.map(String) : [] } : {}),
    ...(patch.headers != null ? { headers: patch.headers && typeof patch.headers === 'object' ? patch.headers : {} } : {}),
    ...(patch.environment != null
      ? { environment: patch.environment && typeof patch.environment === 'object' ? patch.environment : {} }
      : {}),
    ...(patch.creativeChat != null ? { creativeChat: Boolean(patch.creativeChat) } : {}),
    ...(patch.timeoutSec != null ? { timeoutSec: Math.min(600, Math.max(5, Number(patch.timeoutSec) || 60)) } : {}),
    ...(patch.authSecret != null && String(patch.authSecret).trim()
      ? { authSecret: String(patch.authSecret).trim() }
      : {}),
  }
  upsertMcpServer(next)
  return redactMcpServer(getMcpServer(id))
}

export function removeMcpServer(id) {
  if (String(id) === BUILTIN_PLATFORM_MCP_ID) {
    throw new Error('分镜平台能力是内置 MCP，不能卸载')
  }
  deleteMcpServer(id)
}

export function creativeMcpServers() {
  return listMcpServers().filter((s) => s.creativeChat && s.transport === 'http' && String(s.url || '').trim())
}
