/**
 * Agent Plan 渠道验证（不调用真实方舟）：
 * 1) 设置里出现 ark-plan / volc-tts 预设，默认值不被覆盖
 * 2) 文本/图片请求命中 Agent Plan Base URL，参考图保留
 * 3) ark-plan 测试走 1-token 对话；volc-tts 测试区分鉴权/扣减
 * 4) 视频默认模型仍绑定标准 ark
 * 跑法：先 npm run dev，再 node verify-agent-plan.mjs
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'http://127.0.0.1:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) {
  console.error('dev server 未启动：先运行 npm run dev')
  process.exit(1)
}

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
let origin = ''
let ttsMode = 'auth-ok'
let last = { chat: null, image: null, tts: null, auth: '' }

const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
  }
  const readBody = async () => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const text = Buffer.concat(chunks).toString('utf8') || '{}'
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  if (req.method === 'POST' && u.pathname === '/api/plan/v3/chat/completions') {
    last.chat = await readBody()
    last.auth = String(req.headers.authorization || '')
    return send(200, { choices: [{ message: { content: 'pong' } }] })
  }
  if (req.method === 'POST' && u.pathname === '/api/plan/v3/images/generations') {
    last.image = await readBody()
    last.auth = String(req.headers.authorization || '')
    return send(200, { data: [{ b64_json: PNG }] })
  }
  if (req.method === 'GET' && u.pathname === '/api/plan/v3/models') {
    return send(400, { error: { code: 'InvalidParameter', message: 'models not supported' } })
  }
  if (req.method === 'POST' && u.pathname === '/api/v3/plan/tts/unidirectional') {
    last.tts = await readBody()
    if (ttsMode === 'auth') {
      res.statusCode = 401
      res.end(JSON.stringify({ header: { code: 45000010, message: 'Invalid X-Api-Key' } }))
      return
    }
    if (ttsMode === 'deduction') {
      return send(200, {
        code: 45000030,
        message: 'AgentPlanDeductNotEnabled message:enable the deduction setting',
      })
    }
    return send(200, { code: 45000000, message: 'request does not contain req_params' })
  }
  res.statusCode = 404
  res.end('not found')
})

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${mock.address().port}`

const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())
const putSettings = (body) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const settings0 = (await api('/api/settings')).settings
const beforeGenerated = new Set(
  fs.existsSync('public/generated') ? fs.readdirSync('public/generated') : [],
)

try {
  // ---- 1. 预设 ----
  const plan = settings0.providers.find((p) => p.id === 'ark-plan')
  const tts = settings0.providers.find((p) => p.id === 'volc-tts')
  check('存在 ark-plan 渠道', plan?.kind === 'ark-plan' && plan?.baseUrl.includes('/api/plan/v3'))
  check('ark-plan 只承接文本/图片', JSON.stringify(plan?.caps) === '["text","image"]', JSON.stringify(plan?.caps))
  check('存在 volc-tts 渠道', tts?.kind === 'volc-tts' && tts?.caps?.includes('audio'))
  check(
    '文本模型预设',
    settings0.models.some((m) => m.key === 'ark-plan-text-lite' && m.model === 'doubao-seed-2-1-lite-260915') &&
      settings0.models.some((m) => m.key === 'ark-plan-text-pro' && m.model === 'doubao-seed-2-1-pro-260915'),
  )
  check(
    '图片模型预设',
    settings0.models.some((m) => m.key === 'ark-plan-image' && m.model === 'doubao-seedream-5-0-pro-260628'),
  )
  check('音频模型预设', settings0.models.some((m) => m.key === 'volc-tts' && m.provider === 'volc-tts'))
  check('预设迁移版本已落库', Number(settings0.presetsVersion) >= 2, String(settings0.presetsVersion))

  // ---- 2. 视频默认仍走标准 ark ----
  const videoModel = settings0.models.find((m) => m.key === settings0.defaults.video)
  const videoRefModel = settings0.models.find((m) => m.key === settings0.defaults.videoRef)
  check('视频默认绑定标准 ark', videoModel?.provider === 'ark', JSON.stringify(settings0.defaults.video))
  check('视频参考默认绑定标准 ark', videoRefModel?.provider === 'ark', JSON.stringify(settings0.defaults.videoRef))
  check('ark-plan 不出现在视频能力', !plan?.caps?.includes('video'), JSON.stringify(plan?.caps))

  // ---- 3. 路由：把两个渠道指向 mock ----
  const providers = settings0.providers.map((p) => {
    if (p.id === 'ark-plan') return { ...p, baseUrl: `${origin}/api/plan/v3`, apiKey: 'test-plan-key' }
    if (p.id === 'volc-tts') return { ...p, baseUrl: `${origin}/api/v3/plan`, apiKey: 'test-tts-key' }
    return p
  })
  const saved = await putSettings({ providers })
  check('mock 渠道设置已保存', saved.ok === true)

  const text = await api('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'ping', modelKey: 'ark-plan-text-lite', maxTokens: 1 }),
  })
  check('文本走 Agent Plan', text.ok === true && text.text === 'pong', JSON.stringify(text).slice(0, 160))
  check('文本鉴权头正确', last.auth === 'Bearer test-plan-key', last.auth)
  check(
    '文本请求模型正确',
    last.chat?.model === 'doubao-seed-2-1-lite-260915' && last.chat?.max_tokens === 1,
    JSON.stringify(last.chat),
  )

  const image = await api('/api/seedream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '一只猫',
      ratio: '1:1',
      modelKey: 'ark-plan-image',
      refImage: `data:image/png;base64,${PNG}`,
    }),
  })
  check('图片走 Agent Plan', image.ok === true && Boolean(image.url), JSON.stringify(image).slice(0, 160))
  check('图片请求路径命中', Boolean(last.image?.prompt), JSON.stringify(last.image).slice(0, 160))
  const refPayload = last.image?.image
  const refOk =
    typeof refPayload === 'string'
      ? refPayload.startsWith('data:image/png')
      : Array.isArray(refPayload) && refPayload.length === 1
  check('图片参考图保留', refOk, JSON.stringify(refPayload).slice(0, 120))

  // ---- 4. 音色列表按渠道返回 ----
  const volcVoices = await api('/api/voices?modelKey=volc-tts')
  check(
    'volc-tts 音色列表',
    volcVoices.provider === 'volc-tts' && (volcVoices.voices || []).length >= 1,
    JSON.stringify(volcVoices).slice(0, 180),
  )
  const minimaxVoices = await api('/api/voices?modelKey=minimax-tts')
  check(
    'minimax 音色列表',
    minimaxVoices.provider === 'minimax' && (minimaxVoices.voices || []).length >= 1,
    JSON.stringify(minimaxVoices).slice(0, 180),
  )

  // ---- 5. 渠道测试 ----
  const testPlan = await api('/api/test-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'ark-plan' }),
  })
  check(
    'ark-plan 测试走对话',
    testPlan.ok === true && /chat\/completions/.test(testPlan.endpoint || ''),
    JSON.stringify(testPlan).slice(0, 180),
  )

  ttsMode = 'auth-ok'
  const testTtsOk = await api('/api/test-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'volc-tts' }),
  })
  check('volc-tts 鉴权通过', testTtsOk.ok === true, JSON.stringify(testTtsOk).slice(0, 180))

  ttsMode = 'deduction'
  const testTtsDeduct = await api('/api/test-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'volc-tts' }),
  })
  check(
    'volc-tts 扣减提示',
    testTtsDeduct.ok === false && testTtsDeduct.kind === 'plan' && /开启扣减/.test(testTtsDeduct.message || ''),
    JSON.stringify(testTtsDeduct).slice(0, 180),
  )

  ttsMode = 'auth'
  const testTtsAuth = await api('/api/test-provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'volc-tts' }),
  })
  check(
    'volc-tts 鉴权失败',
    testTtsAuth.ok === false && testTtsAuth.kind === 'auth',
    JSON.stringify(testTtsAuth).slice(0, 180),
  )
} finally {
  await putSettings({ providers: settings0.providers }).catch(() => {})
  if (fs.existsSync('public/generated')) {
    for (const f of fs.readdirSync('public/generated')) {
      if (!beforeGenerated.has(f)) {
        try {
          fs.unlinkSync(path.join('public/generated', f))
        } catch {
          /* ignore */
        }
      }
    }
  }
  await new Promise((resolve) => mock.close(resolve))
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
