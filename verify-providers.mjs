/**
 * 多渠道设置验证：
 * 1) /api/settings 返回渠道 + 模型表 + 各能力默认（预置 5 渠道 / 7 能力）
 * 2) 旧字段兼容：ark 条目的模型 ID 与旧默认一致（未配置时）
 * 3) defaults 可改可存
 * 4) /api/seedance dryRun 按 modelKey 选到对应模型
 * 5) 设置页 UI：渠道卡 / 模型行 / 默认下拉
 * 6) Inspector 出现出图/出片/配音模型下拉，选择后落 localStorage 并进入生成请求
 * 跑法：node verify-providers.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())

// ---- 1. 接口结构 ----
const s0 = (await api('/api/settings')).settings
check('返回渠道列表', Array.isArray(s0.providers) && s0.providers.length >= 5, String(s0.providers?.length))
check('渠道含字节方舟', s0.providers.some((p) => p.id === 'ark' && p.kind === 'ark'))
check('渠道含 DeepSeek', s0.providers.some((p) => p.id === 'deepseek' && p.kind === 'openai'))
check('渠道含 MiniMax', s0.providers.some((p) => p.id === 'minimax' && p.kind === 'minimax'))
check('渠道含 ElevenLabs', s0.providers.some((p) => p.id === 'elevenlabs' && p.kind === 'elevenlabs'))
check('渠道含第三方兼容', s0.providers.some((p) => p.id === 'openai' && p.kind === 'openai'))

const caps = new Set((s0.models || []).map((m) => m.cap))
for (const c of ['text', 'textPro', 'image', 'view', 'video', 'videoRef', 'audio']) {
  check(`模型表覆盖 ${c}`, caps.has(c))
}
check(
  '每个能力都有默认',
  ['text', 'textPro', 'image', 'view', 'video', 'videoRef', 'audio'].every((c) => s0.defaults?.[c]),
  JSON.stringify(s0.defaults),
)
const arkImage = s0.models.find((m) => m.key === 'ark-image')
check('图像默认指向 Seedream', /seedream/i.test(arkImage?.model ?? ''), arkImage?.model)

// ---- 2. defaults 可改可存 ----
const put = await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ defaults: { ...s0.defaults, video: 'ark-video' } }),
})
check('defaults 保存成功', put.ok && put.settings.defaults.video === 'ark-video')

// ---- 3. dryRun 按 modelKey 选模型 ----
const files = await import('node:fs').then((m) => m.readdirSync('public/generated'))
const img = `/generated/${files.find((f) => f.endsWith('.jpg'))}`
const dryFirst = await api('/api/seedance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun: true, modelKey: 'ark-video', image: img, prompt: '[图]走', seconds: 5 }),
})
check('首帧模式按 modelKey 取模型', dryFirst.ok && /1-0-pro/.test(dryFirst.model ?? ''), String(dryFirst.model))
const dryRef = await api('/api/seedance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun: true, modelKey: 'ark-video-ref', refImages: [img], prompt: '[图1]走', seconds: 5 }),
})
check('多参考模式按 modelKey 取模型', dryRef.ok && /lite-i2v/.test(dryRef.model ?? ''), String(dryRef.model))

// ---- 4. 设置页 UI ----
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '设置', exact: true }).click().catch(async () => {
  await p.locator('header button', { hasText: '设置' }).first().click()
})
await p.waitForTimeout(900)

check('设置页渲染渠道卡', (await p.locator('.st-prov').count()) >= 5, String(await p.locator('.st-prov').count()))
check('设置页渲染模型行', (await p.locator('.st-model-row').count()) === s0.models.length)
check('默认模型下拉数量', (await p.locator('.st-sec select').count()) >= 7)

// 改一个默认模型并保存
const videoSel = p.locator('.st-field', { hasText: '视频 · 首帧出片' }).locator('select')
await videoSel.selectOption('ark-video')
await p.locator('button', { hasText: '保存设置' }).click()
await p.waitForTimeout(1200)
const s1 = (await api('/api/settings')).settings
check('设置页保存的默认值落库', s1.defaults.video === 'ark-video', String(s1.defaults.video))

// ---- 5. 画布生成时选模型 ----
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)
const shotNodeId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.type !== 'asset' && x.data?.shotId)?.id
})
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(500)
check('Inspector 出现模型下拉', (await p.locator('.mp-row').count()) >= 3, String(await p.locator('.mp-row').count()))

await p.locator('.mp-row', { hasText: '出图模型' }).locator('select').selectOption('ark-image')
await p.waitForTimeout(300)
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('storyboard-model-pick') || '{}'))
check('选择持久化到本地', stored.image === 'ark-image', JSON.stringify(stored))

const posts = []
await p.route('**/api/seedream', async (route) => {
  posts.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake-pick.jpg'], size: '1440x2560', model: 'fake' }),
  })
})
await p.locator('button', { hasText: /生成画面/ }).first().click()
await p.waitForTimeout(1200)
check('生成请求带 modelKey', posts[0]?.modelKey === 'ark-image', String(posts[0]?.modelKey))

// 清理：恢复默认 + 清本地选择
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ defaults: s0.defaults }),
})
await p.evaluate(() => localStorage.removeItem('storyboard-model-pick'))

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/providers.png', fullPage: false })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
