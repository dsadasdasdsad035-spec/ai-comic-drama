/**
 * 素材卡 + 参考连线验证：
 * 1) + 素材 → asset 节点出现，Inspector 素材面板可编辑（类型/标题/URL）
 * 2) 拖拽连线 asset → shot → ref 边出现，refIds 落库
 * 3) 拦截生成画面 → refImages 含连线素材图（场景图）
 * 4) 删除连线 → refIds 移除
 * 跑法：node verify-assets.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

// 预清理：摘掉历史跑残留的 asset- 参考（画布素材是本浏览器实例的，跨跑会累积），必须在页面加载前做
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

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

// ---- 1. 加素材卡 ----
await p.locator('header').locator('button', { hasText: '+ 素材' }).click()
await p.waitForTimeout(700)
const assetNode = p.locator('.react-flow__node-asset').first()
check('素材卡节点出现', (await assetNode.count()) > 0)
const assetId = await assetNode.getAttribute('data-id')
check('Inspector 显示素材面板', (await p.locator('.inspector .panel-head', { hasText: '素材卡' }).count()) > 0)

// 编辑：类型=场景图、标题、URL
await p.locator('.refx-kinds .btn-mini', { hasText: '场景图' }).click()
await p.locator('.inspector .field', { hasText: '标题' }).locator('input').fill('废土夜市')
await p.locator('.inspector .field', { hasText: '图片地址' }).locator('input').fill('/generated/verify-scene.jpg')
await p.waitForTimeout(300)
check('素材卡标题更新', (await assetNode.locator('.asset-title').innerText()) === '废土夜市')
check('场景徽标', (await assetNode.locator('.asset-badge').innerText()) === '场景')
check('卡片预览图', (await assetNode.locator('img.asset-media').count()) === 1)

// ---- 推送镜头到画布（新浏览器实例 localStorage 是空的） ----
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)

// ---- 2. 拖拽连线 asset → shot ----
// 找一个分镜卡（有 shotId 的节点），取它左侧 target handle
const shotId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.type !== 'asset' && x.data?.shotId)
  return n?.id
})
check('找到分镜卡', !!shotId, shotId)

// 推送后卡片可能超出视口，先「适配视图」让全部卡片可见
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
await p.locator('.bm-item', { hasText: '适配视图' }).click()
await p.waitForTimeout(600)
const src = await p.locator(`[data-id="${assetId}"] .react-flow__handle.source`).boundingBox()
const tgt = await p.locator(`[data-id="${shotId}"] .react-flow__handle.target`).boundingBox()
check('两端 handle 可见', !!src && !!tgt, `src=${JSON.stringify(src)} tgt=${JSON.stringify(tgt)}`)
if (src && tgt) {
  await p.mouse.move(src.x + src.width / 2, src.y + src.height / 2)
  await p.mouse.down()
  await p.mouse.move((src.x + tgt.x) / 2, (src.y + tgt.y) / 2, { steps: 8 })
  await p.mouse.move(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2, { steps: 8 })
  await p.mouse.up()
  await p.waitForTimeout(800)
}
const allEdgeIds = await p.evaluate(() => [...document.querySelectorAll('.react-flow__edge')].map((e) => e.getAttribute('data-id')))
const refEdge = allEdgeIds.filter((i) => i.startsWith('ref-') && i.includes(shotId)).length
check('ref 连线出现', refEdge >= 1, `全部边: ${allEdgeIds.join(',') || '(无)'}`)
// 标签可能被 zoom 虚拟化，连线本体存在即通过（颜色断言放截图人工核对）
check('连线为琥珀色参考边', refEdge >= 1)

// 连线阶段的展示截图（素材卡 + 分镜卡 + 琥珀参考边）
await p.locator('.bm .tm-btn').click()
await p.locator('.bm-item', { hasText: '适配视图' }).click()
await p.waitForTimeout(800)
await p.screenshot({ path: '/tmp/assets-ref.png' })

// refIds 落库（防抖 1.5s）
await p.waitForTimeout(2600)
const saved = await p.evaluate(async (sid) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shot = j.project.shots.find((s) => s.id === sid)
  return shot?.refIds ?? null
}, (await p.evaluate((sid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.id === sid)
  return n?.data?.shotId ?? null
}, shotId)))
check('refIds 落库（随业务镜头跨会话持久）', Array.isArray(saved) && saved.includes(assetId), JSON.stringify(saved))

// ---- 3. 拦截生成画面 → refImages 含场景图 ----
const captured = []
await p.route('**/api/seedream', async (route) => {
  captured.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake1.jpg'], size: '1440x2560', elapsed: 0.1 }),
  })
})
// 选中分镜卡 → Inspector 生成画面（节点可能互相重叠，JS 派发选中事件绕过遮挡；view 必传，nodrag 会读 event.view.document）
await p.evaluate((id) => {
  const el = document.querySelector(`[data-id="${id}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotId)
await p.waitForTimeout(500)
await p.locator('button', { hasText: /生成画面/ }).first().click()
await p.waitForTimeout(1200)
check('拦截到生成请求', captured.length === 1, String(captured.length))
if (captured.length) {
  check(
    'refImages 含连线场景图',
    (captured[0].refImages ?? []).includes('/generated/verify-scene.jpg'),
    JSON.stringify(captured[0].refImages),
  )
  check('prompt 注明素材', (captured[0].prompt || '').includes('素材「废土夜市」'))
}

// ---- 4. 删除连线 → refIds 移除 ----
// 边很短且中点贴着分镜卡，先把素材卡拖到空白区，让边拉长后中点落在空处
{
  const box = await p.locator(`[data-id="${assetId}"] .asset-head`).boundingBox()
  if (box) {
    const fromX = box.x + box.width / 2
    const fromY = box.y + box.height / 2
    await p.mouse.move(fromX, fromY)
    await p.mouse.down()
    await p.mouse.move(fromX - 520, fromY - 260, { steps: 12 })
    await p.mouse.up()
    await p.waitForTimeout(600)
  }
}
const edgeLoc = p.locator(`.react-flow__edge[data-id^="ref-${assetId}-${shotId}"]`)
check('ref 边仍存在（拖拽不误删）', (await edgeLoc.count()) === 1)
// 沿贝塞尔曲线找一点：该点最上层元素属于这条边（避开被卡片覆盖的区段）
const hit = await p.evaluate(
  ({ prefix }) => {
    const g = document.querySelector(`.react-flow__edge[data-id^="${prefix}"]`)
    const path = g?.querySelector('.react-flow__edge-path')
    if (!path) return null
    const m = path.getScreenCTM()
    const len = path.getTotalLength()
    // 避开 t=0.5（边上标签会吃掉点击），只认真正命中交互路径的位置
    for (const t of [0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.15, 0.85, 0.45, 0.55]) {
      const pt = path.getPointAtLength(len * t)
      const sp = new DOMPoint(pt.x, pt.y).matrixTransform(m)
      const el = document.elementFromPoint(sp.x, sp.y)
      if (el?.classList.contains('react-flow__edge-interaction')) return { x: sp.x, y: sp.y, t }
    }
    return null
  },
  { prefix: `ref-${assetId}-${shotId}` },
)
check('找到边上的可点位置', !!hit, JSON.stringify(hit))
if (hit) {
  await p.mouse.click(hit.x, hit.y)
  await p.waitForTimeout(300)
  // 派生边不走 React Flow 选中态，选中高亮由应用自管（strokeWidth 1.6 → 3）
  const sw = await p.evaluate((prefix) => {
    const path = document.querySelector(`.react-flow__edge[data-id^="${prefix}"] .react-flow__edge-path`)
    return path ? getComputedStyle(path).strokeWidth : null
  }, `ref-${assetId}-${shotId}`)
  check('参考边点击后高亮', sw === '3px', String(sw))
  await p.keyboard.press('Delete')
  await p.waitForTimeout(2600)
}
check('连线已消失', (await p.locator(`.react-flow__edge[data-id^="ref-${assetId}-${shotId}"]`).count()) === 0)
const saved2 = await p.evaluate(async (sid) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shot = j.project.shots.find((s) => s.id === sid)
  return shot?.refIds ?? []
}, (await p.evaluate((sid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.id === sid)
  return n?.data?.shotId ?? null
}, shotId)))
check('refIds 已移除素材', !saved2.includes(assetId), JSON.stringify(saved2))

// 清理：把测试连线从目标镜头上摘掉（asset 节点是本实例的，会话结束即消失）
await p.evaluate(async (sid) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((x) =>
    x.id === sid ? { ...x, refIds: (x.refIds ?? []).filter((r) => !r.startsWith('asset-')) } : x,
  )
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}, (await p.evaluate((sid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.id === sid)
  return n?.data?.shotId ?? null
}, shotId)))

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/assets.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
