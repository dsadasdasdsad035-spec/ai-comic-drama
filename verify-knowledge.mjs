/**
 * 知识库（AnythingLLM）伴生服务验收。
 *
 * 分层验证，全部免费：
 * - 纯函数：地址候选、回环判定、错误翻译、上传表单、应答归一化、文档标识校验；
 * - 客户端：对本地 mock AnythingLLM 跑建库/上传/列表/检索/问答历史/删除；
 * - 集成：由 `verify-knowledge-ui.mjs` 覆盖页面，这里只验服务端契约。
 *
 * 不依赖真实 AnythingLLM，不产生任何外部费用。
 * 跑法：node verify-knowledge.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from './server/db.mjs'
import {
  DEFAULT_KB_BASE_URL,
  KB_SESSION_PREFIX,
  MAX_KB_UPLOAD_BYTES,
  assertDocLocations,
  buildUploadForm,
  createKnowledgeClient,
  deleteKbLink,
  isLoopbackBase,
  isUsableSlug,
  kbBaseCandidates,
  kbSessionId,
  normalizeUploadedDocs,
  normalizeWorkspace,
  parseSseDataLine,
  readKbLink,
  stripReasoning,
  stripChunkMetadata,
  translateKbError,
  validateKbBaseUrl,
  writeKbLink,
} from './server/knowledge.mjs'
import {
  KB_ENV_API_KEY,
  KB_ENV_BASE_URL,
  applyKbEnvDefaults,
  mergeKbSettings,
  normalizeKbSettings,
  redactKbSettings,
} from './server/knowledge-settings.mjs'

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

// ---------------------------------------------------------------- 纯函数

await check('地址候选：回环地址保持原样', () => {
  assert.deepEqual(kbBaseCandidates('http://127.0.0.1:3001'), ['http://127.0.0.1:3001'])
  assert.deepEqual(kbBaseCandidates('http://localhost:3001/'), ['http://localhost:3001'])
  assert.deepEqual(kbBaseCandidates(''), [])
})

await check('地址候选：host.docker.internal 回退 127.0.0.1', () => {
  assert.deepEqual(kbBaseCandidates('http://host.docker.internal:3001'), [
    'http://host.docker.internal:3001',
    'http://127.0.0.1:3001',
  ])
})

await check('地址候选：非法协议与坏地址返回空', () => {
  assert.deepEqual(kbBaseCandidates('ftp://127.0.0.1:3001'), [])
  assert.deepEqual(kbBaseCandidates('not a url'), [])
})

await check('回环判定：本机地址必须直连', () => {
  assert.equal(isLoopbackBase('http://127.0.0.1:3001'), true)
  assert.equal(isLoopbackBase('http://localhost:3001'), true)
  assert.equal(isLoopbackBase('http://[::1]:3001'), true)
  assert.equal(isLoopbackBase('http://192.168.1.20:3001'), false)
  assert.equal(isLoopbackBase('https://kb.example.com'), false)
  assert.equal(isLoopbackBase('garbage'), false)
})

await check('地址校验：错误文案可读', () => {
  assert.equal(validateKbBaseUrl('http://127.0.0.1:3001'), '')
  assert.match(validateKbBaseUrl(''), /请填写/)
  assert.match(validateKbBaseUrl('127.0.0.1:3001'), /格式不正确/)
  assert.match(validateKbBaseUrl('ftp://x'), /http/)
})

await check('会话分区：同一项目恒定', () => {
  assert.equal(kbSessionId('mo-ren'), `${KB_SESSION_PREFIX}mo-ren`)
  assert.equal(kbSessionId('mo-ren'), kbSessionId('mo-ren'))
  assert.notEqual(kbSessionId('a'), kbSessionId('b'))
})

await check('slug 可用性：空串与非法字符都要重建', () => {
  assert.equal(isUsableSlug('mo-ren-123'), true)
  assert.equal(isUsableSlug(''), false)
  assert.equal(isUsableSlug('../etc'), false)
  assert.equal(isUsableSlug('猎魔人'), false)
})

await check('错误翻译：连接与凭据', () => {
  assert.match(translateKbError(new Error('fetch failed')), /连不上知识库服务/)
  assert.match(translateKbError(new Error('connect ECONNREFUSED 127.0.0.1:3001')), /连不上知识库服务/)
  assert.match(translateKbError({ status: 403 }), /API Key 无效/)
  assert.match(translateKbError({ status: 401 }), /API Key 无效/)
  assert.match(translateKbError(new Error('No valid api key found.')), /API Key 无效/)
})

await check('错误翻译：collector 离线单独说明', () => {
  const msg = 'Document processing API is not online. Document a.pdf will not be processed automatically.'
  assert.match(translateKbError({ message: msg }), /collector/)
})

await check('错误翻译：上游没配模型要给指引', () => {
  assert.match(translateKbError({ message: 'No model found for this provider' }), /对话模型/)
})

await check('错误翻译：未配置优先于一切', () => {
  assert.match(translateKbError(new Error('anything'), { hasConfig: false }), /尚未配置/)
})

await check('错误翻译：未知错误回落到原文', () => {
  assert.match(translateKbError({ message: '奇怪的上游错误' }), /奇怪的上游错误/)
  assert.match(translateKbError({ status: 500, message: 'boom' }), /内部错误/)
})

await check('上传表单：文件名与库标识都带上', async () => {
  const { form, filename } = buildUploadForm({
    filename: '世界观.md',
    bytes: Buffer.from('# 世界观'),
    mime: 'text/markdown',
    workspaceSlug: 'mo-ren',
  })
  assert.equal(filename, '世界观.md')
  assert.equal(form.get('addToWorkspaces'), 'mo-ren')
  const file = form.get('file')
  assert.ok(file instanceof Blob)
  assert.equal(file.name, '世界观.md')
  assert.equal(file.type, 'text/markdown')
  assert.equal(await file.text(), '# 世界观')
})

await check('上传表单：缺文件名与空内容被拒', () => {
  assert.throws(() => buildUploadForm({ filename: '', bytes: Buffer.from('x') }), /文件名/)
  assert.throws(() => buildUploadForm({ filename: 'a.md', bytes: Buffer.alloc(0) }), /为空/)
})

await check('上传表单：超上限被拒', () => {
  assert.throws(
    () => buildUploadForm({ filename: 'big.bin', bytes: Buffer.alloc(MAX_KB_UPLOAD_BYTES + 1) }),
    /超过上限/,
  )
})

await check('workspace 归一：各版本计数字段都收敛到 docCount', () => {
  assert.equal(normalizeWorkspace({ slug: 'a', name: 'A', documents: [{}, {}] }).docCount, 2)
  assert.equal(normalizeWorkspace({ slug: 'a', name: 'A', documentCount: 5 }).docCount, 5)
  assert.equal(normalizeWorkspace({ slug: 'a', name: 'A', _count: { documents: 7 } }).docCount, 7)
  assert.equal(normalizeWorkspace({}).docCount, 0)
})

await check('上传应答归一：有 location 时原样保留', () => {
  const docs = normalizeUploadedDocs({
    success: true,
    documents: [{ location: 'custom-documents/a.json', title: '世界观', wordCount: 12 }],
  })
  assert.equal(docs.length, 1)
  assert.equal(docs[0].location, 'custom-documents/a.json')
  assert.equal(docs[0].title, '世界观')
  assert.equal(docs[0].wordCount, 12)
})

await check('上传应答归一：真实上游无 location 时保留 docId（不能丢文档）', () => {
  // 实测真实 AnythingLLM 的 upload 应答只有 id/url/title，没有 location。
  // 旧实现只认 location 会把上传成功的文档全丢掉 —— 这条断言钉住该回归。
  const docs = normalizeUploadedDocs({
    success: true,
    documents: [{ id: 'c13881b3-aaaa', url: 'file:///x.md', title: 'kb.md', wordCount: 2 }],
  })
  assert.equal(docs.length, 1, '没有 location 也必须保留条目')
  assert.equal(docs[0].location, '', 'location 为空，由调用方回查 docpath 补上')
  assert.equal(docs[0].docId, 'c13881b3-aaaa')
  assert.equal(docs[0].title, 'kb.md')
})

await check('上传应答归一：title 缺失回落文件名', () => {
  const docs = normalizeUploadedDocs({ documents: [{ location: 'custom-documents/b.json' }] }, '剧本.md')
  assert.equal(docs[0].title, '剧本.md')
})

await check('文档标识校验：拒绝绝对路径与穿越', () => {
  assert.deepEqual(assertDocLocations(['custom-documents/a.json']), ['custom-documents/a.json'])
  assert.throws(() => assertDocLocations(['/etc/passwd']), /不合法/)
  assert.throws(() => assertDocLocations(['../../a.json']), /不合法/)
  assert.throws(() => assertDocLocations(['http://evil/a.json']), /不合法/)
  assert.throws(() => assertDocLocations([]), /没有指定/)
})

await check('SSE 帧解析：JSON 与非 JSON', () => {
  assert.deepEqual(parseSseDataLine('data: {"type":"textResponse","textResponse":"hi"}'), {
    type: 'textResponse',
    textResponse: 'hi',
  })
  assert.equal(parseSseDataLine('data: [DONE]'), null)
  assert.equal(parseSseDataLine('event: ping'), null)
  assert.equal(parseSseDataLine('data: 不是json'), null)
})

await check('stripReasoning：剥掉成对推理块', () => {
  assert.equal(stripReasoning('<think>内部推理</think>雨夜巷口'), '雨夜巷口')
  assert.equal(stripReasoning('前<think>x</think>后'), '前后')
  assert.equal(stripReasoning('<think>a</think><think>b</think>正文'), '正文')
  assert.equal(stripReasoning('没有推理块的正常回答'), '没有推理块的正常回答')
})

await check('stripReasoning：未闭合时整段丢弃（流式截断）', () => {
  assert.equal(stripReasoning('正文<think>截断的推理没有闭合'), '正文')
  assert.equal(stripReasoning('<think>全是推理没闭合'), '')
})

await check('stripReasoning：thinking 变体也认', () => {
  assert.equal(stripReasoning('<thinking>x</thinking>答案'), '答案')
})

await check('stripChunkMetadata：剥掉上游元数据头', () => {
  const raw = '<document_metadata>\nsourceDocument: a.md\npublished: x\n</document_metadata>\n\n正文内容'
  assert.equal(stripChunkMetadata(raw), '正文内容')
  assert.equal(stripChunkMetadata('没有元数据的片段'), '没有元数据的片段')
  assert.equal(stripChunkMetadata(''), '')
})

await check('stripChunkMetadata：真实上游片段形状', () => {
  const raw = '<document_metadata>\nsourceDocument: kb-verify-world.md\npublished: 11/25/2026\n</document_metadata>\n\n猎魔人 世界观设定\n主角：沈砚'
  const out = stripChunkMetadata(raw)
  assert.equal(out.startsWith('<document_metadata>'), false)
  assert.match(out, /猎魔人 世界观设定/)
})

await check('默认地址常量', () => {
  assert.equal(DEFAULT_KB_BASE_URL, 'http://127.0.0.1:3001')
})

// ---------------------------------------------------------------- 设置层

await check('设置归一：地址为空即关闭', () => {
  assert.equal(normalizeKbSettings({}).enabled, false)
  assert.equal(normalizeKbSettings({ baseUrl: '', apiKey: 'k' }).enabled, false)
  assert.equal(normalizeKbSettings({ baseUrl: 'http://127.0.0.1:3001' }).enabled, true)
})

await check('设置归一：非法地址不算配置', () => {
  assert.equal(normalizeKbSettings({ baseUrl: 'not-a-url' }).enabled, false)
  assert.equal(normalizeKbSettings({ baseUrl: 'ftp://x' }).enabled, false)
})

await check('设置归一：地址去尾斜杠', () => {
  assert.equal(normalizeKbSettings({ baseUrl: 'http://127.0.0.1:3001///' }).baseUrl, 'http://127.0.0.1:3001')
})

await check('环境兜底：设置库优先', () => {
  const r = applyKbEnvDefaults(
    { baseUrl: 'http://127.0.0.1:3001', apiKey: 'from-db' },
    { [KB_ENV_BASE_URL]: 'http://other:3001', [KB_ENV_API_KEY]: 'from-env' },
  )
  assert.equal(r.settings.baseUrl, 'http://127.0.0.1:3001')
  assert.equal(r.settings.apiKey, 'from-db')
  assert.deepEqual(r.fromEnv, { baseUrl: false, apiKey: false })
  assert.equal(r.settings.enabled, true)
})

await check('环境兜底：半配置（地址在库、Key 在 env）', () => {
  const r = applyKbEnvDefaults(
    { baseUrl: 'http://127.0.0.1:3001' },
    { [KB_ENV_API_KEY]: 'from-env' },
  )
  assert.equal(r.settings.apiKey, 'from-env')
  assert.deepEqual(r.fromEnv, { baseUrl: false, apiKey: true })
})

await check('环境兜底：都没有时保持未配置', () => {
  const r = applyKbEnvDefaults({}, {})
  assert.equal(r.settings.enabled, false)
  assert.equal(r.settings.baseUrl, '')
  assert.deepEqual(r.fromEnv, { baseUrl: false, apiKey: false })
})

await check('脱敏：Key 只回有没有', () => {
  const view = redactKbSettings({ baseUrl: 'http://127.0.0.1:3001', apiKey: 'secret-123' }, {})
  assert.equal(view.hasApiKey, true)
  assert.equal(JSON.stringify(view).includes('secret-123'), false)
  assert.equal(view.baseUrl, 'http://127.0.0.1:3001')
  assert.equal(view.enabled, true)
})

await check('脱敏：环境变量来源可辨识', () => {
  const view = redactKbSettings({}, { [KB_ENV_BASE_URL]: 'http://kb:3001', [KB_ENV_API_KEY]: 'x' })
  assert.equal(view.hasApiKey, true)
  assert.deepEqual(view.compact, { baseUrlFromEnv: true, apiKeyFromEnv: true })
})

await check('保存合并：脱敏空 Key 不清掉旧 Key', () => {
  const cur = { baseUrl: 'http://127.0.0.1:3001', apiKey: 'old' }
  const next = mergeKbSettings(cur, { baseUrl: 'http://127.0.0.1:3001', apiKey: '' })
  assert.equal(next.apiKey, 'old')
})

await check('保存合并：新 Key 覆盖旧 Key', () => {
  const next = mergeKbSettings({ baseUrl: 'http://a:3001', apiKey: 'old' }, { apiKey: 'new' })
  assert.equal(next.apiKey, 'new')
  assert.equal(next.baseUrl, 'http://a:3001')
})

await check('保存合并：显式清空 Key', () => {
  const next = mergeKbSettings({ baseUrl: 'http://a:3001', apiKey: 'old' }, { clearApiKey: true })
  assert.equal(next.apiKey, '')
})

await check('保存合并：清空地址即整体关闭', () => {
  const next = mergeKbSettings({ baseUrl: 'http://a:3001', apiKey: 'k' }, { baseUrl: '' })
  assert.equal(next.enabled, false)
  assert.equal(next.baseUrl, '')
})

await check('保存合并：patch 缺省时保留原值', () => {
  const cur = { baseUrl: 'http://a:3001', apiKey: 'k' }
  const next = mergeKbSettings(cur, undefined)
  assert.equal(next.baseUrl, 'http://a:3001')
  assert.equal(next.apiKey, 'k')
})

// ---------------------------------------------------------------- mock 上游

/**
 * 假 AnythingLLM。
 *
 * 只实现本应用真正会调的那几个端点，并按上游真实形状回包
 * （包括 `GET /v1/workspace/:slug` 返回数组这个坑）。
 */
function startMockAnythingLLM() {
  const state = {
    workspaces: new Map(), // slug -> { id, name, slug, documents: [] }
    nextId: 1,
    /** 记录收到过的请求，供断言 */
    calls: [],
    /** 让下一次上传失败（模拟 collector 离线） */
    failNextUpload: '',
    /** 让所有请求失败（模拟服务不可用） */
    offline: false,
    chats: [],
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // 真实上游在 /api/v1/*；mock 两种前缀都接受，避免测试与生产路径脱节
    const path = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    const auth = String(req.headers.authorization || '')
    state.calls.push({ method: req.method, path, auth: Boolean(auth) })

    if (state.offline) {
      req.socket.destroy()
      return
    }

    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const badKey = auth !== 'Bearer test-key'

    if (path === '/v1/auth') {
      if (badKey) return send(403, { error: 'No valid api key found.' })
      return send(200, { authenticated: true })
    }
    if (badKey) return send(403, { error: 'No valid api key found.' })

    const body = []
    req.on('data', (c) => body.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(body)
      const asJson = () => {
        try {
          return JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          return {}
        }
      }

      // 建库
      if (path === '/v1/workspace/new' && req.method === 'POST') {
        const { name } = asJson()
        const dup = [...state.workspaces.values()].find((w) => w.name === name)
        if (dup) return send(400, { workspace: null, message: 'Workspace name must be unique' })
        // 模拟上游归一化：中文项目名 → 无意义 slug，故意不可逆推
        const slug = `ws-${state.nextId++}`
        const ws = { id: state.nextId, name, slug, documents: [] }
        state.workspaces.set(slug, ws)
        return send(200, { workspace: ws, message: 'Workspace created' })
      }

      // 列表
      if (path === '/v1/workspaces' && req.method === 'GET') {
        return send(200, { workspaces: [...state.workspaces.values()] })
      }

      const wsMatch = path.match(/^\/v1\/workspace\/([^/]+)$/)
      if (wsMatch) {
        const slug = decodeURIComponent(wsMatch[1])
        const ws = state.workspaces.get(slug)
        if (req.method === 'DELETE') {
          if (!ws) return send(400, {})
          state.workspaces.delete(slug)
          return send(200, { message: 'Workspace deleted' })
        }
        if (!ws) return send(200, { workspace: [] })
        // 上游真实形状：数组
        return send(200, { workspace: [{ ...ws }] })
      }

      // 上传
      if (path === '/v1/document/upload' && req.method === 'POST') {
        if (state.failNextUpload) {
          const msg = state.failNextUpload
          state.failNextUpload = ''
          return send(500, { success: false, error: msg, documents: [] })
        }
        const text = raw.toString('latin1')
        const addTo = /name="addToWorkspaces"\r\n\r\n([^\r]+)/.exec(text)?.[1] || ''
        // multipart 里的文件名是 UTF-8 字节，用 latin1 取出后必须再按 UTF-8 解码，
        // 否则中文文件名会变成乱码（这是 mock 的解析细节，不是客户端行为）
        const rawName = /filename="([^"]+)"/.exec(text)?.[1] || 'upload.bin'
        const filename = Buffer.from(rawName, 'latin1').toString('utf8')
        const ws = state.workspaces.get(addTo.trim())
        if (!ws) return send(400, { success: false, error: 'workspace not found', documents: [] })
        const location = `custom-documents/${encodeURIComponent(filename)}-${state.nextId++}.json`
        const doc = { location, title: filename, wordCount: 42 }
        ws.documents.push(doc)
        return send(200, { success: true, error: null, documents: [doc] })
      }

      // 移出
      const embMatch = path.match(/^\/v1\/workspace\/([^/]+)\/update-embeddings$/)
      if (embMatch && req.method === 'POST') {
        const ws = state.workspaces.get(decodeURIComponent(embMatch[1]))
        if (!ws) return send(400, {})
        const { deletes = [] } = asJson()
        ws.documents = ws.documents.filter((d) => !deletes.includes(d.location))
        return send(200, { workspace: ws, message: null })
      }

      // 彻底删
      if (path === '/v1/system/remove-documents' && req.method === 'POST') {
        const { names = [] } = asJson()
        for (const ws of state.workspaces.values()) {
          ws.documents = ws.documents.filter((d) => !names.includes(d.location))
        }
        return send(200, { success: true, message: 'Documents removed successfully' })
      }

      // 检索
      const searchMatch = path.match(/^\/v1\/workspace\/([^/]+)\/vector-search$/)
      if (searchMatch && req.method === 'POST') {
        const ws = state.workspaces.get(decodeURIComponent(searchMatch[1]))
        if (!ws) return send(400, { message: 'not a valid workspace' })
        const { query, topN = 4 } = asJson()
        if (!String(query || '').trim()) return send(400, { message: 'Query parameter cannot be empty.' })
        if (!ws.documents.length) return send(200, { results: [], message: 'No embeddings found for this workspace.' })
        const results = ws.documents.slice(0, topN).map((d, i) => ({
          id: `v-${i}`,
          text: `${d.title} 的片段：关于「${query}」`,
          metadata: { title: d.title, url: `file://${d.location}`, chunkSource: d.title },
          distance: 0.2,
          score: 0.8 - i * 0.1,
        }))
        return send(200, { results })
      }

      // 历史
      const chatsMatch = path.match(/^\/v1\/workspace\/([^/]+)\/chats$/)
      if (chatsMatch && req.method === 'GET') {
        const sessionId = url.searchParams.get('apiSessionId') || ''
        const history = state.chats
          .filter((c) => !sessionId || c.sessionId === sessionId)
          .map((c) => ({ role: c.role, content: c.content, sentAt: c.sentAt, sources: c.sources }))
        return send(200, { history })
      }

      // 流式问答
      const streamMatch = path.match(/^\/v1\/workspace\/([^/]+)\/stream-chat$/)
      if (streamMatch && req.method === 'POST') {
        const ws = state.workspaces.get(decodeURIComponent(streamMatch[1]))
        if (!ws) return send(400, {})
        const payload = asJson()
        const sessionId = String(payload.sessionId || '')
        if (payload.reset) {
          state.chats = []
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          res.end(`data: ${JSON.stringify({ id: 'x', type: 'textResponse', textResponse: '', sources: [], close: true })}\n\n`)
          return
        }
        const hasDocs = ws.documents.length > 0
        const sources = hasDocs
          ? [{ title: ws.documents[0].title, chunk: `${ws.documents[0].title} 的命中片段` }]
          : []
        state.chats.push({ sessionId, role: 'user', content: String(payload.message || ''), sentAt: 1, sources: [] })
        state.chats.push({
          sessionId,
          role: 'assistant',
          content: hasDocs ? '根据资料回答' : '库里没有相关内容',
          sentAt: 2,
          sources,
        })
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        res.write(`data: ${JSON.stringify({ id: 'x', type: 'textResponse', textResponse: '根据' })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'x', type: 'textResponse', textResponse: '资料回答' })}\n\n`)
        res.end(
          `data: ${JSON.stringify({ id: 'x', type: 'textResponse', textResponse: '', sources, close: true })}\n\n`,
        )
        return
      }

      // update-env（代配 LLM）
      if (path === '/v1/system/update-env' && req.method === 'POST') {
        const body = asJson()
        // 真实上游只认 camelCase 键；下划线形式会被静默过滤，error 仍是 false
        const known = [
          'LLMProvider',
          'GenericOpenAiBasePath',
          'GenericOpenAiModelPref',
          'GenericOpenAiKey',
          'GenericOpenAiTokenLimit',
        ]
        const newValues = {}
        for (const k of Object.keys(body)) if (known.includes(k)) newValues[k] = body[k]
        state.lastEnvUpdate = body
        return send(200, { newValues, error: false })
      }

      // 可接受类型
      if (path === '/v1/document/accepted-file-types') {
        return send(200, {
          types: { 'application/pdf': ['.pdf'], 'text/plain': ['.txt', '.md'], 'application/msword': ['.doc'] },
        })
      }

      // 单文档
      const docMatch = path.match(/^\/v1\/document\/(.+)$/)
      if (docMatch) {
        const name = decodeURIComponent(docMatch[1])
        for (const ws of state.workspaces.values()) {
          const doc = ws.documents.find((d) => d.location === name || d.title === name)
          if (doc) return send(200, { document: { ...doc, pageContent: `${doc.title} 的全文` } })
        }
        return send(404, {})
      }

      return send(404, { error: 'not implemented in mock: ' + path })
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        state,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

/** 用临时库验映射表读写 */
function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-db-'))
  const db = openDatabase(dir)
  return { db, dir }
}

// ---------------------------------------------------------------- 客户端

const mock = await startMockAnythingLLM()
const settings = { baseUrl: mock.baseUrl, apiKey: 'test-key', enabled: true }
const client = createKnowledgeClient({
  getSettings: () => settings,
  getExternalFetch: () => null,
  timeoutMs: 5000,
})

await check('客户端：连接自检', async () => {
  const r = await client.test()
  assert.equal(r.ok, true)
  assert.equal(r.authenticated, true)
  assert.equal(r.workspaceCount, 0)
})

await check('客户端：建库并回读上游 slug（中文项目名不可逆推）', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('猎魔人', db)
  assert.match(slug, /^ws-\d+$/, '应当用上游返回的标识，而不是项目名')
  assert.notEqual(slug, '猎魔人')
  // 第二次直接命中映射，不再建库
  const before = mock.state.calls.filter((c) => c.path === '/v1/workspace/new').length
  const again = await client.ensureWorkspace('猎魔人', db)
  const after = mock.state.calls.filter((c) => c.path === '/v1/workspace/new').length
  assert.equal(again, slug)
  assert.equal(after, before, '已有映射时不应再次建库')
  db.close()
})

await check('客户端：映射丢失时按 name 找回，不堆重复库', async () => {
  const fresh = openTempDb()
  const slug = await client.ensureWorkspace('猎魔人', fresh.db)
  assert.match(slug, /^ws-\d+$/)
  const count = mock.state.workspaces.size
  assert.equal(count, 1, '同名项目不应创建第二个库')
  fresh.db.close()
})

await check('客户端：上传文档挂到当前库', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('上传测试', db)
  const docs = await client.uploadDoc({
    slug,
    filename: '世界观.md',
    bytes: Buffer.from('# 世界观'),
    mime: 'text/markdown',
  })
  assert.equal(docs.length, 1)
  assert.equal(docs[0].title, '世界观.md')
  const detail = await client.listDocs(slug)
  assert.equal(detail.docCount, 1)
  assert.equal(detail.documents[0].location, docs[0].location)
  db.close()
})

await check('客户端：上传失败报文透出 collector 原因', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('失败测试', db)
  mock.state.failNextUpload = 'Document processing API is not online.'
  await assert.rejects(
    () => client.uploadDoc({ slug, filename: 'a.pdf', bytes: Buffer.from('x'), mime: 'application/pdf' }),
    (e) => /collector|processing api/i.test(String(e.upstreamMessage || e.message)),
  )
  // 失败不产生半成品
  const detail = await client.listDocs(slug)
  assert.equal(detail.docCount, 0)
  db.close()
})

await check('客户端：列表兼容上游 workspace 是数组的形状', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('数组形状', db)
  const detail = await client.listDocs(slug)
  assert.equal(detail.slug, slug)
  assert.equal(Array.isArray(detail.documents), true)
  db.close()
})

await check('客户端：移出本库只解绑', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('移出测试', db)
  const docs = await client.uploadDoc({ slug, filename: 'b.md', bytes: Buffer.from('x') })
  const removed = await client.removeDocs(slug, [docs[0].location])
  assert.equal(removed.removed, 1)
  const detail = await client.listDocs(slug)
  assert.equal(detail.docCount, 0)
  db.close()
})

await check('客户端：检索不经 LLM，返回带 score 的片段', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('检索测试', db)
  await client.uploadDoc({ slug, filename: '运镜手册.md', bytes: Buffer.from('推拉摇移') })
  const hits = await client.search(slug, '推镜')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].title, '运镜手册.md')
  assert.equal(typeof hits[0].score, 'number')
  assert.match(hits[0].text, /推镜/)
  db.close()
})

await check('客户端：空库检索返回空数组', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('空库', db)
  const hits = await client.search(slug, '任何')
  assert.deepEqual(hits, [])
  db.close()
})

await check('客户端：检索空关键词被本地拒绝', async () => {
  await assert.rejects(() => client.search('ws-1', '   '), /不能为空/)
})

await check('客户端：问答流透传，来源被归一', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('问答测试', db)
  await client.uploadDoc({ slug, filename: '设定.md', bytes: Buffer.from('主角是猎人') })
  const res = await client.chatStream({ slug, message: '主角是谁' })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.match(text, /data: /)
  const frames = text
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => JSON.parse(f.slice(5)))
  const answer = frames.map((f) => f.textResponse || '').join('')
  assert.equal(answer, '根据资料回答')
  const last = frames[frames.length - 1]
  assert.equal(last.close, true)
  assert.equal(last.sources.length, 1)
  assert.equal(last.sources[0].title, '设定.md')
  db.close()
})

await check('客户端：历史按会话分区回读', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('历史测试', db)
  await client.uploadDoc({ slug, filename: 'h.md', bytes: Buffer.from('内容') })
  await client.chatStream({ slug, message: '第一问' }).then((r) => r.text())
  const hist = await client.history(slug)
  assert.equal(hist.length, 2)
  assert.equal(hist[0].role, 'user')
  assert.equal(hist[0].content, '第一问')
  assert.equal(hist[1].role, 'assistant')
  assert.equal(hist[1].sources[0].title, 'h.md')
  db.close()
})

await check('客户端：可接受类型来自上游', async () => {
  const t = await client.acceptedTypes()
  assert.deepEqual(t.extensions, ['.doc', '.md', '.pdf', '.txt'])
})

await check('客户端：读单文档取正文', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('读文档', db)
  const docs = await client.uploadDoc({ slug, filename: '全文.md', bytes: Buffer.from('x') })
  const doc = await client.readDoc(docs[0].location)
  assert.equal(doc.title, '全文.md')
  assert.match(doc.text, /全文/)
  db.close()
})

await check('客户端：删库', async () => {
  const { db } = openTempDb()
  const slug = await client.ensureWorkspace('删库测试', db)
  const r = await client.deleteWorkspace(slug)
  assert.equal(r.deleted, true)
  // 再删一次当成功（不存在）
  const again = await client.deleteWorkspace(slug)
  assert.equal(again.deleted, false)
  db.close()
})

await check('客户端：未配置时所有调用给出可读错误', async () => {
  const off = createKnowledgeClient({
    getSettings: () => ({ baseUrl: '', apiKey: '', enabled: false }),
  })
  await assert.rejects(() => off.test(), /尚未配置/)
})

await check('客户端：Key 错误被翻译成可读原因', async () => {
  const wrong = createKnowledgeClient({
    getSettings: () => ({ baseUrl: mock.baseUrl, apiKey: 'bad-key', enabled: true }),
    timeoutMs: 3000,
  })
  await assert.rejects(
    () => wrong.test(),
    (e) => {
      assert.equal(e.status, 403)
      assert.match(translateKbError(e), /API Key 无效/)
      return true
    },
  )
})

await check('客户端：服务不可用时走候选并最终报连不上', async () => {
  const down = createKnowledgeClient({
    getSettings: () => ({ baseUrl: 'http://host.docker.internal:59999', apiKey: 'k', enabled: true }),
    timeoutMs: 1500,
  })
  await assert.rejects(
    () => down.test(),
    (e) => {
      assert.match(translateKbError(e), /连不上知识库服务/)
      return true
    },
  )
})

await check('客户端：请求都带 Bearer 头', () => {
  const authed = mock.state.calls.filter((c) => c.path !== '/v1/system/remove-documents')
  assert.ok(authed.length > 0)
  assert.ok(authed.every((c) => c.auth === true), '所有请求都应带 Authorization')
})

await check('映射表：脏 slug 不拿去请求上游', () => {
  const { db } = openTempDb()
  db.prepare('INSERT INTO knowledge_links (project_name, workspace_slug) VALUES (?,?)').run('脏项目', '../etc')
  assert.equal(readKbLink(db, '脏项目'), '')
  db.close()
})

await check('映射表：写入校验 slug', () => {
  const { db } = openTempDb()
  assert.throws(() => writeKbLink(db, 'p', '中文 slug'), /不合法/)
  assert.equal(writeKbLink(db, 'p', 'good-slug'), 'good-slug')
  assert.equal(deleteKbLink(db, 'p'), 1)
  assert.equal(readKbLink(db, 'p'), '')
  db.close()
})

// ---------------------------------------------------------------- 代配上游 LLM

await check('applyLlmConfig：camelCase 键名被上游接受', async () => {
  const r = await client.applyLlmConfig({
    basePath: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3.1-Flash',
    apiKey: 'sk-test-key',
    tokenLimit: 245760,
  })
  assert.equal(r.ok, true)
  assert.equal(r.written.length, 5)
  assert.ok(r.written.includes('LLMProvider'))
  const sent = mock.state.lastEnvUpdate
  assert.equal(sent.LLMProvider, 'generic-openai')
  assert.equal(sent.GenericOpenAiModelPref, 'MiniMax-M3.1-Flash')
  assert.equal(sent.GenericOpenAiBasePath, 'https://api.minimaxi.com/v1')
})

await check('applyLlmConfig：下划线键名会被上游静默丢弃（repro 真实坑）', async () => {
  // 直接打 mock，模拟「用了环境变量名」的错误写法：写入 0 项
  const res = await fetch(`${mock.baseUrl}/api/v1/system/update-env`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ LLM_PROVIDER: 'generic-openai' }),
  })
  const j = await res.json()
  assert.deepEqual(Object.keys(j.newValues), [], '下划线键名不该被接受')
  assert.equal(j.error, false, '上游仍报 error:false —— 这正是它难查的原因')
})

await check('applyLlmConfig：缺字段时明确拒绝，不发请求', async () => {
  const r = await client.applyLlmConfig({ basePath: '', model: 'm', apiKey: 'k' })
  assert.equal(r.ok, false)
  assert.match(r.error, /缺少/)
})

await mock.close()

if (bad) {
  console.error(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n知识库纯函数验收全部通过')
