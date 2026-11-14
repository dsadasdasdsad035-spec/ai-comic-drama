/**
 * /api/text 流式：正文增量必须逐块转发（不是攒完再给），
 * 且调用方没指定上限时不要替它编一个 max_tokens。
 *
 * 跑法：node verify-text-stream.mjs
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5361
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'text-stream-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---- mock 上游：分 4 次、每次间隔 120ms 吐一个字，最后 [DONE] ----
const upstreamBodies = []
const upstream = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    try {
      upstreamBodies.push(JSON.parse(body || '{}'))
    } catch {
      upstreamBodies.push({})
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const ch of ['你', '好', '世', '界']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 120))
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
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
  ...(settings.providers || []).filter((p) => p.id !== 'stream-probe'),
  {
    id: 'stream-probe',
    label: 'StreamProbe',
    kind: 'openai',
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    caps: ['text'],
    apiKey: 'probe',
  },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'stream-model'),
  { key: 'stream-model', label: 'Stream Model', cap: 'text', provider: 'stream-probe', model: 'stream-model' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'stream-model' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

/** 增量读取 SSE，记录每次读到的事件与它落在第几个网络块 */
const readStream = async (extraBody = {}) => {
  const res = await fetch(`${APP}/api/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelKey: 'stream-model',
      stream: true,
      messages: [{ role: 'user', content: '你好' }],
      ...extraBody,
    }),
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  let chunkIndex = 0
  const arrivals = []
  const typesOf = () =>
    raw
      .split('\n\n')
      .map((chunk) => chunk.replace(/^data:\s*/, '').trim())
      .filter(Boolean)
      .map((s) => {
        try {
          return String(JSON.parse(s).type || '')
        } catch {
          return ''
        }
      })
      .filter(Boolean)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunkIndex++
    raw += decoder.decode(value, { stream: true })
    // 记录「读到第 N 个网络块时已经能看到哪些事件」，用来判断是否边生成边下发。
    arrivals.push({ chunkIndex, types: typesOf() })
  }
  const events = raw
    .split('\n\n')
    .map((chunk) => chunk.replace(/^data:\s*/, '').trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return JSON.parse(s)
      } catch {
        return null
      }
    })
    .filter(Boolean)
  return { events, arrivals, chunks: chunkIndex, raw }
}

console.log('\n=== 正文增量逐块下发 ===')
const first = await readStream()
const deltas = first.events.filter((e) => e.type === 'text_delta').map((e) => String(e.delta || ''))
check('收到 ≥2 段 text_delta', deltas.length >= 2, JSON.stringify(deltas))
check('增量拼起来等于 done.text', deltas.join('') === String(first.events.find((e) => e.type === 'done')?.text || ''))
check('响应分了多个网络块（不是攒完再发）', first.chunks > 1, `chunks=${first.chunks}`)
const deltaChunk = first.arrivals.find((a) => a.types.includes('text_delta'))?.chunkIndex ?? -1
const doneChunk = first.arrivals.find((a) => a.types.includes('done'))?.chunkIndex ?? -1
check('text_delta 先于 done 到达', deltaChunk > 0 && doneChunk > deltaChunk, `delta@${deltaChunk} done@${doneChunk}`)

console.log('\n=== 上限：没指定就不发 ===')
const upstreamFirst = upstreamBodies.at(-1) || {}
check('上游请求体没有 max_tokens', !('max_tokens' in upstreamFirst), Object.keys(upstreamFirst).join(','))
check('上游请求体没有 max_output_tokens', !('max_output_tokens' in upstreamFirst))

console.log('\n=== 上限：指定了就照发 ===')
await readStream({ maxTokens: 1234 })
const upstreamSecond = upstreamBodies.at(-1) || {}
check('指定的 max_tokens 透传到上游', upstreamSecond.max_tokens === 1234, String(upstreamSecond.max_tokens))

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
child.kill()
upstream.close()
process.exit(bad ? 1 : 0)
