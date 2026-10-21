/**
 * 视频多参考图验证：
 * 1) 两张素材卡（场景 + 道具）都连到同一镜
 * 2) 点生成视频 → 前端 payload 带 refImages 多张，prompt 含 [图N] 图注
 * 3) 后端 dryRun：/api/seedance 走 reference_image 模式（--ref-images + Lite I2V 模型）
 * 跑法：node verify-videoref-multi.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// 用仓库里真实存在的图，后端会校验文件（dataURL/public 路径）
const imgs = fs
  .readdirSync('public/generated')
  .filter((f) => f.endsWith('.jpg'))
  .slice(0, 2)
  .map((f) => `/generated/${f}`)
check('找到两张测试图', imgs.length === 2, imgs.join(','))

{
  const j = await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())
  const shots = j.project.shots.map((x) => ({
    ...x,
    refIds: (x.refIds ?? []).filter((r) => !r.startsWith('asset-')),
  }))
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}

// 清空素材库：否则新会话会从 assets 表恢复卡片，干扰布局断言
await fetch('http://localhost:5273/api/project?name=recycle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assets: [] }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

const addAsset = async (title, kindLabel, url) => {
  await p.locator('header').locator('button', { hasText: '+ 素材' }).click()
  await p.waitForTimeout(450)
  const id = await p.locator('.react-flow__node-asset').last().getAttribute('data-id')
  await p.locator('.refx-kinds .btn-mini', { hasText: kindLabel }).click()
  await p.locator('.inspector .field', { hasText: '标题' }).locator('input').fill(title)
  await p
    .locator('.inspector .field', { hasText: /图片地址|视频地址/ })
    .locator('input')
    .fill(url)
  await p.waitForTimeout(250)
  return id
}
const sceneId = await addAsset('废土夜市', '场景图', imgs[0])
const propId = await addAsset('义体手臂', '道具图', imgs[1])

await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)
const shotNodeId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.type !== 'asset' && x.data?.shotId)?.id
})
check('分镜卡就位', !!shotNodeId, shotNodeId)

// 右击分镜 → 连两张素材
await p.locator(`[data-id="${shotNodeId}"]`).dispatchEvent('contextmenu', {
  clientX: 640,
  clientY: 420,
  button: 2,
})
await p.waitForTimeout(400)
await p.locator(`.ctx-row[data-ref="${sceneId}"] .ctx-main`).click()
await p.waitForTimeout(250)
await p.locator(`.ctx-row[data-ref="${propId}"] .ctx-main`).click()
await p.waitForTimeout(300)
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
check('两张参考连线都在', (await p.locator('.react-flow__edge[data-id^="ref-"]').count()) >= 2)

// 拦截出片
const posts = []
await p.route('**/api/seedance**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    posts.push(JSON.parse(req.postData() || '{}'))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'fake-multi', mode: 'ref' }),
    })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
  })
})

await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(400)
check('Inspector 显示多图模式', (await p.locator('.vid-refs').count()) === 1)

await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1200)
check('拦截到出片请求', posts.length === 1, String(posts.length))
if (posts.length) {
  const body = posts[0]
  check('走多参考图模式（带 refImages）', Array.isArray(body.refImages), JSON.stringify(body.refImages))
  const list = body.refImages ?? []
  check('参考图含场景与道具', list.includes(imgs[0]) && list.includes(imgs[1]), list.join(','))
  check('参考图数量 ≤ 4', list.length <= 4, String(list.length))
  check('提示词按 [图N] 指代', /\[图1\]=/.test(body.prompt) && /\[图2\]=/.test(body.prompt))
  check('不再单传首帧 image', !body.image, String(body.image))
}

// 后端：dryRun 断言 CLI 参数
const dry = await fetch(`${URL}/api/seedance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dryRun: true,
    refImages: imgs,
    prompt: '[图1]和[图2]',
    seconds: 5,
    ratio: '9:16',
    resolution: '720p',
  }),
}).then((r) => r.json())
check('后端 dryRun 走 ref 模式', dry.mode === 'ref', JSON.stringify(dry.mode))
check('CLI 带 --ref-images', (dry.args ?? []).includes('--ref-images'))
check(
  '多图用 Lite I2V 模型',
  String(dry.model).includes('lite-i2v'),
  String(dry.model),
)
check('没有 -i 首帧参数', !(dry.args ?? []).includes('-i'))

// 坏图跳过：一张有效 + 一张不存在 → 只提交有效图，skipped 回报
const dry2 = await fetch(`${URL}/api/seedance`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dryRun: true,
    refImages: [imgs[0], '/generated/does-not-exist.jpg'],
    prompt: '[图1]走',
    seconds: 5,
  }),
}).then((r) => r.json())
check('失效参考图被跳过而不是整单失败', dry2.ok === true && dry2.skipped?.length === 1, JSON.stringify(dry2.skipped))
check(
  '只提交有效图',
  (dry2.args ?? []).filter((x) => String(x).endsWith('.jpg')).length === 1,
  JSON.stringify(dry2.args),
)

// 清理
await p.evaluate(async (nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const sid = (s.nodes || []).find((x) => x.id === nid)?.data?.shotId
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((x) =>
    x.id === sid ? { ...x, refIds: (x.refIds ?? []).filter((r) => !r.startsWith('asset-')) } : x,
  )
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}, shotNodeId)

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/videoref-multi.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
