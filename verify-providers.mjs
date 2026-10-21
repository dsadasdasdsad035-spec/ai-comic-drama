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
check(
  '每个渠道都标了用途',
  s0.providers.every((p) => Array.isArray(p.caps) && p.caps.length > 0),
  JSON.stringify(s0.providers.map((p) => `${p.id}:${p.caps}`)),
)
const arkP = s0.providers.find((p) => p.id === 'ark')
check('方舟用途含文本/图片/视频', ['text', 'image', 'video'].every((c) => arkP.caps.includes(c)), JSON.stringify(arkP.caps))
check('每个渠道都有 baseUrl', s0.providers.every((p) => /^https?:\/\//.test(p.baseUrl || '')))

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
const imgName = files.find((f) => /\.(jpe?g|png|webp)$/i.test(f))
const img = `/generated/${imgName}`
const dryFirst = await api('/api/seedance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun: true, modelKey: 'ark-video', image: img, prompt: '[图]走', seconds: 5 }),
})
check('首帧模式按 modelKey 取模型', dryFirst.ok && /1-0-pro/.test(dryFirst.model ?? ''), String(dryFirst.model))
const firstItems = (dryFirst.request?.content ?? []).filter((c) => c.type === 'image_url')
check(
  '首帧请求体角色与参数正确',
  firstItems.length === 1 &&
    firstItems[0].role === 'first_frame' &&
    dryFirst.request?.duration === 5 &&
    dryFirst.request?.model === dryFirst.model,
  JSON.stringify(dryFirst.request),
)
const dryRef = await api('/api/seedance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dryRun: true, modelKey: 'ark-video-ref', refImages: [img], prompt: '[图1]走', seconds: 5 }),
})
check('多参考模式按 modelKey 取模型', dryRef.ok && /lite-i2v/.test(dryRef.model ?? ''), String(dryRef.model))
const refItems = (dryRef.request?.content ?? []).filter((c) => c.type === 'image_url')
check(
  '多参考请求体角色正确',
  refItems.length === 1 && refItems[0].role === 'reference_image',
  JSON.stringify(dryRef.request),
)

// ---- 3b. 渠道测试端点 ----
const tNoKey = await api('/api/test-provider', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'deepseek' }),
})
check('没填 Key 的渠道报 no-key', tNoKey.kind === 'no-key', JSON.stringify(tNoKey))

const tNet = await api('/api/test-provider', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'ghost',
    provider: { id: 'ghost', label: 'ghost', kind: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k' },
  }),
})
check('连不通报 net', tNet.ok === false && tNet.kind === 'net', JSON.stringify(tNet))

const tArk = await api('/api/test-provider', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'ark' }),
})
check('方舟渠道能测出结果', typeof tArk.status === 'number' || typeof tArk.latency === 'number', JSON.stringify(tArk))
check('方舟鉴权通过（/models 200）', tArk.ok === true && tArk.status === 200, JSON.stringify(tArk).slice(0, 120))

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

check('设置页按用途分四组', (await p.locator('.st-pcgroup').count()) === 4, String(await p.locator('.st-pcgroup').count()))
for (const [pc, name] of [['text', '文本渠道'], ['image', '图片渠道'], ['video', '视频渠道'], ['audio', '音频渠道']]) {
  const g = p.locator(`.st-pcgroup[data-pc="${pc}"]`)
  check(`${name}分组有标题`, (await g.locator('.st-pcgroup-head b').innerText()) === name)
}
check(
  '方舟同时出现在文本/图片/视频组',
  (
    await Promise.all(
      ['text', 'image', 'video'].map((pc) =>
        p.locator(`.st-pcgroup[data-pc="${pc}"] .st-prov[data-pid="ark"]`).count(),
      ),
    )
  ).every((n) => n >= 1),
)
check(
  '音频组只列音频渠道',
  (await p.locator('.st-pcgroup[data-pc="audio"] .st-prov[data-pid="ark"]').count()) === 0,
)
check('设置页渲染渠道卡', (await p.locator('.st-prov').count()) >= 5, String(await p.locator('.st-prov').count()))
check('设置页渲染模型行', (await p.locator('.st-model-row').count()) === s0.models.length)
check('默认模型下拉数量', (await p.locator('.st-sec select').count()) >= 7)

// 点方舟卡上的「测试」→ 出现结果行
const arkCard = p.locator('.st-pcgroup[data-pc="text"] .st-prov[data-pid="ark"]').first()
await arkCard.locator('button', { hasText: '测试' }).click()
await p.waitForTimeout(2500)
const testBox = arkCard.locator('.st-test')
check('测试按钮出结果', (await testBox.count()) === 1, await testBox.innerText().catch(() => ''))
check('方舟测试结果为可用', (await testBox.getAttribute('class'))?.includes('ok') ?? false, await testBox.innerText())

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
