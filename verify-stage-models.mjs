/**
 * 环节模型选择验证（不调用真实方舟）：
 * 1) stageModels 写入 / 读取 / 清空
 * 2) 显式 textPro 键精确命中，不被换成 text 默认
 * 3) 未知 modelKey 返回 400 model-key-not-found，且不发起上游请求
 * 4) 没有任何文本模型时返回 400 no-text-model
 * 5) 不带 modelKey 的旧调用仍按 defaults.text / defaults.textPro 解析
 * 跑法：先 npm run dev，再 node verify-stage-models.mjs
 */
import http from 'node:http'

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

let origin = ''
let chatCalls = 0
let lastChat = null
const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  if (req.method === 'POST' && u.pathname === '/api/plan/v3/chat/completions') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    lastChat = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    chatCalls++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] }))
    return
  }
  res.statusCode = 404
  res.end('not found')
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
origin = `http://127.0.0.1:${mock.address().port}`

const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())
const postText = (body) =>
  api('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const putSettings = (body) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const original = (await api('/api/settings')).settings
const byKey = (key) => original.models.find((m) => m.key === key)

try {
  // ---- 1. stageModels 写入 / 读取 / 清空 ----
  const stageModels = {
    script: 'ark-plan-text-pro',
    character: 'ark-plan-text-lite',
    shot: 'ark-plan-text-pro',
    prompt: 'ark-plan-text-lite',
  }
  const saved = await putSettings({ stageModels })
  check('stageModels 保存成功', saved.ok === true)
  check(
    'stageModels 读取一致',
    JSON.stringify(saved.settings.stageModels) === JSON.stringify(stageModels),
    JSON.stringify(saved.settings.stageModels),
  )
  const cleared = await putSettings({ stageModels: { script: 'ark-plan-text-pro' } })
  check(
    'stageModels 整体替换可清空未提交的环节',
    cleared.settings.stageModels?.script === 'ark-plan-text-pro' &&
      cleared.settings.stageModels?.character === undefined,
    JSON.stringify(cleared.settings.stageModels),
  )

  // ---- 2. 把 ark-plan 指向 mock，并固定文本默认，排除本地设置干扰 ----
  const providers = original.providers.map((p) =>
    p.id === 'ark-plan' ? { ...p, baseUrl: `${origin}/api/plan/v3`, apiKey: 'test-plan-key' } : p,
  )
  const defaults = {
    ...original.defaults,
    text: 'ark-plan-text-lite',
    textPro: 'ark-plan-text-pro',
  }
  await putSettings({ providers, defaults })

  // ---- 3. 显式 textPro 键精确命中 ----
  const pro = await postText({ prompt: 'ping', modelKey: 'ark-plan-text-pro', maxTokens: 1 })
  check('textPro 键调用成功', pro.ok === true && pro.text === 'pong', JSON.stringify(pro).slice(0, 180))
  check('响应回传 modelKey', pro.modelKey === 'ark-plan-text-pro', String(pro.modelKey))
  check('响应回传 modelLabel', pro.modelLabel === byKey('ark-plan-text-pro')?.label, String(pro.modelLabel))
  check(
    '上游拿到的是 textPro 的模型 ID',
    lastChat?.model === byKey('ark-plan-text-pro')?.model,
    JSON.stringify(lastChat),
  )

  // ---- 4. 未知 modelKey 必须报错且不调上游 ----
  const beforeUnknown = chatCalls
  const unknown = await postText({ prompt: 'ping', modelKey: 'no-such-text-model' })
  check('未知 modelKey 返回 400', unknown.ok === false && unknown.kind === 'model-key-not-found', JSON.stringify(unknown))
  check('未知 modelKey 消息包含键名', String(unknown.message || '').includes('no-such-text-model'))
  check('未知 modelKey 不发起上游请求', chatCalls === beforeUnknown, `calls ${chatCalls - beforeUnknown}`)

  // ---- 5. 没有文本模型时明确报错 ----
  const noTextModels = original.models.filter((m) => m.cap !== 'text' && m.cap !== 'textPro')
  await putSettings({ models: noTextModels })
  const noText = await postText({ prompt: 'ping' })
  check('无文本模型返回 400', noText.ok === false && noText.kind === 'no-text-model', JSON.stringify(noText))
  await putSettings({ models: original.models })

  // ---- 6. 不带 modelKey 的旧调用仍按档位解析 ----
  const lite = await postText({ prompt: 'ping', model: 'lite' })
  check(
    '无键 lite 走 defaults.text',
    lite.ok === true && lastChat?.model === byKey('ark-plan-text-lite')?.model,
    JSON.stringify(lastChat),
  )
  const tierPro = await postText({ prompt: 'ping', model: 'pro' })
  check(
    '无键 pro 走 defaults.textPro',
    tierPro.ok === true && lastChat?.model === byKey('ark-plan-text-pro')?.model,
    JSON.stringify(lastChat),
  )
} finally {
  await putSettings({
    providers: original.providers,
    models: original.models,
    defaults: original.defaults,
    stageModels: original.stageModels || {},
  }).catch(() => {})
  await new Promise((resolve) => mock.close(resolve))
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
