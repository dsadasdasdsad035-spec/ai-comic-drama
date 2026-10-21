/**
 * 视频出片取连线参考图验证：
 * 1) 分镜卡右击 → 点素材卡建立连线
 * 2) 清掉该镜 refImage（模拟「还没出画面」）
 * 3) 点生成视频 → 拦截 /api/seedance，断言 image = 连线素材图（不用手填 URL）
 * 跑法：node verify-videoref.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

{
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((x) => ({
    ...x,
    refIds: (x.refIds ?? []).filter((r) => !r.startsWith('asset-')),
  }))
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

// 素材卡（场景图）
await p.locator('header').locator('button', { hasText: '+ 素材' }).click()
await p.waitForTimeout(500)
const assetId = await p.locator('.react-flow__node-asset').last().getAttribute('data-id')
await p.locator('.refx-kinds .btn-mini', { hasText: '场景图' }).click()
await p.locator('.inspector .field', { hasText: '标题' }).locator('input').fill('废土夜市')
await p
  .locator('.inspector .field', { hasText: /图片地址|视频地址/ })
  .locator('input')
  .fill('/generated/verify-scene.jpg')
await p.waitForTimeout(300)

// 推送镜头到画布
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

// 右击分镜 → 连线素材
await p.locator(`[data-id="${shotNodeId}"]`).dispatchEvent('contextmenu', {
  clientX: 640,
  clientY: 420,
  button: 2,
})
await p.waitForTimeout(400)
await p.locator(`.ctx-row[data-ref="${assetId}"] .ctx-main`).click()
await p.waitForTimeout(500)
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
check(
  '连线已建立',
  (await p.locator(`.react-flow__edge[data-id^="ref-${assetId}-${shotNodeId}"]`).count()) === 1,
)

// 选中该镜 → 清空画面（模拟没出过图）
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(400)
const removeBtn = p.locator('.inspector .btn-ghost', { hasText: '移除' }).first()
if (await removeBtn.count()) {
  await removeBtn.click()
  // 画布状态写 localStorage 有 1.5s 防抖
  await p.waitForTimeout(1900)
}
const noRef = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.refImage ?? null
}, shotNodeId)
check('该镜已清空画面', !noRef, String(noRef))

// 拦截出片请求
const posts = []
await p.route('**/api/seedance**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    posts.push(JSON.parse(req.postData() || '{}'))
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'fake-vid-task' }),
    })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
  })
})

const videoBtn = p.locator('button', { hasText: /生成视频|重出视频/ }).first()
check('无画面时按钮仍可点', await videoBtn.isEnabled())
await videoBtn.click()
await p.waitForTimeout(1200)
check('拦截到出片请求', posts.length === 1, String(posts.length))
if (posts.length) {
  // 连线存在即走多参考图模式（reference_image），不再单传首帧
  check(
    '连线素材图进参考图列表',
    (posts[0].refImages ?? []).includes('/generated/verify-scene.jpg'),
    JSON.stringify(posts[0].refImages),
  )
  check('提示词带图注', /\[图1\]=/.test(posts[0].prompt || ''))
}

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
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
