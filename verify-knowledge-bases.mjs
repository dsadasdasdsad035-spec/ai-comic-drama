/**
 * 知识库库维度路由验收：真实 server（SB_PORT=0）+ 本地 mock AnythingLLM。
 *
 * 覆盖：
 * - 库 CRUD：列表 / 创建（中文名、重名 409）/ 改名 / 删除
 * - 文档：上传 / 清单 / 移出 / 彻底删除（按 kbId）
 * - 会话选库：写后读回 / 库被删后读回 null / 不存在的 kbId 被拒
 * - 不存在的 kbId 一律 404 且文案说「知识库不存在」
 * - 删库尽力删上游 workspace；上游不可用时仍删成功并给 warning
 *
 * 不依赖真实上游，零成本。
 * 跑法：node verify-knowledge-bases.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-bases-'))
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

function startMock() {
  const state = { workspaces: new Map(), nextId: 1, calls: [], offline: false }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    state.calls.push({ method: req.method, path: p })
    if (state.offline) {
      req.socket.destroy()
      return
    }
    const send = (s, b) => {
      res.writeHead(s, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(b))
    }
    if (String(req.headers.authorization || '') !== 'Bearer test-key') {
      return send(403, { error: 'No valid api key found.' })
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
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
        // 模拟上游归一化：中文名 → 无意义 slug，不可逆推
        const slug = `ws-${state.nextId++}`
        const ws = { id: state.nextId, name, slug, documents: [] }
        state.workspaces.set(slug, ws)
        return send(200, { workspace: ws })
      }
      if (p === '/v1/workspaces') return send(200, { workspaces: [...state.workspaces.values()] })
      const one = p.match(/^\/v1\/workspace\/([^/]+)$/)
      if (one) {
        const slug = decodeURIComponent(one[1])
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
        const filename = Buffer.from(/filename="([^"]+)"/.exec(text)?.[1] || 'x', 'latin1').toString('utf8')
        const ws = state.workspaces.get(addTo)
        if (!ws) return send(400, { success: false, error: 'workspace not found', documents: [] })
        const doc = { location: `custom-documents/${filename}-${state.nextId++}.json`, title: filename, wordCount: 9 }
        ws.documents.push(doc)
        return send(200, { success: true, error: null, documents: [doc] })
      }
      const emb = p.match(/^\/v1\/workspace\/([^/]+)\/update-embeddings$/)
      if (emb) {
        const ws = state.workspaces.get(decodeURIComponent(emb[1]))
        if (!ws) return send(400, {})
        const { deletes = [] } = asJson()
        ws.documents = ws.documents.filter((d) => !deletes.includes(d.location))
        return send(200, { workspace: ws })
      }
      if (p === '/v1/system/remove-documents') return send(200, { success: true })
      const search = p.match(/^\/v1\/workspace\/([^/]+)\/vector-search$/)
      if (search) {
        const ws = state.workspaces.get(decodeURIComponent(search[1]))
        if (!ws) return send(400, {})
        const { query } = asJson()
        if (!ws.documents.length) return send(200, { results: [] })
        return send(200, {
          results: [
            {
              id: 'v1',
              text: `${ws.documents[0].title} 命中「${query}」`,
              metadata: { title: ws.documents[0].title, chunkSource: ws.documents[0].location },
              score: 0.7,
            },
          ],
        })
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'text/plain': ['.md', '.txt'], 'application/pdf': ['.pdf'] } })
      }
      return send(404, { error: 'mock: ' + p })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, state, close: () => new Promise((r) => server.close(r)) }),
    )
  })
}

function resolveNodeBin() {
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

const mock = await startMock()
let srv
try {
  srv = await startServer({
    SB_PORT: '0',
    SB_PROJECTS_DIR: PROJECTS,
    SB_MEDIA_ROOT: MEDIA,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_STUDIO_NO_PREWARM: '1',
    ANYTHINGLLM_BASE_URL: `http://127.0.0.1:${mock.port}`,
    ANYTHINGLLM_API_KEY: 'test-key',
    SB_BUILTIN_KNOWLEDGE: '1',
  })
  const base = srv.base

  await check('库列表初始为空', async () => {
    const r = await api(base, '/api/knowledge/bases')
    assert.equal(r.body.ok, true)
    assert.deepEqual(r.body.bases, [])
  })

  let kbA = null
  await check('创建库（中文名）', async () => {
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '运镜手册' }))
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.base.name, '运镜手册')
    assert.ok(r.body.base.id.startsWith('kb_'))
    assert.ok(r.body.base.upstreamSlug, '应回读上游 slug')
    assert.notEqual(r.body.base.upstreamSlug, '运镜手册', '不应由库名反推 slug')
    kbA = r.body.base
  })

  await check('创建重名库被拒（409）', async () => {
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '运镜手册' }))
    assert.equal(r.status, 409, `期望 409，实际 ${r.status}: ${JSON.stringify(r.body)}`)
    assert.match(String(r.body.message), /已被占用/)
  })

  await check('创建第二个库', async () => {
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '通用资料' }))
    assert.equal(r.body.ok, true, r.body.message)
  })

  await check('列表两条且按创建顺序', async () => {
    const r = await api(base, '/api/knowledge/bases')
    assert.equal(r.body.bases.length, 2)
    assert.equal(r.body.bases[0].name, '运镜手册')
    assert.equal(r.body.bases[1].name, '通用资料')
  })

  await check('改名：id 与 slug 不变', async () => {
    const r = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbA.id)}`, jsonInit('PATCH', { name: '运镜宝典' }))
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.base.id, kbA.id)
    assert.equal(r.body.base.name, '运镜宝典')
    assert.equal(r.body.base.upstreamSlug, kbA.upstreamSlug)
    kbA = r.body.base
  })

  await check('改名撞重名被拒', async () => {
    const r = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbA.id)}`, jsonInit('PATCH', { name: '通用资料' }))
    assert.equal(r.status, 409, `期望 409，实际 ${r.status}`)
  })

  await check('不存在的 kbId 取清单返回 404 且说「知识库不存在」', async () => {
    const r = await api(base, '/api/knowledge/docs?kbId=kb_nope')
    assert.equal(r.status, 404)
    assert.match(String(r.body.message), /知识库不存在/)
  })

  let docLoc = ''
  await check('上传到指定库（按 kbId）', async () => {
    const r = await api(
      base,
      `/api/knowledge/upload?kbId=${encodeURIComponent(kbA.id)}&filename=${encodeURIComponent('机位表.md')}`,
      { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: Buffer.from('# 机位') },
    )
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.documents.length, 1)
    assert.equal(r.body.documents[0].title, '机位表.md')
    docLoc = r.body.documents[0].location
  })

  await check('文档出现在该库、不出现在另一库', async () => {
    const mine = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(kbA.id)}`)
    assert.equal(mine.body.docCount, 1)
    const list = await api(base, '/api/knowledge/bases')
    const other = list.body.bases.find((b) => b.name === '通用资料')
    const others = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(other.id)}`)
    assert.equal(others.body.docCount, 0, '另一个库不该看到这份文档')
  })

  await check('按 kbId 检索命中', async () => {
    const r = await api(base, '/api/knowledge/search', jsonInit('POST', { kbId: kbA.id, query: '机位' }))
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.hits.length, 1)
    assert.equal(r.body.hits[0].title, '机位表.md')
  })

  await check('会话选库：写后读回', async () => {
    const w = await api(base, '/api/knowledge/session-kb', jsonInit('POST', { sessionId: 'sess-1', kbId: kbA.id }))
    assert.equal(w.body.ok, true, w.body.message)
    const r = await api(base, `/api/knowledge/session-kb?sessionId=sess-1`)
    assert.equal(r.body.kbId, kbA.id)
    assert.equal(r.body.base.name, '运镜宝典')
  })

  await check('会话选库：不存在的 kbId 被拒', async () => {
    const r = await api(base, '/api/knowledge/session-kb', jsonInit('POST', { sessionId: 'sess-x', kbId: 'kb_nope' }))
    assert.equal(r.status, 404)
    assert.match(String(r.body.message), /知识库不存在/)
  })

  await check('会话选库：未选会话读回空', async () => {
    const r = await api(base, `/api/knowledge/session-kb?sessionId=sess-none`)
    assert.equal(r.body.kbId, '')
    assert.equal(r.body.base, null)
  })

  await check('移出本库（按 kbId）', async () => {
    const r = await api(base, '/api/knowledge/remove', jsonInit('POST', { kbId: kbA.id, locations: [docLoc] }))
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.removed, 1)
    const docs = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(kbA.id)}`)
    assert.equal(docs.body.docCount, 0)
  })

  await check('删库：清掉会话选择 + 尽力删上游 workspace', async () => {
    const before = mock.state.workspaces.size
    const r = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbA.id)}`, { method: 'DELETE' })
    assert.equal(r.body.ok, true, r.body.message)
    assert.equal(r.body.deleted, true)
    assert.equal(r.body.sessionsCleared, 1, '应清掉指向该库的会话选择')
    assert.equal(mock.state.workspaces.size, before - 1, '上游 workspace 应被删')
    const picked = await api(base, `/api/knowledge/session-kb?sessionId=sess-1`)
    assert.equal(picked.body.kbId, '', '库删后会话读回空')
  })

  await check('删不存在的库返回 404', async () => {
    const r = await api(base, '/api/knowledge/bases/kb_nope', { method: 'DELETE' })
    assert.equal(r.status, 404)
  })

  await check('上游不可用时删库仍成功且给 warning', async () => {
    const made = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '临时库' }))
    const id = made.body.base.id
    mock.state.offline = true
    const r = await api(base, `/api/knowledge/bases/${encodeURIComponent(id)}`, { method: 'DELETE' })
    mock.state.offline = false
    assert.equal(r.body.ok, true, '上游挂了不该让用户删不掉库')
    assert.equal(r.body.deleted, true)
    assert.ok(Array.isArray(r.body.warnings) && r.body.warnings.length > 0, '应给出残留提示')
    assert.match(String(r.body.warnings[0]), /未清理/)
  })
} finally {
  if (srv) {
    srv.child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 500))
    if (!srv.child.killed) srv.child.kill('SIGKILL')
  }
  await mock.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} 项失败` : '\n知识库库维度路由验收全部通过')
process.exit(bad ? 1 : 0)
