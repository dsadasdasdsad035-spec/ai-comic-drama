/**
 * 知识库路由集成验证：起真实 server（SB_PORT=0）+ 本地 mock AnythingLLM。
 *
 * 覆盖 `/api/knowledge/*` 的完整链路：设置读取/脱敏、连接自检、建库、上传、
 * 列表、移出、彻底删、检索、问答 SSE 透传、历史、文档正文、删库级联，
 * 以及未配置态的错误形状。
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
  const state = {
    workspaces: new Map(),
    nextId: 1,
    chats: [],
    calls: [],
  }
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
      const chats = p.match(/^\/v1\/workspace\/([^/]+)\/chats$/)
      if (chats) {
        const sid = url.searchParams.get('apiSessionId') || ''
        const history = state.chats
          .filter((c) => !sid || c.sessionId === sid)
          .map((c) => ({ role: c.role, content: c.content, sentAt: c.sentAt, sources: c.sources }))
        return send(200, { history })
      }
      const stream = p.match(/^\/v1\/workspace\/([^/]+)\/stream-chat$/)
      if (stream) {
        const ws = state.workspaces.get(decodeURIComponent(stream[1]))
        if (!ws) return send(400, {})
        const body = asJson()
        if (body.reset) {
          state.chats = []
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          return res.end(`data: ${JSON.stringify({ type: 'textResponse', textResponse: '', sources: [], close: true })}\n\n`)
        }
        const sources = ws.documents.length
          ? [{ title: ws.documents[0].title, chunk: `${ws.documents[0].title} 的片段` }]
          : []
        state.chats.push({ sessionId: body.sessionId, role: 'user', content: body.message, sentAt: 1, sources: [] })
        state.chats.push({
          sessionId: body.sessionId,
          role: 'assistant',
          content: '回答内容',
          sentAt: 2,
          sources,
        })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ type: 'textResponse', textResponse: '回答' })}\n\n`)
        res.end(
          `data: ${JSON.stringify({ type: 'textResponse', textResponse: '内容', sources, close: true })}\n\n`,
        )
        return
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'application/pdf': ['.pdf'], 'text/plain': ['.txt', '.md'] } })
      }
      const doc = p.match(/^\/v1\/document\/(.+)$/)
      if (doc) {
        const name = decodeURIComponent(doc[1])
        for (const ws of state.workspaces.values()) {
          const hit = ws.documents.find((d) => d.location === name || d.title === name)
          if (hit) return send(200, { document: { ...hit, pageContent: `${hit.title} 正文` } })
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
  // server/index.mjs 要求 Node ≥ 24.9（AGENTS.md §5）。系统 node 常常只有 22，
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
    /* SSE 等非 JSON */
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

  // 建一个项目，路由要用到
  await api(base, '/api/project?name=hunter&create=1', jsonInit('POST', { title: '猎魔人' }))

  await check('未配置时 docs 返回 409 + 可读原因', async () => {
    const r = await api(base, '/api/knowledge/docs?project=hunter')
    assert.equal(r.status, 409)
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

  await check('可接受类型来自上游', async () => {
    const r = await api(base, '/api/knowledge/accepted-types')
    assert.equal(r.body.ok, true)
    assert.deepEqual(r.body.extensions, ['.md', '.pdf', '.txt'])
  })

  let slug = ''
  await check('首次 docs 自动建库', async () => {
    const r = await api(base, '/api/knowledge/docs?project=hunter')
    assert.equal(r.body.ok, true)
    assert.match(r.body.slug, /^ws-\d+$/)
    assert.equal(r.body.docCount, 0)
    slug = r.body.slug
  })

  await check('再次 docs 复用同一库', async () => {
    const before = mock.state.workspaces.size
    const r = await api(base, '/api/knowledge/docs?project=hunter')
    assert.equal(r.body.slug, slug)
    assert.equal(mock.state.workspaces.size, before)
  })

  await check('项目之间隔离', async () => {
    await api(base, '/api/project?name=star-sea&create=1', jsonInit('POST', { title: '星海' }))
    const other = await api(base, '/api/knowledge/docs?project=star-sea')
    assert.notEqual(other.body.slug, slug)
    assert.equal(other.body.docCount, 0)
  })

  let firstDoc = ''
  await check('上传挂到当前项目库', async () => {
    const res = await fetch(`${base}/api/knowledge/upload?project=${encodeURIComponent('hunter')}&filename=${encodeURIComponent('世界观.md')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: Buffer.from('# 世界观\n主角是猎人'),
    })
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(body.slug, slug)
    assert.equal(body.documents.length, 1)
    assert.equal(body.documents[0].title, '世界观.md')
    firstDoc = body.documents[0].location
  })

  await check('上传后清单可见，其它项目看不到', async () => {
    const mine = await api(base, '/api/knowledge/docs?project=hunter')
    assert.equal(mine.body.docCount, 1)
    const other = await api(base, '/api/knowledge/docs?project=star-sea')
    assert.equal(other.body.docCount, 0)
  })

  await check('上传超过上限被 413 拒', async () => {
    const big = Buffer.alloc(101 * 1024 * 1024)
    const res = await fetch(`${base}/api/knowledge/upload?project=${encodeURIComponent('hunter')}&filename=big.bin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: big,
    })
    assert.equal(res.status, 413)
  })

  await check('检索返回带 score 的命中', async () => {
    const r = await api(base, '/api/knowledge/search', jsonInit('POST', { project: 'hunter', query: '猎人' }))
    assert.equal(r.body.ok, true)
    assert.equal(r.body.hits.length, 1)
    assert.equal(r.body.hits[0].title, '世界观.md')
    assert.equal(typeof r.body.hits[0].score, 'number')
  })

  await check('问答 SSE 原样透传', async () => {
    const res = await fetch(`${base}/api/knowledge/chat`, jsonInit('POST', { project: 'hunter', message: '主角是谁' }))
    assert.match(String(res.headers.get('content-type')), /text\/event-stream/)
    const text = await res.text()
    const frames = text
      .split('\n\n')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => JSON.parse(f.slice(5)))
    assert.equal(frames.map((f) => f.textResponse || '').join(''), '回答内容')
    const last = frames[frames.length - 1]
    assert.equal(last.close, true)
    assert.equal(last.sources[0].title, '世界观.md')
  })

  await check('历史按会话回读', async () => {
    const r = await api(base, '/api/knowledge/history?project=hunter')
    assert.equal(r.body.ok, true)
    assert.equal(r.body.history.length, 2)
    assert.equal(r.body.history[0].content, '主角是谁')
  })

  await check('读文档正文', async () => {
    const r = await api(base, `/api/knowledge/doc?docName=${encodeURIComponent(firstDoc)}`)
    assert.equal(r.body.ok, true)
    assert.match(r.body.text, /正文/)
  })

  await check('移出本库', async () => {
    const r = await api(base, '/api/knowledge/remove', jsonInit('POST', { project: 'hunter', locations: [firstDoc] }))
    assert.equal(r.body.ok, true)
    assert.equal(r.body.removed, 1)
    const docs = await api(base, '/api/knowledge/docs?project=hunter')
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

  await check('Key 错误时给出可读原因', async () => {
    await api(base, '/api/settings', jsonInit('PUT', { knowledge: { baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'bad-key' } }))
    const r = await api(base, '/api/knowledge/test', jsonInit('POST', {}))
    assert.equal(r.status, 401)
    assert.match(r.body.message, /API Key 无效/)
  })

  await check('删除项目：上游可用时连带删掉 workspace 与映射', async () => {
    // 先把配置指回可用地址
    await api(base, '/api/settings', jsonInit('PUT', { knowledge: { baseUrl: `http://127.0.0.1:${mock.port}`, apiKey: 'test-key' } }))
    const before = await api(base, '/api/knowledge/docs?project=star-sea')
    const slugBefore = before.body.slug
    assert.ok(mock.state.workspaces.has(slugBefore), '建库后上游应有该 workspace')

    const del = await api(base, '/api/project?name=star-sea', { method: 'DELETE' })
    assert.equal(del.body.ok, true)
    assert.equal(mock.state.workspaces.has(slugBefore), false, '项目删掉后上游 workspace 应被清理')

    // 映射也要清掉：重新建同名项目应得到新库，而不是复用旧标识
    await api(base, '/api/project?name=star-sea&create=1', jsonInit('POST', { title: '星海' }))
    const after = await api(base, '/api/knowledge/docs?project=star-sea')
    assert.equal(after.body.ok, true)
    assert.notEqual(after.body.slug, slugBefore, '旧映射不该残留')
  })

  await check('删除项目：上游不可用时仍删成功，并给出残留提示', async () => {
    const proj = 'kb-down'
    await api(base, `/api/project?name=${proj}&create=1`, jsonInit('POST', {}))
    const created = await api(base, `/api/knowledge/docs?project=${proj}`)
    assert.equal(created.body.ok, true)

    // 把地址指到一个没人监听的端口：删除必须仍然成功
    await api(base, '/api/settings', jsonInit('PUT', { knowledge: { baseUrl: 'http://127.0.0.1:59998', apiKey: 'k' } }))
    const del = await api(base, `/api/project?name=${proj}`, { method: 'DELETE' })
    assert.equal(del.body.ok, true, '上游挂了也不能阻止删除项目')
    assert.match(JSON.stringify(del.body.warnings || []), /知识库未能自动清理/)
    assert.match(JSON.stringify(del.body.warnings || []), new RegExp(created.body.slug))
  })

  await check('清空地址即关闭知识库', async () => {
    await api(base, '/api/settings', jsonInit('PUT', { knowledge: { baseUrl: '', clearApiKey: true } }))
    const r = await api(base, '/api/knowledge/docs?project=hunter')
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
