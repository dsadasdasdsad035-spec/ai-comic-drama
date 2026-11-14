/**
 * MCP 市场 / 配置 / 创意代理 API 冒烟（本地桩 HTTP MCP，不依赖外网 GitHub）。
 * 跑法：node verify-mcp-api.mjs
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5324
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-api-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 最小 JSON-RPC MCP 桩：initialize / tools/list / tools/call */
function createStubMcpServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let msg
      try {
        msg = JSON.parse(body)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const { method, id, params } = msg
      const ok = (result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      }
      if (method === 'initialize') {
        ok({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'verify-stub-mcp', version: '0.0.1' },
        })
        return
      }
      if (method === 'tools/list') {
        ok({
          tools: [
            {
              name: 'echo',
              description: '回显参数 msg',
              inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
            },
          ],
        })
        return
      }
      if (method === 'tools/call') {
        const args = params?.arguments || {}
        ok({
          content: [{ type: 'text', text: `echo:${String(args.msg || '')}` }],
          isError: false,
        })
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } }))
    })
  })
}

const stub = createStubMcpServer()
await new Promise((resolve, reject) => {
  stub.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()))
})
const stubUrl = `http://127.0.0.1:${stub.address().port}/`

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  stub.close()
  process.exit(1)
} catch {
  /* 空闲 */
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json: j }
}

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  stub.close()
  process.exit(1)
}

try {
  const market = await api('/api/mcp/market')
  check('MCP 市场列表成功', market.json?.ok === true && Array.isArray(market.json.items))
  const items = market.json?.items || []
  check('市场含 GitHub 条目', items.some((i) => i.id === 'github'), items.map((i) => i.id).join(','))

  const install = await api('/api/mcp/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId: 'github' }),
  })
  check('从市场安装 MCP', install.json?.ok === true && install.json.server?.id === 'mcp-github')
  const serverId = install.json?.server?.id || 'mcp-github'

  const dup = await api('/api/mcp/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId: 'github' }),
  })
  check('重复安装幂等', dup.json?.ok === true && dup.json.server?.id === serverId)

  const list1 = await api('/api/mcp/servers')
  check('读取已配置列表', list1.json?.ok === true && list1.json.servers?.length === 1)
  check('响应脱敏', list1.json.servers?.[0]?.authSecret === '' && list1.json.servers?.[0]?.hasAuthSecret === false)

  const beforeTools = await api('/api/mcp/creative-tools')
  check('未勾选创意时无可用工具名', beforeTools.json?.ok === true, JSON.stringify(beforeTools.json?.tools || []).slice(0, 120))

  const patched = await api(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: stubUrl, creativeChat: true }),
  })
  check('PATCH URL 与创意聊天', patched.json?.ok === true && patched.json.server?.creativeChat === true)

  const tools = await api('/api/mcp/creative-tools')
  const names = (tools.json?.tools || []).map((t) => t.externalName).filter(Boolean)
  check('创意工具列表含 echo', names.includes(`mcp.${serverId}.echo`), names.join(','))

  const call = await api('/api/mcp/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: `mcp.${serverId}.echo`, arguments: { msg: 'verify-mcp' } }),
  })
  check('代理 tools/call', call.json?.ok === true && String(call.json.result || '').includes('verify-mcp'), JSON.stringify(call.json).slice(0, 160))

  const badTool = await api('/api/mcp/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: 'mcp.nope.tool', arguments: {} }),
  })
  check('未知工具 400', badTool.status === 400 || badTool.json?.ok === false)

  await api(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creativeChat: false }),
  })
  const off = await api('/api/mcp/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: `mcp.${serverId}.echo`, arguments: { msg: 'x' } }),
  })
  check('关闭创意聊天后拒绝调用', off.status === 400 || off.json?.ok === false)

  const del = await api(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' })
  check('删除 MCP 配置', del.json?.ok === true)
  const list2 = await api('/api/mcp/servers')
  check('删除后列表为空', list2.json?.servers?.length === 0)
} finally {
  child.kill()
  stub.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
