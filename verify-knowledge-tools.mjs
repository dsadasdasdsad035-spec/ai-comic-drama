/**
 * 知识库 Agent 工具验收（会话作用域）。
 *
 * 这一份验的是「作用域不出错」这件事 —— 它比工具能不能跑更重要：
 * 库选错了，用户会拿到另一个库的、看起来完全正常的答案，没有任何报错可循。
 *
 * 覆盖：
 * - 三个工具，schema 里没有任何库/项目字段（模型没有指向别的库的入口）
 * - 未选库：返回结构化说明（needKnowledgeBase + 可用库名），不抛错、不跨库
 * - 已选库：检索/读全文只命中该库；越库读取被服务端拒绝
 * - 库被删：返回「已被删除，请重选」，而不是「你还没选库」
 * - list_knowledge_bases：两种状态下都可用，且不改选定
 * - 桥：两个 sessionId 并发调用各自拿到自己库的结果（现建闭包，不串味）
 * - 分组：三个工具都在「读」组、进默认专家白名单
 *
 * 零成本：本地 mock AnythingLLM + 真实 server 进程（`desktop/bin/node`）。
 * 跑法：node verify-knowledge-tools.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-tools-'))
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

/** 用 esbuild 把 TS 打成 mjs 后真实 import（与仓库其它脚本一致） */
async function loadTs(rel) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kb-tools-ts-'))
  const out = path.join(dir, `${path.basename(rel, '.ts')}.mjs`)
  execFileSync(
    'node_modules/.bin/esbuild',
    [rel, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`],
    { stdio: 'inherit' },
  )
  return import(pathToFileURL(out).href)
}

// ---------------------------------------------------------------- mock 上游

function startMock() {
  const state = { docs: new Map(), nextId: 1, offline: false }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    if (state.offline) {
      req.socket.destroy()
      return
    }
    const send = (st, b) => {
      res.writeHead(st, { 'Content-Type': 'application/json' })
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
        state.docs.set(slug, [])
        return send(200, { workspace: { name, slug, documents: [] } })
      }
      if (p === '/v1/workspaces') {
        return send(200, {
          workspaces: [...state.docs.keys()].map((slug) => ({ slug, name: slug, documents: [] })),
        })
      }
      const one = p.match(/^\/v1\/workspace\/([^/]+)$/)
      if (one) {
        const slug = decodeURIComponent(one[1])
        const docs = state.docs.get(slug)
        if (!docs) return send(400, { error: 'no workspace' })
        return send(200, { workspace: [{ slug, documents: docs }] })
      }
      if (p === '/v1/document/upload' && req.method === 'POST') {
        const text = raw.toString('latin1')
        const addTo = (/name="addToWorkspaces"\r\n\r\n([^\r]+)/.exec(text)?.[1] || '').trim()
        const filename = Buffer.from(/filename="([^"]+)"/.exec(text)?.[1] || 'x', 'latin1').toString('utf8')
        const docs = state.docs.get(addTo)
        if (!docs) return send(400, { success: false, error: 'workspace not found', documents: [] })
        const doc = {
          location: `custom-documents/${filename}-${state.nextId++}.json`,
          title: filename,
          wordCount: 12,
        }
        docs.push(doc)
        return send(200, { success: true, error: null, documents: [doc] })
      }
      const search = p.match(/^\/v1\/workspace\/([^/]+)\/vector-search$/)
      if (search) {
        const docs = state.docs.get(decodeURIComponent(search[1])) || []
        if (!docs.length) return send(200, { results: [] })
        // 命中片段带来源标题：串库时断言能立刻看出来
        return send(200, {
          results: docs.slice(0, 1).map((d, i) => ({
            id: `v${i}`,
            text: `${'很长的命中片段'.repeat(200)}尾部标记｜来自${d.title}`,
            metadata: { title: d.title, chunkSource: d.location },
            score: 0.9,
          })),
        })
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'text/markdown': ['.md', '.txt'] } })
      }
      const doc = p.match(/^\/v1\/document\/(.+)$/)
      if (doc) {
        return send(200, {
          document: {
            title: decodeURIComponent(doc[1]),
            pageContent: `${'全文'.repeat(5000)}结尾`,
            wordCount: 5000,
          },
        })
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

const tools = await loadTs('src/agent/knowledgeTools.ts')
const groups = await loadTs('src/creative/expertToolGroups.ts')

await check('工具清单：三个只读工具，含 list_knowledge_bases', () => {
  assert.deepEqual([...tools.KNOWLEDGE_TOOL_NAMES].sort(), [
    'list_knowledge_bases',
    'read_knowledge_doc',
    'search_knowledge',
  ])
  const defs = tools.createKnowledgeTools({ sessionId: () => 's' })
  assert.deepEqual(defs.map((d) => d.name).sort(), [...tools.KNOWLEDGE_TOOL_NAMES].sort())
})

await check('schema 里没有任何库/项目字段', () => {
  const defs = new Map(tools.createKnowledgeTools({ sessionId: () => 's' }).map((d) => [d.name, d]))
  const keysOf = (n) => Object.keys(defs.get(n).schema?.shape || {}).sort()
  assert.deepEqual(keysOf('search_knowledge'), ['query', 'topN'])
  assert.deepEqual(keysOf('read_knowledge_doc'), ['docName'])
  assert.deepEqual(keysOf('list_knowledge_bases'), [])
  for (const n of ['search_knowledge', 'read_knowledge_doc', 'list_knowledge_bases']) {
    const raw = JSON.stringify(Object.keys(defs.get(n).schema?.shape || {}))
    for (const forbidden of ['kbId', 'sessionId', 'project', 'workspace', 'slug']) {
      assert.equal(raw.includes(forbidden), false, `${n} 不应含 ${forbidden}`)
    }
  }
})

await check('分组：三个工具都在「读」组、进默认专家白名单', () => {
  for (const n of tools.KNOWLEDGE_TOOL_NAMES) {
    assert.equal(groups.classifyExpertTool(n), 'read', `${n} 应在 read 组`)
    assert.ok(new Set(groups.DEFAULT_EXPERT_PLATFORM_TOOLS).has(n), `${n} 应在默认白名单`)
  }
})

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
    ANYTHINGLLM_API_KEY: 'k',
    SB_BUILTIN_KNOWLEDGE: '1',
  })
  const base = srv.base

  const mkBase = async (name) => {
    const r = await api(base, '/api/knowledge/bases', jsonInit('POST', { name }))
    assert.equal(r.body.ok, true, r.body.message)
    return r.body.base
  }
  const upload = async (kbId, filename) => {
    const r = await api(
      base,
      `/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=${encodeURIComponent(filename)}`,
      { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: Buffer.from(`# ${filename}`) },
    )
    assert.equal(r.body.ok, true, r.body.message)
    return r.body.documents[0]
  }

  const kbA = await mkBase('运镜手册')
  const kbB = await mkBase('通用资料')
  await upload(kbA.id, '运镜规则.md')
  await upload(kbB.id, '品牌规范.md')

  // ---- 用真实的工具桥（同时验 sessionId 透传与「现建闭包不串味」）
  const { StudioToolBridge } = await import(
    pathToFileURL(path.join(ROOT, 'server', 'studio-tool-bridge.mjs')).href
  )
  const bridge = new StudioToolBridge({
    root: ROOT,
    baseUrl: base,
    internalToken: 'test-internal',
    log: () => {},
  })

  await check('未选库：检索返回结构化说明 + 可用库名，不抛错', async () => {
    const r = await bridge.invoke('search_knowledge', { query: '运镜' }, { sessionId: 'sess-unset' })
    assert.equal(r.ok, false, '未选库应是可读失败而不是成功')
    const d = r.details
    assert.equal(d.needKnowledgeBase, true, '应标记 needKnowledgeBase')
    assert.match(String(d.error), /还没有选择知识库/, d.error)
    assert.match(String(d.error), /运镜手册/, '文案里应列出可用库名')
    assert.ok(Array.isArray(d.availableBases) && d.availableBases.length === 2, '应给出库清单')
  })

  await check('未选库：读全文同样返回可读说明', async () => {
    const r = await bridge.invoke(
      'read_knowledge_doc',
      { docName: '运镜规则.md' },
      { sessionId: 'sess-unset' },
    )
    assert.equal(r.ok, false)
    assert.equal(r.details.needKnowledgeBase, true)
    assert.match(String(r.details.error), /还没有选择知识库/)
  })

  await check('未选库：list_knowledge_bases 仍可用并列出两个库', async () => {
    const r = await bridge.invoke('list_knowledge_bases', {}, { sessionId: 'sess-unset' })
    assert.equal(r.ok, true, r.details?.error)
    assert.equal(r.details.bases.length, 2)
    assert.deepEqual(
      r.details.bases.map((b) => b.name),
      ['运镜手册', '通用资料'],
    )
  })

  await check('会话 A 选库后：检索只命中本库', async () => {
    const w = await api(
      base,
      '/api/knowledge/session-kb',
      jsonInit('POST', { sessionId: 'sess-A', kbId: kbA.id }),
    )
    assert.equal(w.body.ok, true, w.body.message)
    const r = await bridge.invoke('search_knowledge', { query: '运镜' }, { sessionId: 'sess-A' })
    assert.equal(r.ok, true, JSON.stringify(r.details))
    const hits = r.details.hits
    assert.equal(hits.length, 1)
    assert.equal(hits[0].title, '运镜规则.md', '不该命中另一个库的文档')
    assert.ok(hits[0].snippet.length <= 640, `摘要应截断，实际 ${hits[0].snippet.length}`)
    assert.match(hits[0].snippet, /片段已截断/)
    assert.match(hits[0].fullText, /尾部标记/, '完整片段应保留给界面')
  })

  await check('会话 B 选另一个库：并发交替调用各拿各的（不串味）', async () => {
    const w = await api(
      base,
      '/api/knowledge/session-kb',
      jsonInit('POST', { sessionId: 'sess-B', kbId: kbB.id }),
    )
    assert.equal(w.body.ok, true, w.body.message)
    // 交替并发：若桥复用了按项目缓存的那张工具表，后一次会把前一次的库覆盖掉
    const [a, b, a2, b2] = await Promise.all([
      bridge.invoke('search_knowledge', { query: 'x' }, { sessionId: 'sess-A' }),
      bridge.invoke('search_knowledge', { query: 'x' }, { sessionId: 'sess-B' }),
      bridge.invoke('search_knowledge', { query: 'y' }, { sessionId: 'sess-A' }),
      bridge.invoke('search_knowledge', { query: 'z' }, { sessionId: 'sess-B' }),
    ])
    for (const r of [a, a2]) {
      assert.equal(r.ok, true, JSON.stringify(r.details))
      assert.equal(r.details.hits[0].title, '运镜规则.md')
    }
    for (const r of [b, b2]) {
      assert.equal(r.ok, true, JSON.stringify(r.details))
      assert.equal(r.details.hits[0].title, '品牌规范.md')
    }
  })

  await check('list_knowledge_bases 不改变会话已选定的库', async () => {
    const before = await api(base, '/api/knowledge/session-kb?sessionId=sess-A')
    await bridge.invoke('list_knowledge_bases', {}, { sessionId: 'sess-A' })
    const after = await api(base, '/api/knowledge/session-kb?sessionId=sess-A')
    assert.equal(after.body.kbId, before.body.kbId)
    assert.equal(after.body.kbId, kbA.id)
  })

  await check('已选库：读全文读得到本库文档', async () => {
    const r = await bridge.invoke(
      'read_knowledge_doc',
      { docName: '运镜规则.md' },
      { sessionId: 'sess-A' },
    )
    assert.equal(r.ok, true, JSON.stringify(r.details))
    assert.equal(r.details.title, '运镜规则.md')
    assert.ok(r.details.text.length > 0)
  })

  await check('越库读取被拒：会话 A 读不到 B 库的文档', async () => {
    const r = await bridge.invoke(
      'read_knowledge_doc',
      { docName: '品牌规范.md' },
      { sessionId: 'sess-A' },
    )
    assert.equal(r.ok, false, '读别的库的文档必须失败')
    const msg = String(r.details?.error ?? r.error ?? '')
    assert.match(msg, /不在本次会话选定的知识库里/, msg)
  })

  await check('删库清掉会话选择：该会话回到「还没选」，其它会话不受影响', async () => {
    const del = await api(base, `/api/knowledge/bases/${encodeURIComponent(kbB.id)}`, { method: 'DELETE' })
    assert.equal(del.body.ok, true, del.body.message)
    assert.ok(del.body.sessionsCleared >= 1, '应清掉指向该库的会话选择')
    const r = await bridge.invoke('search_knowledge', { query: 'x' }, { sessionId: 'sess-B' })
    assert.equal(r.ok, false)
    assert.equal(r.details.needKnowledgeBase, true)
    assert.match(String(r.details.error), /还没有选择知识库/, r.details.error)
    // 会话 A 的库还在：删除 B 不该影响 A
    const ok = await bridge.invoke('search_knowledge', { query: 'x' }, { sessionId: 'sess-A' })
    assert.equal(ok.ok, true, JSON.stringify(ok.details))
  })

  await check('库记录丢失（选过但库里没有这个库）：提示已被删除并重选，不抛错', async () => {
    /*
     * 这条只在「选过的库从库里消失、但会话记录还在」时出现：
     * 正常删库会一并清掉会话选择（上一条），而这条路径来自库外部变动
     * （手工改库、换机器恢复备份、上游重建）。直接用同一份 SQLite 造出这个状态。
     */
    const dbApi = await import(pathToFileURL(path.join(ROOT, 'server', 'db.mjs')).href)
    // 直接指到 server 进程用的那个库文件：resolveRoot 会读 SB_PROJECTS_DIR，
    // 本进程没有那个 env，用 resolveRoot(PROJECTS) 会落到另一个目录
    const d = dbApi.openDatabase(PROJECTS)
    try {
      dbApi.setSessionKnowledgeBase(d, 'sess-ghost', 'kb_that_is_gone')
    } finally {
      d.close()
    }
    const r = await bridge.invoke('search_knowledge', { query: 'x' }, { sessionId: 'sess-ghost' })
    assert.equal(r.ok, false)
    const msg = String(r.details?.error ?? r.error ?? '')
    assert.equal(r.details?.reselect, true, '应标记 reselect')
    assert.match(msg, /已被删除/, msg)
    assert.match(msg, /重新选择/, msg)
  })

  await check('桥的 catalog 里三个知识库工具都在，且 schema 无库参数', async () => {
    const list = await bridge.catalog('', 1)
    const names = list.map((t) => t.name)
    for (const n of tools.KNOWLEDGE_TOOL_NAMES) assert.ok(names.includes(n), `catalog 缺 ${n}`)
    const search = list.find((t) => t.name === 'search_knowledge')
    const props = Object.keys(search.parameters.properties || {})
    assert.deepEqual(props.sort(), ['query', 'topN'])
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

console.log(bad ? `\n${bad} 项失败` : '\n知识库工具验收（会话作用域）全部通过')
process.exit(bad ? 1 : 0)
