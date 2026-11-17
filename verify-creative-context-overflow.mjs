/**
 * 上下文超限：服务端给 error 事件打 kind=context-overflow，前端换成可操作说明；
 * 非上下文类错误保持原有呈现。
 * 跑法：node verify-creative-context-overflow.mjs
 */
import { spawn } from 'node:child_process'
import { build } from 'esbuild'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5350
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-overflow-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const HINT = '本次会话上下文已满，建议新建会话（历史仍保留在侧栏）。'

// ---- mock 上游：可切换「上下文超限」与「普通 500」 ----
let upstreamMode = 'overflow'
const upstream = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (upstreamMode === 'overflow') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: {
            message:
              "This model's maximum context length is 8192 tokens. However, your messages resulted in 9500 tokens.",
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
          },
        }),
      )
      return
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('internal upstream failure')
  })
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const upstreamPort = upstream.address().port

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 独立数据目录：不碰真实 projects/
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}

let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  upstream.close()
  console.error('dev server 启动失败')
  process.exit(1)
}

const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'ovf-probe'),
  {
    id: 'ovf-probe',
    label: 'OvfProbe',
    kind: 'openai',
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    caps: ['text'],
    apiKey: 'probe',
  },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'ovf-model'),
  { key: 'ovf-model', label: 'Ovf Model', cap: 'text', provider: 'ovf-probe', model: 'ovf-model' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'ovf-model' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

/** 发一轮流式请求，取出 error 事件 */
const streamError = async () => {
  const res = await fetch(`${APP}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'ovf-model',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
    }),
  })
  const raw = await res.text()
  const events = raw
    .split('\n\n')
    .map((chunk) => chunk.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return JSON.parse(s)
      } catch {
        return { type: 'parse-error', raw: s }
      }
    })
  return events.find((e) => e.type === 'error') || null
}

console.log('\n=== 服务端：上下文超限 ===')
const overflowEvent = await streamError()
check('error 事件带 kind=context-overflow', overflowEvent?.kind === 'context-overflow', JSON.stringify(overflowEvent))
check(
  '服务端仍带可操作说明（客户端按 kind 自救，文案只作兜底）',
  String(overflowEvent?.message || '').includes('建议新建会话'),
  String(overflowEvent?.message || ''),
)

console.log('\n=== 服务端：普通 500 不被改写 ===')
upstreamMode = 'boom'
const boomEvent = await streamError()
check('普通 500 不带 context-overflow', boomEvent?.kind === undefined, JSON.stringify(boomEvent))
check('普通 500 保留渠道 + 状态', /OvfProbe 500/.test(String(boomEvent?.message || '')), String(boomEvent?.message || ''))
check('普通 500 保留报文片段', String(boomEvent?.message || '').includes('internal upstream failure'))
upstreamMode = 'overflow'

// ---- 前端：按 kind 换成中文说明 ----
console.log('\n=== 前端：callTextStream 映射 ===')
const entry = path.join(TMP, 'api-entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(ROOT, 'src/api.ts'))}\n`)
const out = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
})
const client = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
const stub = (text) => {
  globalThis.fetch = async () =>
    new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

stub(sse([{ type: 'meta', model: 'm' }, { type: 'error', kind: 'context-overflow', message: 'upstream 400: context length' }]))
let clientOverflow = null
try {
  await client.callTextStream({ modelKey: 'ovf-model', messages: [{ role: 'user', content: 'hi' }] })
} catch (e) {
  clientOverflow = e
}
check('前端把超限换成中文说明', clientOverflow?.message === HINT, String(clientOverflow?.message || ''))
check('前端保留 kind', clientOverflow?.kind === 'context-overflow')
check('前端保留原始报文供排查', String(clientOverflow?.detail || '').includes('context length'))

stub(sse([{ type: 'error', message: 'OvfProbe 500: internal upstream failure' }]))
let clientPlain = null
try {
  await client.callTextStream({ modelKey: 'ovf-model', messages: [{ role: 'user', content: 'hi' }] })
} catch (e) {
  clientPlain = e
}
check('普通错误原样抛出', clientPlain?.message === 'OvfProbe 500: internal upstream failure', String(clientPlain?.message || ''))
check('普通错误没有 kind', !clientPlain?.kind)

// ---- 运行时：首次超限自动压缩重跑一次 ----
console.log('\n=== 运行时：压缩重试 ===')
const runnerEntry = path.join(TMP, 'runner-entry.ts')
fs.writeFileSync(runnerEntry, `export * from ${JSON.stringify(path.join(ROOT, 'src/agent/pi/stageRunner.ts'))}\n`)
const runnerOut = await build({
  entryPoints: [runnerEntry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'error',
})
const runner = await import(
  'data:text/javascript;base64,' + Buffer.from(runnerOut.outputFiles[0].text).toString('base64')
)

const overflowError = () => {
  const e = new Error('本次会话上下文已满，建议新建会话（历史仍保留在侧栏）。')
  e.kind = 'context-overflow'
  return e
}

// 两条都失败：提示必须说明已尝试压缩，而不是只说「新建会话」
{
  const events = []
  const seen = []
  let calls = 0
  const result = await runner.runStageAgent({
    userText: '继续',
    system: 'sys',
    tools: [],
    stage: 'creative',
    priorMessages: [{ role: 'user', content: '历史' }],
    ask: async (o) => {
      calls += 1
      seen.push((o.messages || []).length)
      throw overflowError()
    },
    onEvent: (e) => events.push(e),
  })
  const compaction = events.filter((e) => e.type === 'custom' && e.name === 'context_compaction')
  check('超限后只重试一次', calls === 2, `ask 调用 ${calls} 次`)
  check('重试使用压缩后的投影', seen[1] <= seen[0], JSON.stringify(seen))
  check('压缩提示可见', compaction.some((e) => e.value?.reason === 'context-overflow'), JSON.stringify(compaction))
  check('两次都失败时说明已压缩重试', /已用压缩历史重试一次仍失败/.test(String(result.error || '')), String(result.error || ''))
}

// 首次超限、第二次成功：本轮应正常完成，且不重复正文
{
  const events = []
  let calls = 0
  const result = await runner.runStageAgent({
    userText: '继续',
    system: 'sys',
    tools: [],
    stage: 'creative',
    priorMessages: [{ role: 'user', content: '历史' }],
    ask: async (o) => {
      calls += 1
      if (calls === 1) throw overflowError()
      o.onTextDelta?.('压缩后继续写')
      return { text: '压缩后继续写', finishReason: 'stop' }
    },
    onEvent: (e) => events.push(e),
  })
  const text = events
    .filter((e) => e.type === 'text_message_content')
    .map((e) => e.delta)
    .join('')
  check('压缩重试后本轮完成', !result.error && calls === 2, JSON.stringify({ error: result.error, calls }))
  check('重试后正文不重复', text === '压缩后继续写', text)
  check('压缩事件先于重试', events.some((e) => e.type === 'custom' && e.name === 'context_compaction'))
}

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
child.kill()
upstream.close()
process.exit(bad ? 1 : 0)
