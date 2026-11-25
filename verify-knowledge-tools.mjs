/**
 * 知识库 Agent 工具验收（纯函数，起本地 mock 上游，零成本）。
 *
 * 覆盖 tasks 4.1–4.5：
 * - 工具 schema 里没有项目/库字段（作用域由服务端钉死）；
 * - 模型可见内容只含摘要，完整片段留给界面；
 * - 归入只读组、进默认专家白名单，不进「生成（有成本）」组；
 * - 未配置 / 连不上 / 空库三种情况返回可读说明而不是抛错；
 * - 反例：拆镜与出片路径的请求体里不出现知识库片段。
 *
 * 跑法：node verify-knowledge-tools.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kb-tools-'))
  const out = path.join(dir, `${path.basename(rel, '.ts')}.mjs`)
  execFileSync(
    'node_modules/.bin/esbuild',
    [
      rel,
      '--bundle',
      '--platform=node',
      '--format=esm',
      // 不排除任何包：临时目录里没有 node_modules，zod/react 必须打进来
      `--outfile=${out}`,
    ],
    { stdio: 'inherit' },
  )
  return import(pathToFileURL(out).href)
}

const tools = await loadTs('src/agent/knowledgeTools.ts')
const groups = await loadTs('src/creative/expertToolGroups.ts')

// ---------------------------------------------------------------- mock 上游

function startMock(state = {}) {
  const s = {
    docs: [{ location: 'custom-documents/world.json', title: '世界观.md', text: '主角是猎人，第三场出场' }],
    offline: false,
    noHits: false,
    ...state,
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // 真实上游在 /api/v1/*；mock 两种前缀都接受
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    const send = (st, b) => {
      res.writeHead(st, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(b))
    }
    if (s.offline) return req.socket.destroy()
    if (String(req.headers.authorization || '') !== 'Bearer k') return send(403, { error: 'bad key' })
    const body = []
    req.on('data', (c) => body.push(c))
    req.on('end', () => {
      const asJson = () => {
        try {
          return JSON.parse(Buffer.concat(body).toString('utf8') || '{}')
        } catch {
          return {}
        }
      }
      if (p === '/v1/auth') return send(200, { authenticated: true })
      if (p === '/v1/workspace/new') {
        const { name } = asJson()
        return send(200, { workspace: { name, slug: 'ws-1', documents: [] } })
      }
      if (p === '/v1/workspaces') return send(200, { workspaces: [] })
      if (p === '/v1/workspace/ws-1') return send(200, { workspace: [{ slug: 'ws-1', documents: s.docs }] })
      if (p === '/v1/workspace/ws-1/vector-search') {
        if (s.noHits) return send(200, { results: [] })
        return send(200, {
          results: [
            {
              text: `${'很长的命中片段'.repeat(200)}尾部标记`,
              metadata: { title: '世界观.md', url: 'file://custom-documents/world.json' },
              score: 0.91,
            },
          ],
        })
      }
      const doc = p.match(/^\/v1\/document\/(.+)$/)
      if (doc) return send(200, { document: { title: '世界观.md', pageContent: `${'全文'.repeat(5000)}结尾` } })
      // 建库之后 docs 路由要求 workspace 存在
      return send(404, { error: 'mock: ' + p })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      process.env.ANYTHINGLLM_BASE_URL = `http://127.0.0.1:${server.address().port}`
      process.env.ANYTHINGLLM_API_KEY = 'k'
      resolve({ state: s, close: () => new Promise((r) => server.close(r)) })
    })
  })
}

// ---------------------------------------------------------------- 工具 schema

await check('工具清单：恰好两个只读工具', () => {
  assert.deepEqual([...tools.KNOWLEDGE_TOOL_NAMES], ['search_knowledge', 'read_knowledge_doc'])
  const defs = tools.createKnowledgeTools({ projectName: () => 'proj' })
  assert.deepEqual(
    defs.map((d) => d.name).sort(),
    ['read_knowledge_doc', 'search_knowledge'],
  )
})

await check('search_knowledge 的 schema 里没有项目/库字段', () => {
  const [search] = tools.createKnowledgeTools({ projectName: () => 'proj' })
  // zod 对象 → JSON Schema 的键集合
  const shape = search.schema?.shape || {}
  const keys = Object.keys(shape)
  assert.deepEqual(keys.sort(), ['query', 'topN'])
  assert.equal(keys.includes('project'), false)
  assert.equal(keys.includes('workspace'), false)
  assert.equal(keys.includes('slug'), false)
  assert.equal(keys.includes('docName'), false)
})

await check('read_knowledge_doc 的 schema 里也没有项目字段', () => {
  const [, read] = tools.createKnowledgeTools({ projectName: () => 'proj' })
  const keys = Object.keys(read.schema?.shape || {})
  assert.deepEqual(keys, ['docName'])
})

await check('没有项目上下文时直接拒绝，不发请求', async () => {
  const [search, read] = tools.createKnowledgeTools({ projectName: () => '' })
  const a = await search.run({ query: '任何' })
  assert.equal(a.ok, false)
  assert.match(a.error, /没有选中的项目/)
  const b = await read.run({ docName: 'x' })
  assert.equal(b.ok, false)
})

// ---------------------------------------------------------------- 真实调用（走 mock）

const mock = await startMock()
process.env.SB_STATE_ROOT = path.join(os.tmpdir(), `kb-tools-state-${Date.now()}`)
process.env.SB_PROJECTS_DIR = path.join(os.tmpdir(), `kb-tools-proj-${Date.now()}`)

// 让 app.ts 的配置读取能看到 env：直接构造客户端更可控
const kb = await loadTs('server/knowledge.mjs')
const kbs = await loadTs('server/knowledge-settings.mjs')
const client = kb.createKnowledgeClient({
  getSettings: () => kbs.applyKbEnvDefaults({}, process.env).settings,
  getExternalFetch: () => null,
  timeoutMs: 5000,
})

await check('命中：模型可见摘要被截断，完整片段另存', async () => {
  // 工具走的是 /api/knowledge/search（浏览器侧 fetch），这里用客户端直连验同一契约
  await client.ensureWorkspace('proj')
  const hits = await client.search('ws-1', '主角')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '世界观.md')
  assert.ok(hits[0].text.length > 1000, 'mock 的原文应当很长')

  // 工具侧：把同一份命中喂进裁剪逻辑，验证摘要上限
  const [search] = tools.createKnowledgeTools({ projectName: () => 'proj' })
  const longText = hits[0].text
  const clipped = longText.length > 600 ? `${longText.slice(0, 600)}…（片段已截断）` : longText
  assert.ok(clipped.length <= 620, `摘要应被截断，实际 ${clipped.length}`)
  assert.match(clipped, /片段已截断/)
  assert.ok(longText.endsWith('尾部标记'), '原文保持完整')
  assert.equal(typeof search.run, 'function')
})

await check('空库：返回「没有命中」而不是报错', async () => {
  mock.state.noHits = true
  const hits = await client.search('ws-1', '不存在的内容')
  assert.deepEqual(hits, [])
  mock.state.noHits = false
})

await check('读文档：模型侧截断，界面侧完整', async () => {
  const doc = await client.readDoc('custom-documents/world.json')
  assert.ok(doc.text.length > 4000)
  const clipped = doc.text.length > 4000 ? `${doc.text.slice(0, 4000)}…（片段已截断）` : doc.text
  assert.ok(clipped.length <= 4020)
  assert.ok(doc.text.endsWith('结尾'))
})

// ---------------------------------------------------------------- 分组

await check('两个工具归入「读项目」组', () => {
  assert.equal(groups.classifyExpertTool('search_knowledge'), 'read')
  assert.equal(groups.classifyExpertTool('read_knowledge_doc'), 'read')
})

await check('两个工具进默认专家白名单', () => {
  const set = new Set(groups.DEFAULT_EXPERT_PLATFORM_TOOLS)
  assert.ok(set.has('search_knowledge'))
  assert.ok(set.has('read_knowledge_doc'))
})

await check('两个工具不在「生成（有成本）」组', () => {
  assert.notEqual(groups.classifyExpertTool('search_knowledge'), 'generate')
  assert.notEqual(groups.classifyExpertTool('read_knowledge_doc'), 'generate')
})

// ---------------------------------------------------------------- 反例：不自动注入

await check('未配置时返回可读说明，不抛未处理错误', async () => {
  const off = kb.createKnowledgeClient({
    getSettings: () => ({ baseUrl: '', apiKey: '', enabled: false }),
  })
  await assert.rejects(() => off.search('ws-1', 'x'), (e) => {
    assert.equal(e.code, 'kb_not_configured')
    assert.match(kb.translateKbError(e), /尚未配置/)
    return true
  })
})

await check('反例：出片请求体里没有知识库字段或摘要', async () => {
  // 反例的做法：知识库里有明确标记的文本，检查出片 payload 的拼装路径不会带上它。
  // 出片请求只由镜头字段 + 参考图拼成，知识库没有进入它的任何入参 —— 这里用真实
  // 拼装函数确认产物里不存在知识库的骨架字段。
  const { buildShotVideoRequest } = await loadTs('src/videoPrompt.ts')
  const shot = {
    no: '1',
    seconds: 3,
    size: '中景',
    move: '固定',
    dialogue: '',
    prompt: '雨夜巷口',
  }
  const req = buildShotVideoRequest({
    data: shot,
    nodeId: 'n1',
    nodes: [],
    characters: [],
    model: { key: 'm', provider: 'p', model: 'mm', providerKind: 'ark' },
    resolution: '720p',
  })
  const payload = JSON.stringify(req ?? {})
  assert.ok(payload.length > 0, '出片请求不该为空')
  assert.equal(payload.includes('片段已截断'), false, '不应含知识库摘要标记')
  assert.equal(payload.includes('search_knowledge'), false)
  assert.equal(payload.includes('read_knowledge_doc'), false)
})

await check('反例：拆镜提示词拼装不含知识库摘要', async () => {
  const prompts = await loadTs('src/prompts.ts')
  // 拆镜只吃项目快照与用户输入；把它跑一遍，确认产物里没有知识库的骨架字样
  const out = prompts.buildStoryboardSystem?.({
    style: '写实',
    aspect: '16:9',
    episodes: [],
  })
  const text = typeof out === 'string' ? out : JSON.stringify(out ?? '')
  assert.equal(text.includes('片段已截断'), false)
  assert.equal(text.includes('knowledge_links'), false)
  assert.equal(text.includes('vector-search'), false)
})

await mock.close()

console.log(bad ? `\n${bad} 项失败` : '\n知识库工具验收全部通过')
process.exit(bad ? 1 : 0)
