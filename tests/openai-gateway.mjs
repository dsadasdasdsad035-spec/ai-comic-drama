/**
 * OpenAI 门面（`/v1/chat/completions`）的翻译测试。
 *
 * 用一个**按应用 SSE 协议作答**的假上游替掉 `/api/text`，这样能精确断言：
 * - 文本增量 → `delta.content`；
 * - 工具调用增量 → `delta.tool_calls[].function.arguments` 分片；
 * - 渠道不支持流式工具增量时，收尾整段补一次（否则宿主永远收不到工具调用）；
 * - 模型标识无法还原成应用模型键时给 OpenAI 形状的错误；
 * - 上游报错时透传可读中文原因。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createOpenAIGateway, resolveModelId } from '../server/openai-gateway.mjs'

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

const MODELS = [
  { id: 'sb/main', key: 'main', label: '主力', vision: false },
  { id: 'sb/vision', key: 'vision', label: '视觉', vision: true },
]

await check('模型标识还原', () => {
  assert.deepEqual(resolveModelId('sb/main', MODELS), { modelKey: 'main', id: 'sb/main' })
  assert.deepEqual(resolveModelId('vision', MODELS), { modelKey: 'vision', id: 'sb/vision' })
  assert.equal(resolveModelId('pro', MODELS).tier, 'pro')
  assert.match(resolveModelId('sb/nope', MODELS).error, /可用：sb\/main, sb\/vision/)
  assert.match(resolveModelId('gpt-4', MODELS).error, /模型标识/)
})

// ---------------------------------------------------------------- 假上游

function startFakeText() {
  return new Promise((resolve) => {
    const state = { toolStreaming: true, lastBody: null, lastCookie: '', failWith: null, aborted: false }
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        state.lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        state.lastCookie = String(req.headers.cookie || '')
        if (state.failWith) {
          res.writeHead(state.failWith.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(state.failWith.body))
          return
        }
        const slow = JSON.stringify(state.lastBody.messages || []).includes('slow')
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' })
        const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`)
        send({ type: 'meta', model: 'doubao', modelKey: 'main' })
        send({ type: 'text_delta', delta: '你好' })
        if (slow) {
          // 一直不结束：用于验证客户端取消后上游请求被终止
          res.on('close', () => {
            state.aborted = true
          })
          return
        }
        if (state.toolStreaming) {
          send({ type: 'tool_call_delta', index: 0, id: 'call_1', name: 'create_storyboard', delta: '{"episode"' })
          send({ type: 'tool_call_delta', index: 0, delta: ':1}' })
        }
        send({
          type: 'done',
          text: '你好',
          toolCalls: [{ id: 'call_1', name: 'create_storyboard', arguments: '{"episode":1}' }],
          finishReason: 'tool_calls',
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        })
        res.end()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

const upstream = await startFakeText()
// 创意环节的输出上限：设置页改完立即生效，所以按请求读取
let creativeMaxTokens
const gateway = createOpenAIGateway({
  baseUrl: upstream.base,
  getModels: () => MODELS,
  getCreativeMaxTokens: () => creativeMaxTokens,
  getSessionToken: () => '',
  log: () => {},
})

const server = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    gateway.handle(req, res).catch((e) => {
      res.statusCode = 500
      res.end(String(e))
    })
  })
  s.listen(0, '127.0.0.1', () => resolve(s))
})
const base = `http://127.0.0.1:${server.address().port}`

function sseOf(text) {
  return text
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => frame.slice(5).trim())
}

await check('/v1/models 列出应用模型', async () => {
  const res = await fetch(`${base}/v1/models`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.object, 'list')
  assert.deepEqual(body.data.map((m) => m.id), ['sb/main', 'sb/vision'])
})

await check('流式：文本与工具调用增量都被翻译', async () => {
  upstream.state.toolStreaming = true
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sb/main',
      messages: [{ role: 'user', content: '画一个分镜' }],
      tools: [{ type: 'function', function: { name: 'create_storyboard', parameters: { type: 'object' } } }],
      stream: true,
    }),
  })
  assert.equal(res.status, 200)
  assert.match(String(res.headers.get('content-type')), /text\/event-stream/)
  const frames = sseOf(await res.text())
  assert.equal(frames[frames.length - 1], '[DONE]')
  const chunks = frames.slice(0, -1).map((f) => JSON.parse(f))

  const content = chunks.map((c) => c.choices?.[0]?.delta?.content || '').join('')
  assert.equal(content, '你好')

  const args = chunks
    .flatMap((c) => c.choices?.[0]?.delta?.tool_calls || [])
    .map((t) => t.function?.arguments || '')
    .join('')
  assert.equal(args, '{"episode":1}')
  const toolIds = chunks
    .flatMap((c) => c.choices?.[0]?.delta?.tool_calls || [])
    .map((t) => t.id)
    .filter(Boolean)
  assert.ok(toolIds.includes('call_1'))

  const last = chunks[chunks.length - 1]
  assert.equal(last.choices[0].finish_reason, 'tool_calls')

  // 请求被翻译成应用契约：模型键、工具、流式
  assert.equal(upstream.state.lastBody.modelKey, 'main')
  assert.equal(upstream.state.lastBody.stream, true)
  assert.equal(upstream.state.lastBody.tools.length, 1)
})

await check('流式：渠道不分片时收尾整段补工具调用', async () => {
  upstream.state.toolStreaming = false
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'x' }], stream: true }),
  })
  const chunks = sseOf(await res.text())
    .slice(0, -1)
    .map((f) => JSON.parse(f))
  const toolDeltas = chunks.flatMap((c) => c.choices?.[0]?.delta?.tool_calls || [])
  assert.equal(toolDeltas.length, 1)
  assert.equal(toolDeltas[0].function.name, 'create_storyboard')
  assert.equal(toolDeltas[0].function.arguments, '{"episode":1}')
})

await check('非流式：拼成完整 message + tool_calls', async () => {
  upstream.state.toolStreaming = true
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'x' }], stream: false }),
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.object, 'chat.completion')
  const choice = body.choices[0]
  assert.equal(choice.message.content, '你好')
  assert.equal(choice.message.tool_calls[0].function.arguments, '{"episode":1}')
  assert.equal(choice.finish_reason, 'tool_calls')
})

await check('创意输出上限：有值透传，留空不带字段', async () => {
  const send = () =>
    fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'x' }], stream: true }),
    })

  creativeMaxTokens = 4096
  await (await send()).text()
  assert.equal(upstream.state.lastBody.maxTokens, 4096, '设置的上限没有透传给应用')

  creativeMaxTokens = undefined
  await (await send()).text()
  assert.ok(!('maxTokens' in upstream.state.lastBody), '留空时不应携带 maxTokens')
  creativeMaxTokens = undefined
})

await check('模型表为空：可读的未配置提示', async () => {
  const empty = createOpenAIGateway({
    baseUrl: upstream.base,
    getModels: () => [],
    getSessionToken: () => '',
    log: () => {},
  })
  const s = http.createServer((req, res) => {
    empty.handle(req, res).catch(() => res.end())
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sb/default', messages: [{ role: 'user', content: 'x' }] }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.equal(body.error.code, 'no_text_model')
    assert.match(body.error.message, /设置页/)
  } finally {
    s.close()
  }
})

await check('未知模型：OpenAI 形状的 404', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sb/nope', messages: [] }),
  })
  assert.equal(res.status, 404)
  const body = await res.json()
  assert.equal(body.error.code, 'model_not_found')
  assert.match(body.error.message, /没有对应的应用模型键/)
})

await check('上游失败：透传状态与可读原因', async () => {
  upstream.state.failWith = {
    status: 402,
    body: { ok: false, kind: 'insufficient-credits', message: '余额不足，请充值后重试' },
  }
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'x' }] }),
    })
    assert.equal(res.status, 402)
    const body = await res.json()
    assert.match(body.error.message, /余额不足/)
  } finally {
    upstream.state.failWith = null
  }
})

await check('非 POST 方法被拒绝', async () => {
  const res = await fetch(`${base}/v1/chat/completions`)
  assert.equal(res.status, 405)
})

await check('会话令牌随请求转给 /api/text（同一套账本路径）', async () => {
  const withSession = createOpenAIGateway({
    baseUrl: upstream.base,
    getModels: () => MODELS,
    getSessionToken: () => 'tok-abc',
    log: () => {},
  })
  const s = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      withSession.handle(req, res).catch(() => res.end())
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'x' }], stream: false }),
    })
    assert.equal(res.status, 200)
    assert.match(upstream.state.lastCookie, /sb_session=tok-abc/)
  } finally {
    s.close()
  }
})

await check('客户端取消：上游请求被终止', async () => {
  upstream.state.aborted = false
  const ctrl = new AbortController()
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sb/main', messages: [{ role: 'user', content: 'slow' }], stream: true }),
    signal: ctrl.signal,
  })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  await reader.read()
  ctrl.abort()
  // 给上游一个观察连接关闭的窗口
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(upstream.state.aborted, true, '取消后上游连接应被关闭')
})

server.close()
upstream.server.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ OpenAI 门面翻译全部通过')
process.exit(bad ? 1 : 0)
