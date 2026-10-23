/**
 * 服务端出图超时：一路超时一路成功、全部超时、图片下载超时、客户端断开中止。
 * 需要一个短超时实例：
 *   SEEDREAM_TIMEOUT_MS=1500 SEEDREAM_DOWNLOAD_TIMEOUT_MS=800 npm run dev -- --port 5281
 * 跑法：APP_URL=http://127.0.0.1:5281 node verify-seedream-timeout.mjs
 */
import http from 'node:http'

const URL = process.env.APP_URL || 'http://127.0.0.1:5281'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => {
  const r = await fetch(`${URL}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    j = { ok: false, message: `HTTP ${r.status}` }
  }
  return { status: r.status, j }
}
const putSettings = (body) =>
  api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=',
  'base64',
)
let partialCount = 0
let closedStops = 0
let mockReceived = 0
const mock = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/image.png') {
    res.setHeader('Content-Type', 'image/png')
    res.end(PNG)
    return
  }
  if (req.method === 'GET' && req.url === '/hang.png') {
    req.on('close', () => { closedStops++ })
    req.on('aborted', () => { closedStops++ })
    return
  }
  if (req.method === 'POST' && req.url === '/api/v3/images/generations') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    mockReceived++
    res.on('close', () => { closedStops++ })
    req.socket?.on('close', () => { closedStops++ })
    const body = JSON.parse(raw || '{}')
    const prompt = String(body.prompt || '')
    req.on('close', () => closedStops++)
    req.on('aborted', () => closedStops++)
    if (prompt.includes('all-timeout')) return
    if (prompt.includes('partial')) {
      partialCount++
      if (partialCount % 2 === 0) return
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ url: `${origin}/image.png` }] }))
      return
    }
    if (prompt.includes('download-hang')) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ url: `${origin}/hang.png` }] }))
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ url: `${origin}/image.png` }] }))
    return
  }
  res.statusCode = 404
  res.end('not found')
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${mock.address().port}`

const original = (await api('/api/settings')).j.settings
const providers = original.providers.map((p) =>
  p.id === 'ark' ? { ...p, baseUrl: `${origin}/api/v3`, apiKey: 'test-key' } : p,
)
const models = [
  ...original.models.filter((m) => m.key !== 'test-image'),
  { key: 'test-image', label: 'Mock Image', cap: 'image', provider: 'ark', model: 'mock-image' },
]
await putSettings({ providers, models, defaults: { ...original.defaults, image: 'test-image' } })

const body = (prompt, n = 2) => ({
  prompt,
  ratio: '16:9',
  n,
  modelKey: 'test-image',
})
try {
  const partial = await api('/api/seedream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body('partial')),
  })
  check('一路成功一路超时仍返回成功', partial.j.ok === true && partial.j.urls.length === 1, JSON.stringify(partial.j).slice(0, 260))
  check('部分成功带超时 warning', /超时/.test(String(partial.j.warning)) && partial.j.timedOut === 1, JSON.stringify(partial.j))

  const all = await api('/api/seedream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body('all-timeout')),
  })
  check('全部超时返回结构化错误', all.status === 504 && all.j.ok === false && all.j.kind === 'timeout', JSON.stringify(all.j))

  const download = await api('/api/seedream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body('download-hang', 1)),
  })
  check('下载超时返回明确错误', download.status === 502 && download.j.ok === false && /下载/.test(download.j.message), JSON.stringify(download.j))

  // 客户端断开：用原始 HTTP 连接 destroy，确保服务端能观察到连接关闭
  closedStops = 0
  mockReceived = 0
  const target = new (globalThis.URL)(URL)
  const payload = JSON.stringify(body('all-timeout', 1))
  const raw = http.request({
    hostname: target.hostname,
    port: target.port,
    path: '/api/seedream',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  })
  raw.on('error', () => {})
  raw.end(payload)
  for (let i = 0; i < 20 && mockReceived === 0; i++) await new Promise((r) => setTimeout(r, 100))
  check('断开前上游请求已到达 mock', mockReceived > 0, String(mockReceived))
  await new Promise((r) => setTimeout(r, 300))
  raw.destroy()
  await new Promise((r) => setTimeout(r, 800))
  check('客户端断开后上游请求被中止', closedStops > 0, String(closedStops))
} finally {
  await putSettings({ providers: original.providers, models: original.models, defaults: original.defaults }).catch(() => {})
  mock.closeAllConnections?.()
  await new Promise((r) => mock.close(r))
}
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
