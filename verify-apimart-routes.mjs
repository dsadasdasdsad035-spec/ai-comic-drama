/**
 * APIMart 路由集成验证（本地 mock 上游，不花真实额度）。
 * 覆盖：目录、Key、测试、文本（SSE 回退）、视觉、图像、图像参考图、视频 dryRun/任务、音色。
 *
 * 跑法：node verify-apimart-routes.mjs [dev-server-base]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const DEV = process.argv[2] || process.env.APIMART_BASE || 'http://127.0.0.1:5280'
const ROOT = process.cwd()
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = async (req) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  const base = `http://127.0.0.1:${mock.address().port}`
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return json(res, {
      data: [
        { id: 'gpt-5.1', category: 'chat', capability_tags: ['Text', 'Vision'] },
        { id: 'seedream-5-0-pro', category: 'image', capability_tags: ['Text to Image', 'Image to Image'] },
        { id: 'seedance-2.5', category: 'video', capability_tags: ['Text to Video'] },
        { id: 'gpt-4o-mini-tts', category: 'audio', capability_tags: ['Audio'] },
      ],
    })
  }
  if (req.method === 'POST' && url.pathname === '/v1/uploads/images') {
    await readBody(req)
    return json(res, { url: `${base}/ref.png`, filename: 'ref.png', content_type: 'image/png' })
  }
  if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
    await readBody(req)
    return json(res, { code: 200, data: [{ status: 'submitted', task_id: 'img1' }] })
  }
  if (req.method === 'POST' && url.pathname === '/v1/videos/generations') {
    await readBody(req)
    return json(res, { code: 200, data: [{ status: 'submitted', task_id: 'vid1' }] })
  }
  if (req.method === 'GET' && url.pathname === '/v1/tasks/img1') {
    return json(res, {
      code: 200,
      data: { status: 'completed', progress: 100, result: { images: [{ url: [`${base}/out.png`] }] } },
    })
  }
  if (req.method === 'GET' && url.pathname === '/v1/tasks/vid1') {
    return json(res, {
      code: 200,
      data: { status: 'completed', progress: 100, result: { videos: [{ url: `${base}/out.mp4` }] } },
    })
  }
  if (req.method === 'GET' && url.pathname === '/out.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    return res.end(PNG)
  }
  if (req.method === 'GET' && url.pathname === '/out.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    return res.end(Buffer.from('mock-mp4'))
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const text = body.stream ? 'mock stream' : 'mock non-stream'
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
    res.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      })}\n\n`,
    )
    res.write('data: [DONE]\n\n')
    return res.end()
  }
  if (req.method === 'POST' && url.pathname === '/v1/audio/speech') {
    await readBody(req)
    res.writeHead(200, { 'content-type': 'audio/mpeg' })
    return res.end(Buffer.from('mock-mp3'))
  }
  json(res, { error: { message: `unexpected ${req.method} ${url.pathname}` } }, 404)
})

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
const mockBase = `http://127.0.0.1:${mock.address().port}`

const api = async (p, init) => {
  const r = await fetch(`${DEV}${p}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await r.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: r.status, body }
}

const original = (await api('/api/settings')).body.settings
const testProvider = {
  id: 'apimart-test',
  label: 'APIMart Mock',
  kind: 'apimart',
  baseUrl: `${mockBase}/v1`,
  apiKey: 'test-key',
  caps: ['text', 'image', 'video', 'audio'],
}
const testModels = [
  {
    key: 'mock-text',
    label: 'Mock Text',
    cap: 'text',
    caps: ['text', 'textPro', 'vision'],
    provider: 'apimart-test',
    model: 'gpt-5.1',
    source: 'manual',
    runtime: 'ready',
    features: { vision: true },
  },
  {
    key: 'mock-image',
    label: 'Mock Image',
    cap: 'image',
    caps: ['image', 'view'],
    provider: 'apimart-test',
    model: 'seedream-5-0-pro',
    source: 'manual',
    runtime: 'ready',
    features: { imageRef: 'multi' },
  },
  {
    key: 'mock-video',
    label: 'Mock Video',
    cap: 'video',
    caps: ['video'],
    provider: 'apimart-test',
    model: 'seedance-2.5',
    source: 'manual',
    runtime: 'ready',
    supportsVideoRef: true,
    features: { firstFrame: true, lastFrame: true, videoRef: true },
  },
  {
    key: 'mock-tts',
    label: 'Mock TTS',
    cap: 'audio',
    caps: ['audio'],
    provider: 'apimart-test',
    model: 'gpt-4o-mini-tts',
    source: 'manual',
    runtime: 'ready',
    features: { audioOut: true },
  },
]
const refPath = path.join(ROOT, 'public', 'generated', 'apimart-mock-ref.png')
fs.mkdirSync(path.dirname(refPath), { recursive: true })
fs.writeFileSync(refPath, PNG)

const putSettings = async (settings) => {
  await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      providers: settings.providers,
      models: settings.models,
      defaults: settings.defaults,
      stageModels: settings.stageModels,
      pricing: settings.pricing,
      agentLimits: settings.agentLimits,
      agentToolProtocol: settings.agentToolProtocol,
      apiKey: settings.apiKey,
      rules: settings.rules,
    }),
  })
}

try {
  const next = {
    ...original,
    providers: [...original.providers.filter((p) => p.id !== 'apimart-test'), testProvider],
    models: [...original.models.filter((m) => m.provider !== 'apimart-test'), ...testModels],
  }
  await putSettings(next)

  const settings = (await api('/api/settings')).body.settings
  const p = settings.providers.find((x) => x.id === 'apimart-test')
  check('settings 返回 keyAvailable', p?.keyAvailable === true, String(p?.keyAvailable))

  const catalog = await api('/api/provider-catalog', {
    method: 'POST',
    body: JSON.stringify({ id: 'apimart-test', provider: testProvider }),
  })
  check('目录接口', catalog.body.ok === true && catalog.body.entries.length === 4, JSON.stringify(catalog.body).slice(0, 160))
  check('目录能力映射', catalog.body.entries[0]?.suggestedCaps?.includes('vision'))

  const test = await api('/api/test-provider', {
    method: 'POST',
    body: JSON.stringify({ id: 'apimart-test', provider: testProvider }),
  })
  check('渠道测试连通', test.body.ok === true && test.body.kind === 'ok', JSON.stringify(test.body).slice(0, 160))

  const text = await api('/api/text', {
    method: 'POST',
    body: JSON.stringify({ modelKey: 'mock-text', prompt: 'ping', maxTokens: 8, stream: false }),
  })
  check('文本非流式（SSE 回退）', text.body.ok === true && /mock non-stream/.test(text.body.text), JSON.stringify(text.body).slice(0, 160))

  const stream = await api('/api/text', {
    method: 'POST',
    body: JSON.stringify({ modelKey: 'mock-text', prompt: 'ping', maxTokens: 8, stream: true }),
  })
  const streamEvents = String(stream.body)
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      try {
        return JSON.parse(line.slice(5).trim())
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const streamDone = streamEvents.find((e) => e.type === 'done')
  check('文本流式', /mock stream/.test(streamDone?.text || ''), JSON.stringify(streamDone).slice(0, 160))

  const vision = await api('/api/vision', {
    method: 'POST',
    body: JSON.stringify({
      modelKey: 'mock-text',
      prompt: '颜色',
      image: `data:image/png;base64,${PNG.toString('base64')}`,
      maxTokens: 16,
    }),
  })
  check('视觉', vision.body.ok === true && /mock/.test(vision.body.text), JSON.stringify(vision.body).slice(0, 160))

  const image = await api('/api/seedream', {
    method: 'POST',
    body: JSON.stringify({ modelKey: 'mock-image', prompt: 'mock image', ratio: '16:9', n: 1 }),
  })
  check('图像任务', image.body.ok === true && image.body.urls?.length === 1, JSON.stringify(image.body).slice(0, 160))

  const imageRef = await api('/api/seedream', {
    method: 'POST',
    body: JSON.stringify({
      modelKey: 'mock-image',
      prompt: 'mock image ref',
      refImage: '/generated/apimart-mock-ref.png',
      ratio: '16:9',
      n: 1,
    }),
  })
  check('图像参考图上传', imageRef.body.ok === true && imageRef.body.urls?.length === 1, JSON.stringify(imageRef.body).slice(0, 160))

  const videoDry = await api('/api/seedance', {
    method: 'POST',
    body: JSON.stringify({
      dryRun: true,
      modelKey: 'mock-video',
      image: '/generated/apimart-mock-ref.png',
      prompt: 'mock video',
      seconds: 5,
      ratio: '16:9',
      resolution: '720p',
    }),
  })
  check(
    '视频 dryRun 族与 payload',
    videoDry.body.ok === true &&
      videoDry.body.family === 'seedance-2.5' &&
      videoDry.body.request?.image_with_roles?.length === 1,
    JSON.stringify(videoDry.body).slice(0, 220),
  )

  const video = await api('/api/seedance', {
    method: 'POST',
    body: JSON.stringify({
      modelKey: 'mock-video',
      image: '/generated/apimart-mock-ref.png',
      prompt: 'mock video',
      seconds: 5,
      ratio: '16:9',
      resolution: '720p',
    }),
  })
  check('视频任务提交', video.body.ok === true && Boolean(video.body.id), JSON.stringify(video.body).slice(0, 160))
  let job = null
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const q = await api(`/api/seedance?id=${encodeURIComponent(video.body.id)}`)
    job = q.body
    if (job.status === 'succeeded' || job.status === 'failed') break
  }
  check('视频任务完成', job?.status === 'succeeded' && /^\/videos\//.test(job.url || ''), JSON.stringify(job).slice(0, 200))

  const voices = await api('/api/voices?modelKey=mock-tts')
  check(
    'APIMart 音色列表',
    voices.body.ok === true && voices.body.provider === 'apimart' && voices.body.voices.length === 6,
    JSON.stringify(voices.body).slice(0, 160),
  )
} finally {
  await putSettings(original)
  try {
    fs.unlinkSync(refPath)
  } catch {
    /* 忽略 */
  }
  await new Promise((resolve) => mock.close(resolve))
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
