/**
 * 右键菜单选参考验证：
 * 1) 分镜卡右击 → 菜单列出画布里的角色/素材卡（视频卡被排除）
 * 2) 点素材行 → ref 边出现 + refIds 落库；再点一次 → 取消
 * 3) 点「首帧」→ 该镜 refImage 换成素材图（免填 URL）
 * 4) 素材卡右击 → 列出镜头 → 点镜头建立连线
 * 5) Esc 关闭菜单
 * 跑法：node verify-ctxmenu.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// 预清理：摘掉历史跑残留的 asset- 参考（必须在页面加载前做）
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

const shotRefIds = async (shotNodeId) =>
  p.evaluate(async (nid) => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    const n = (s.nodes || []).find((x) => x.id === nid)
    const sid = n?.data?.shotId
    if (!sid) return null
    const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
    const shot = j.project.shots.find((x) => x.id === sid)
    return shot?.refIds ?? []
  }, shotNodeId)

// ---- 准备：两张素材卡（场景图 + 视频卡，验证视频卡被排除） ----
const addAsset = async (title, kindLabel, url) => {
  await p.locator('header').locator('button', { hasText: '+ 素材' }).click()
  await p.waitForTimeout(500)
  const id = await p.locator('.react-flow__node-asset').last().getAttribute('data-id')
  await p.locator('.refx-kinds .btn-mini', { hasText: kindLabel }).click()
  await p.locator('.inspector .field', { hasText: '标题' }).locator('input').fill(title)
  await p.locator('.inspector .field', { hasText: /图片地址|视频地址/ })
    .locator('input')
    .fill(url)
  await p.waitForTimeout(250)
  return id
}
const sceneId = await addAsset('废土夜市', '场景图', '/generated/verify-scene.jpg')
const videoId = await addAsset('参考片段', '视频', '/videos/verify.mp4')
check('两张素材卡就位', !!sceneId && !!videoId, `${sceneId} / ${videoId}`)

// ---- 推送镜头到画布（新浏览器实例 localStorage 是空的） ----
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
check('找到分镜卡', !!shotNodeId, shotNodeId)

// ---- 1. 分镜卡右击 → 菜单出现 ----
await p.locator(`[data-id="${shotNodeId}"]`).dispatchEvent('contextmenu', {
  clientX: 640,
  clientY: 420,
  button: 2,
})
await p.waitForTimeout(400)
check('右键菜单出现', (await p.locator('.ctx-menu').count()) === 1)
check('菜单标题说明这是镜头参考', (await p.locator('.ctx-head b').innerText()).includes('参考'))
const rows = await p.locator('.ctx-row').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-ref')),
)
check('候选含场景素材卡', rows.includes(sceneId), rows.join(','))
check('候选排除视频卡', !rows.includes(videoId))

// ---- 2. 点素材行 → 连线 + 落库 ----
await p.locator(`.ctx-row[data-ref="${sceneId}"] .ctx-main`).click()
await p.waitForTimeout(500)
check('菜单项变为已选', (await p.locator(`.ctx-row[data-ref="${sceneId}"].on`).count()) === 1)
check(
  'ref 连线出现',
  (await p.locator(`.react-flow__edge[data-id^="ref-${sceneId}-${shotNodeId}"]`).count()) === 1,
)
await p.waitForTimeout(2600)
check('refIds 落库含素材', (await shotRefIds(shotNodeId))?.includes(sceneId))

// 再点一次 = 取消
await p.locator(`.ctx-row[data-ref="${sceneId}"] .ctx-main`).click()
await p.waitForTimeout(500)
check('再点取消连线', (await p.locator(`.react-flow__edge[data-id^="ref-${sceneId}-${shotNodeId}"]`).count()) === 0)

// ---- 3. 「首帧」按钮：把素材图设为该镜 refImage ----
await p.locator(`.ctx-row[data-ref="${sceneId}"] .ctx-act`).click()
await p.waitForTimeout(600)
const firstFrame = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.refImage ?? null
}, shotNodeId)
check('首帧已换成素材图', firstFrame === '/generated/verify-scene.jpg', String(firstFrame))

// ---- 4. 素材卡右击 → 连到镜头 ----
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
check('Esc 关闭菜单', (await p.locator('.ctx-menu').count()) === 0)

await p.locator(`[data-id="${sceneId}"]`).dispatchEvent('contextmenu', {
  clientX: 420,
  clientY: 360,
  button: 2,
})
await p.waitForTimeout(400)
check('素材卡菜单出现', (await p.locator('.ctx-menu').count()) === 1)
check('素材菜单列出镜头', (await p.locator(`.ctx-row[data-ref="${shotNodeId}"]`).count()) === 1)
await p.locator(`.ctx-row[data-ref="${shotNodeId}"] .ctx-main`).click()
await p.waitForTimeout(500)
check(
  '反向连线出现',
  (await p.locator(`.react-flow__edge[data-id^="ref-${sceneId}-${shotNodeId}"]`).count()) === 1,
)
await p.waitForTimeout(2600)
check('反向连线落库', (await shotRefIds(shotNodeId))?.includes(sceneId))

// ---- 收尾：清掉测试残留 ----
await p.evaluate(async (nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const shotId = (s.nodes || []).find((x) => x.id === nid)?.data?.shotId
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((x) =>
    x.id === shotId ? { ...x, refIds: (x.refIds ?? []).filter((r) => !r.startsWith('asset-')) } : x,
  )
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}, shotNodeId)

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/ctxmenu.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
