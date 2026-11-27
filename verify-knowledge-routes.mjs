/**
 * 知识库路由集成验证：起真实 server（SB_PORT=0）+ 本地 mock AnythingLLM。
 *
 * 分工（避免与别的脚本重复）：
 * - 本脚本验「设置 / 连接自检 / 类型清单 / 上传上限 / 文档标识校验 / 未知路由 /
 *   错误码映射 / 越库读取」这些**横切契约**；
 * - `verify-knowledge-bases.mjs` 验库 CRUD、文档与会话选库的完整链路；
 * - `verify-knowledge-tools.mjs` 验 Agent 工具的作用域。
 *
 * 不依赖真实 AnythingLLM，不产生外部费用。
 * 跑法：node verify-knowledge-routes.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-routes-'))
const PROJECTS = path.join(TMP, 'projects')
const MEDIA = path.join(TMP, 'media')
fs.mkdirSync(PROJECTS, { recursive: true })
fs.mkdirSync(MEDIA, { recursive: true })

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

// ---------------------------------------------------------------- mock 上游

function startMockAnythingLLM() {
  const state = { workspaces: new Map(), nextId: 1, calls: [] }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // 真实上游在 /api/v1/*；mock 两种前缀都接受
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    state.calls.push({ method: req.method, path: p })
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (String(req.headers.authorization || '') !== 'Bearer test-key') {
      return send(403, { error: 'No valid api key found.' })
    }
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(parts)
      const asJson = () => {
        try {
          return JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          return {}
        }
      }
      if (p === '/v1/auth') return send(200, { authenticated: true })
      if (p === '/v1/workspace/new' && req.method === 'POST') {
        const { name } = asJson()
        const dup = [...state.workspaces.values()].find((w) => w.name === name)
        if (dup) return send(400, { workspace: null, message: 'Workspace name must be unique' })
        const ws = { id: state.nextId++, name, slug: `ws-${state.nextId}`, documents: [] }
        state.workspaces.set(ws.slug, ws)
        return send(200, { workspace: ws, message: 'Workspace created' })
      }
      if (p === '/v1/workspaces') return send(200, { workspaces: [...state.workspaces.values()] })
      const wsOne = p.match(/^\/v1\/workspace\/([^/]+)$/)
      if (wsOne) {
        const slug = decodeURIComponent(wsOne[1])
        const ws = state.workspaces.get(slug)
        if (req.method === 'DELETE') {
          if (!ws) return send(400, {})
          state.workspaces.delete(slug)
          return send(200, { message: 'deleted' })
        }
        return send(200, { workspace: ws ? [{ ...ws }] : [] })
      }
      if (p === '/v1/document/upload' && req.method === 'POST') {
        const text = raw.toString('latin1')
        const addTo = (/name="addToWorkspaces"\r\n\r\n([^\r]+)/.exec(text)?.[1] || '').trim()
        const filename = Buffer.from(/filename="([^"]+)"/.exec(text)?.[1] || 'x.bin', 'latin1').toString(
          'utf8',
        )
        const ws = state.workspaces.get(addTo)
        if (!ws) return send(400, { success: false, error: 'workspace not found', documents: [] })
        const doc = {
          location: `custom-documents/${encodeURIComponent(filename)}-${state.nextId++}.json`,
          title: filename,
          wordCount: 10,
        }
        ws.documents.push(doc)
        return send(200, { success: true, error: null, documents: [doc] })
      }
      const emb = p.match(/^\/v1\/workspace\/([^/]+)\/update-embeddings$/)
      if (emb) {
        const ws = state.workspaces.get(decodeURIComponent(emb[1]))
        if (!ws) return send(400, {})
        const { deletes = [] } = asJson()
        ws.documents = ws.documents.filter((d) => !deletes.includes(d.location))
        return send(200, { workspace: ws, message: null })
      }
      if (p === '/v1/system/remove-documents') {
        const { names = [] } = asJson()
        for (const ws of state.workspaces.values()) {
          ws.documents = ws.documents.filter((d) => !names.includes(d.location))
        }
        return send(200, { success: true })
      }
      const search = p.match(/^\/v1\/workspace\/([^/]+)\/vector-search$/)
      if (search) {
        const ws = state.workspaces.get(decodeURIComponent(search[1]))
        if (!ws) return send(400, {})
        const { query } = asJson()
        if (!ws.documents.length) return send(200, { results: [], message: 'No embeddings found' })
        return send(200, {
          results: [
            {
              id: 'v1',
              text: `${ws.documents[0].title} 命中「${query}」的片段`,
              metadata: { title: ws.documents[0].title, url: `file://${ws.documents[0].location}` },
              score: 0.77,
            },
          ],
        })
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'application/pdf': ['.pdf'], 'text/plain': ['.txt', '.md'] } })
      }
      const doc = p.match(/^\/v1\/document\/(.+)$/)
      if (doc) {
        const name = decodeURIComponent(doc[1])
        // 真实上游只接受纯文件名（带斜杠会 404）
        if (name.includes('/')) return send(404, { error: 'Not Found' })
        for (const ws of state.workspaces.values()) {
          const hit = ws.documents.find((d) => d.location.split('/').pop() === name || d.title === name)
          if (hit) return send(200, { document: { ...hit } })
        }
        return send(404, {})
      }
      return send(404, { error: 'mock: ' + p })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, state, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

// ---------------------------------------------------------------- 启动真实 server

function resolveNodeBin() {
  // server/index.mjs 要求 Node ≥ 24.9（AGENTS.md §2）。系统 node 常常只有 22，
  // 所以优先用随包的 desktop/bin/node，再回落到当前进程。
  const bundled = path.join(ROOT, 'desktop', 'bin', 'node')
  return fs.existsSync(bundled) ? bundled : process.execPath
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveNodeBin(), [path.join(ROOT, 'server', 'index.mjs')], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`server 启动超时：\n${out}`))
    }, 60_000)
    const onData = (buf) => {
      out += buf.toString()
      const m = out.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve({ base: `http://127.0.0.1:${m[1]}`, child, log: () => out })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`server 提前退出（code=${code}）：\n${out}`))
    })
  })
}

async function api(base, pathname, init = {}) {
  const res = await fetch(base + pathname, init)
  const text = await res.text()
  let body = text
  try {
    body = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body }
}

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ---------------------------------------------------------------- 开跑

const mock = await startMockAnythingLLM()
let srv
try {
  srv = await startServer({
    SB_PORT: '0',
    SB_PROJECTS_DIR: PROJECTS,
    SB_MEDIA_ROOT: MEDIA,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_STUDIO_NO_PREWARM: '1',
    SB_DESKTOP_PARENT_PID: '',
  })
  const base = srv.base

  await check('未配置时建库返回 409 + 可读原因', async () => {
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '未配置库' }))
    assert.equal(r.status, 409, `期望 409，实际 ${r.status}: ${JSON.stringify(r.body)}`)
    assert.equal(r.body.ok, false)
    assert.equal(r.body.configured, false)
    assert.match(r.body.message, /尚未配置/)
  })

  await check('设置读取：未配置时 hasApiKey=false', async () => {
    const r = await api(base, '/api/knowledge/settings')
    assert.equal(r.body.ok, true)
    assert.equal(r.body.hasApiKey, false)
    assert.equal(r.body.enabled, false)
  })

  await check('保存设置后回读不含 Key 原文', async () => {
    const put = await api(
      base,
      '/api/settings',
      jsonInit('PUT', {
        knowledge: { baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'test-key' },
      }),
    )
    assert.equal(put.body.ok, true)
    const r = await api(base, '/api/knowledge/settings')
    assert.equal(r.body.hasApiKey, true)
    assert.equal(r.body.enabled, true)
    assert.equal(r.body.baseUrl, `http://127.0.0.1:${mock.port}`)
    assert.equal(JSON.stringify(r.body).includes('test-key'), false, 'Key 不能回传原文')
  })

  await check('连接自检', async () => {
    const r = await api(base, '/api/knowledge/test', jsonInit('POST', {}))
    assert.equal(r.body.ok, true)
    assert.equal(r.body.authenticated, true)
  })

  await check('可接受类型来自上游（排序去重）', async () => {
    const r = await api(base, '/api/knowledge/accepted-types')
    assert.equal(r.body.ok, true)
    assert.deepEqual(r.body.extensions, ['.md', '.pdf', '.txt'])
  })

  const made = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '路由验收库' }))
  assert.equal(made.body.ok, true, made.body.message)
  const kbId = made.body.base.id

  await check('库列表回读带上游文档数', async () => {
    const r = await api(base, '/api/knowledge/bases')
    assert.equal(r.body.ok, true)
    const row = r.body.bases.find((b) => b.id === kbId)
    assert.ok(row, '列表应含刚建的库')
    assert.equal(row.docCount, 0)
  })

  let firstDoc = ''
  await check('上传挂到指定库', async () => {
    const res = await fetch(
      `${base}/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=${encodeURIComponent('世界观.md')}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown' },
        body: Buffer.from('# 世界观\n主角是猎人'),
      },
    )
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.kbId, kbId)
    assert.equal(body.documents.length, 1)
    assert.equal(body.documents[0].title, '世界观.md')
    firstDoc = body.documents[0].location
  })

  await check('上传超过上限被 413 拒（按 Content-Length 预拒）', async () => {
    const big = Buffer.alloc(101 * 1024 * 1024)
    const res = await fetch(
      `${base}/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=big.bin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: big,
      },
    )
    assert.equal(res.status, 413)
  })

  await check('检索返回带 score 的命中', async () => {
    const r = await api(base, '/api/knowledge/search', jsonInit('POST', { kbId, query: '猎人' }))
    assert.equal(r.body.ok, true)
    assert.equal(r.body.hits.length, 1)
    assert.equal(r.body.hits[0].title, '世界观.md')
    assert.equal(typeof r.body.hits[0].score, 'number')
    assert.equal(r.body.kbId, kbId)
  })

  await check('读文档：接受 workspace 详情里的 docpath', async () => {
    const r = await api(
      base,
      `/api/knowledge/doc?kbId=${encodeURIComponent(kbId)}&docName=${encodeURIComponent(firstDoc)}`,
    )
    assert.equal(r.body.ok, true, r.body.message || '读取失败')
    assert.ok(r.body.title, '应当有标题')
    // mock 没有磁盘，所以 text 为空；真机由 SB_KNOWLEDGE_DOCUMENTS_DIR 补齐
    assert.equal(typeof r.body.text, 'string')
  })

  await check('越库读取被拒：另一库拿不到本库文档', async () => {
    const other = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '另一个库' }))
    const otherId = other.body.base.id
    const r = await api(
      base,
      `/api/knowledge/doc?kbId=${encodeURIComponent(otherId)}&docName=${encodeURIComponent(firstDoc)}`,
    )
    assert.equal(r.status, 404, `期望 404，实际 ${r.status}: ${JSON.stringify(r.body)}`)
    assert.match(String(r.body.message), /不在本次会话选定的知识库里/)
  })

  await check('移出本库', async () => {
    const r = await api(
      base,
      '/api/knowledge/remove',
      jsonInit('POST', { kbId, locations: [firstDoc] }),
    )
    assert.equal(r.body.ok, true)
    assert.equal(r.body.removed, 1)
    const docs = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(kbId)}`)
    assert.equal(docs.body.docCount, 0)
  })

  await check('彻底删除需要文档标识', async () => {
    const r = await api(base, '/api/knowledge/purge', jsonInit('POST', { locations: [] }))
    assert.equal(r.body.ok, false)
    assert.match(r.body.message, /没有指定/)
  })

  await check('非法文档标识被拒（路径穿越）', async () => {
    const r = await api(base, '/api/knowledge/purge', jsonInit('POST', { locations: ['../../etc/passwd'] }))
    assert.equal(r.body.ok, false)
    assert.match(r.body.message, /不合法/)
  })

  await check('未知知识库接口返回 404', async () => {
    const r = await api(base, '/api/knowledge/nope')
    assert.equal(r.status, 404)
    assert.equal(r.body.ok, false)
  })

  await check('Key 错误时给出可读原因（401）', async () => {
    await api(
      base,
      '/api/settings',
      jsonInit('PUT', { knowledge: { baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'bad-key' } }),
    )
    const r = await api(base, '/api/knowledge/test', jsonInit('POST', {}))
    assert.equal(r.status, 401)
    assert.match(r.body.message, /API Key 无效/)
  })

  await check('错误码透传：未选库给 kb_session_unset', async () => {
    await api(
      base,
      '/api/settings',
      jsonInit('PUT', { knowledge: { baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'test-key' } }),
    )
    const r = await api(
      base,
      '/api/knowledge/search',
      jsonInit('POST', { sessionId: 'sess-none', query: 'x' }),
    )
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'kb_session_unset', '前端/工具层要靠这个码区分「还没选」')
  })

  await check('删库不碰邻居：文档池与其它库都在', async () => {
    const before = (await api(base, '/api/knowledge/bases')).body.bases.length
    const del = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbId)}`, { method: 'DELETE' })
    assert.equal(del.body.ok, true, del.body.message)
    const after = await api(base, '/api/knowledge/bases')
    assert.equal(after.body.bases.length, before - 1)
    assert.ok(
      after.body.bases.some((b) => b.name === '另一个库'),
      '邻居库应仍在',
    )
  })

  await check('清空地址即关闭知识库', async () => {
    await api(base, '/api/settings', jsonInit('PUT', { knowledge: { baseUrl: '', clearApiKey: true } }))
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '关闭后建库' }))
    assert.equal(r.status, 409)
    assert.equal(r.body.configured, false)
  })
} finally {
  try {
    if (srv) {
      srv.child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 500))
      if (!srv.child.killed) srv.child.kill('SIGKILL')
    }
  } catch {
    /* 忽略 */
  }
  await mock.close()
  try {
    fs.rmSync(TMP, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

console.log(bad ? `\n${bad} 项失败` : '\n知识库路由集成全部通过')
process.exit(bad ? 1 : 0)
