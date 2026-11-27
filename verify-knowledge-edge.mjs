/**
 * 知识库边界条件验收（库维度，自带 mock 上游，零成本）。
 *
 * 覆盖用户实际会撞到的异常输入：
 * - 不支持的文件类型（拒绝，且给出可读原因）
 * - 空文件（拒绝）
 * - 超大文件（本地按 Content-Length 预拒绝，不浪费上游配额）
 * - 并发上传多个文件（互不干扰）
 * - 文件名含中文 / 超长（不得 500）
 * - 非法文档标识（防路径穿越）
 * - 不存在的 kbId（可读 404，不是 500）
 * - 空 query 检索被本地拒绝
 *
 * 跑法：node verify-knowledge-edge.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-edge-'))
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

/** 只实现上传与清单：边界验收不需要问答链路 */
function startMockAnythingLLM() {
  const state = { workspaces: new Map(), nextId: 1, uploadCalls: 0 }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    const send = (s, b) => {
      res.writeHead(s, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(b))
    }
    if (String(req.headers.authorization || '') !== 'Bearer k') return send(403, { error: 'bad key' })
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
        const slug = `ws-${state.nextId++}`
        state.workspaces.set(slug, { slug, name, documents: [] })
        return send(200, { workspace: { name, slug, documents: [] } })
      }
      if (p === '/v1/workspaces') {
        return send(200, { workspaces: [...state.workspaces.values()] })
      }
      const one = p.match(/^\/v1\/workspace\/([^/]+)$/)
      if (one) {
        const slug = decodeURIComponent(one[1])
        const ws = state.workspaces.get(slug)
        if (req.method === 'DELETE') {
          state.workspaces.delete(slug)
          return send(200, { message: 'deleted' })
        }
        return send(200, { workspace: ws ? [{ ...ws }] : [] })
      }
      if (p === '/v1/document/upload' && req.method === 'POST') {
        state.uploadCalls += 1
        const text = raw.toString('latin1')
        const addTo = (/name="addToWorkspaces"\r\n\r\n([^\r]+)/.exec(text)?.[1] || '').trim()
        const filename = Buffer.from(/filename="([^"]+)"/.exec(text)?.[1] || 'x', 'latin1').toString('utf8')
        const ws = state.workspaces.get(addTo)
        if (!ws) return send(400, { success: false, error: 'workspace not found', documents: [] })
        // 模拟上游的真实拒绝：不支持的类型、空文件
        if (!/\.(md|txt|pdf|doc|docx|xls|xlsx)$/i.test(filename)) {
          return send(200, { success: false, error: `File type not supported: ${filename}`, documents: [] })
        }
        const fileStart = text.indexOf('name="file"')
        const bodyStart = fileStart >= 0 ? text.indexOf('\r\n\r\n', fileStart) : -1
        const bodyEnd = text.lastIndexOf('\r\n--')
        const bodyLen = bodyStart >= 0 && bodyEnd > bodyStart ? bodyEnd - (bodyStart + 4) : -1
        if (bodyLen === 0) {
          return send(200, { success: false, error: 'File is empty or missing', documents: [] })
        }
        const doc = {
          location: `custom-documents/${encodeURIComponent(filename)}-${state.nextId++}.json`,
          title: filename,
          wordCount: 9,
        }
        ws.documents.push(doc)
        return send(200, { success: true, error: null, documents: [doc] })
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'text/markdown': ['.md', '.txt'], 'application/pdf': ['.pdf'] } })
      }
      const search = p.match(/^\/v1\/workspace\/([^/]+)\/vector-search$/)
      if (search) return send(200, { results: [] })
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

async function api(base, p, init = {}) {
  const r = await fetch(base + p, init)
  const t = await r.text()
  let body = t
  try {
    body = JSON.parse(t)
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, body }
}

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const mock = await startMockAnythingLLM()
let srv
try {
  srv = await startServer({
    SB_PORT: '0',
    SB_PROJECTS_DIR: PROJECTS,
    SB_MEDIA_ROOT: MEDIA,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_STUDIO_NO_PREWARM: '1',
    ANYTHINGLLM_BASE_URL: `http://127.0.0.1:${mock.port}`,
    ANYTHINGLLM_API_KEY: 'k',
    SB_BUILTIN_KNOWLEDGE: '1',
  })
  const base = srv.base

  const made = await api(base, '/api/knowledge/bases', jsonInit('POST', { name: '边界验收库' }))
  assert.equal(made.body.ok, true, made.body.message)
  const kbId = made.body.base.id

  const upload = (filename, bytes, mime = 'application/octet-stream') =>
    api(
      base,
      `/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=${encodeURIComponent(filename)}`,
      { method: 'POST', headers: { 'Content-Type': mime }, body: bytes },
    )

  await check('不支持的类型：.exe 被上游拒绝且原因可读', async () => {
    const r = await upload('virus.exe', Buffer.from('MZ\x90\x00fake'), 'application/octet-stream')
    assert.equal(r.body.ok, false, '不该接受 .exe')
    assert.ok(String(r.body.message || '').length > 0, '必须给出可读原因')
  })

  await check('空文件被拒绝', async () => {
    const r = await upload('empty.md', Buffer.alloc(0), 'text/markdown')
    assert.equal(r.body.ok, false, '空文件不该上传成功')
    assert.ok(String(r.body.message || '').length > 0)
  })

  await check('超大文件在本地被预拒绝（413，不浪费上游配额）', async () => {
    const before = mock.state.uploadCalls
    const big = Buffer.alloc(101 * 1024 * 1024, 0x61)
    const r = await upload('huge.md', big, 'text/markdown')
    assert.equal(r.status, 413, `期望 413，实际 ${r.status}：${String(r.body?.message || '').slice(0, 80)}`)
    // 预拒绝的意义：上游一次上传请求都没收到
    assert.equal(mock.state.uploadCalls, before, '不该走到上游')
  })

  await check('中文文件名正常入库', async () => {
    const content = Buffer.from('# 中文文件名测试\n\n核心词：朱雀。\n', 'utf8')
    const r = await upload('世界观·朱雀卷.md', content, 'text/markdown')
    assert.equal(r.body.ok, true, r.body.message)
    const title = r.body.documents?.[0]?.title || ''
    assert.match(title, /朱雀卷/, `标题丢了中文：${title}`)
  })

  await check('并发上传 3 个文件互不干扰', async () => {
    const files = ['并发A.md', '并发B.md', '并发C.md'].map((n) => ({
      n,
      b: Buffer.from(`# ${n}\n\n并发测试文档。\n`, 'utf8'),
    }))
    const results = await Promise.all(files.map((f) => upload(f.n, f.b, 'text/markdown')))
    const okCount = results.filter((r) => r.body?.ok).length
    assert.equal(okCount, 3, `${okCount}/3 成功：${JSON.stringify(results.map((r) => r.body?.message))}`)
  })

  await check('清单里能看到上面所有文档', async () => {
    const r = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(kbId)}`)
    assert.equal(r.body.ok, true, r.body.message)
    const titles = (r.body.documents || []).map((d) => d.title).join(' | ')
    for (const want of ['朱雀卷', '并发A', '并发B', '并发C']) {
      assert.ok(titles.includes(want), `清单缺 ${want}：${titles}`)
    }
  })

  await check('移出时传非法路径被拒绝（防穿越）', async () => {
    const r = await api(base, '/api/knowledge/purge', jsonInit('POST', { locations: ['../../etc/passwd'] }))
    assert.equal(r.body.ok, false, '非法路径竟然通过')
    assert.match(String(r.body.message), /不合法/)
  })

  await check('不存在的 kbId 返回可读 404（不是 500）', async () => {
    const r = await api(base, '/api/knowledge/docs?kbId=kb_nope')
    assert.equal(r.status, 404)
    assert.equal(r.body.ok, false)
    assert.match(String(r.body.message), /知识库不存在/)
  })

  await check('缺 kbId 的文档接口给出可读 400（不是崩溃）', async () => {
    const r = await api(base, '/api/knowledge/docs')
    assert.equal(r.status, 400)
    assert.ok(String(r.body.message || '').length > 0)
  })

  await check('超长文件名不崩溃', async () => {
    const longName = `${'超长'.repeat(80)}.md`
    const r = await upload(longName, Buffer.from('# x\n', 'utf8'), 'text/markdown')
    assert.equal(typeof r.body, 'object', '返回了非 JSON')
    // 上游可能截断或拒绝，只要不是 500 且返回可读内容就算稳
    assert.notEqual(r.status, 500)
  })

  await check('空 query 检索被本地拒绝', async () => {
    const r = await api(base, '/api/knowledge/search', jsonInit('POST', { kbId, query: '   ' }))
    assert.equal(r.body.ok, false, '空 query 竟然通过了')
    assert.match(String(r.body.message), /不能为空/)
  })

  await check('删库后文档接口 404（不留半残状态）', async () => {
    const del = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbId)}`, { method: 'DELETE' })
    assert.equal(del.body.ok, true, del.body.message)
    const r = await api(base, `/api/knowledge/docs?kbId=${encodeURIComponent(kbId)}`)
    assert.equal(r.status, 404)
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

console.log(bad ? `\n${bad} 项失败` : '\n边界条件验收全部通过')
process.exit(bad ? 1 : 0)
