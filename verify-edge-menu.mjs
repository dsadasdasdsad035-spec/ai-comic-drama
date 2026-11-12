/**
 * 连线右键菜单回归：单击不改数据、右击线身/标签弹菜单、关系单选、转场设置入口、
 * 正在编辑的边高亮、贴边翻面、菜单删除连线（镜头数据不变）。
 * 跑法：先 npm run dev，再 node verify-edge-menu.mjs
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const shotsDir = path.join(root, 'openspec', 'changes', 'edge-context-menu', 'evidence')
const APP_URL = 'http://127.0.0.1:5273/'
const IMG1 = '/generated/shot-1792653104009-fe6e05.jpg'
const IMG2 = '/generated/shot-1792635049165-29ec33.jpg'

const mkShot = (id, no, keyframe) => ({
  id,
  episode: 1,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  keyframe,
  keyframe_prompt: '',
  dialogue: '',
  cast: [],
  handEdited: [],
})
const state = {
  project: {
    name: 'edge-menu-e2e',
    aspect: '16:9',
    shots: [mkShot('T1', 'S01', IMG1), mkShot('T2', 'S02', IMG2)],
    characters: [],
    assets: [],
    designs: [],
    episodes: [{ no: 1, title: 'E1' }],
    sceneLayouts: [],
  },
}

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
page.on('dialog', (d) => d.accept())
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
let lastPost = null

await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    lastPost = req.postDataJSON() || {}
    const body = lastPost
    for (const s of body.shots || []) {
      const old = state.project.shots.find((x) => x.id === s.id)
      if (old) Object.assign(old, s)
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: state.project.shots, characters: [] }),
    })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, project: state.project }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      root: '/mock',
      projects: [{ name: state.project.name, title: state.project.name, shots: 2 }],
    }),
  })
})

const chipText = async () => (await page.locator('.edge-chip').first().innerText()).trim()

await page.goto(APP_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
const edgeId = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1:edge-menu-e2e') || '{}')
  return (s.edges || []).find((e) => !e.id.startsWith('ref-'))?.id ?? null
})
check('找到分镜顺序连线', !!edgeId, String(edgeId))
// 水合可能重建边、换掉 id，后续一律按类名找（当前项目只有一条分镜边）
const edgeSel = '.react-flow__edge'

// 单击：不改关系、不开面板
await page.locator('.edge-chip').first().click()
await page.waitForTimeout(400)
check('单击标签不改关系', (await chipText()) === '硬切', await chipText())
await page.locator(`${edgeSel} .react-flow__edge-interaction`).dispatchEvent('click')
await page.waitForTimeout(400)
check('单击线身不开面板', (await page.locator('.tr-panel').count()) === 0)

// 右击线身（React Flow 的宽交互条）→ 菜单
await page
  .locator(`${edgeSel} .react-flow__edge-interaction`)
  .dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(400)
check('右击线身弹出菜单', (await page.locator('.ctx-menu--edge').count()) === 1)
check('四个关系单选齐全', (await page.locator('.ctx-radio-row').count()) === 4)
check('当前值打点', (await page.locator('.ctx-radio-row.on[data-edge-rel="cut"]').count()) === 1)
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-01-open.png') })

// 点关系：菜单不关、chip 同步
await page.locator('.ctx-radio-row[data-edge-rel="flashback"] .ctx-main').click()
await page.waitForTimeout(400)
check('点关系后菜单不关闭', (await page.locator('.ctx-menu--edge').count()) === 1)
check('关系切到闪回', (await chipText()).includes('闪回'), await chipText())
check('打点跟随', (await page.locator('.ctx-radio-row.on[data-edge-rel="flashback"]').count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('Esc 关闭菜单', (await page.locator('.ctx-menu--edge').count()) === 0)

// 右击标签 → 落到转场 → 转场设置
await page.locator('.edge-chip').first().click({ button: 'right' })
await page.waitForTimeout(400)
check('右击标签弹出菜单', (await page.locator('.ctx-menu--edge').count()) === 1)
await page.locator('.ctx-radio-row[data-edge-rel="transition"] .ctx-main').click()
await page.waitForTimeout(700)
check('落到转场 → 默认叠化 0.5s', (await chipText()) === '叠化 0.5s', await chipText())
await page.locator('.ctx-menu .ctx-actions button', { hasText: '转场设置' }).click()
await page.waitForTimeout(500)
check('菜单关闭', (await page.locator('.ctx-menu--edge').count()) === 0)
check('转场面板打开', (await page.locator('.tr-panel').count()) === 1)
const strokeOn = await page
  .locator(`${edgeSel} .react-flow__edge-path`)
  .evaluate((el) => getComputedStyle(el).strokeWidth)
check('正在编辑的边被加粗', parseFloat(strokeOn) > 2, strokeOn)
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-02-panel.png') })

// 关闭面板：高亮复原
await page.locator('.tr-x').click()
await page.waitForTimeout(400)
const strokeOff = await page
  .locator(`${edgeSel} .react-flow__edge-path`)
  .evaluate((el) => getComputedStyle(el).strokeWidth)
check('关闭面板后高亮复原', parseFloat(strokeOff) < 2, strokeOff)

// 贴边翻面：靠右下角右击也不能出视口
const box = await page.locator('.edge-chip').first().boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down({ button: 'right' })
await page.mouse.up({ button: 'right' })
await page.waitForTimeout(400)
const mbox = await page.locator('.ctx-menu--edge').boundingBox()
check(
  '菜单不出视口',
  Boolean(mbox) && mbox.x >= 0 && mbox.y >= 0 && mbox.x + mbox.width <= 1560 && mbox.y + mbox.height <= 940,
  JSON.stringify(mbox),
)
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-03-flip.png') })

// 删除连线：先回到硬切（不触发确认），镜头数据保持不变
await page.locator('.ctx-radio-row[data-edge-rel="cut"] .ctx-main').click()
await page.waitForTimeout(300)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 键盘 Delete 不再能删边（selectable=false），仍能删节点
await page.locator(`${edgeSel} .react-flow__edge-interaction`).dispatchEvent('click')
await page.keyboard.press('Delete')
await page.waitForTimeout(500)
check('键盘 Delete 不删边', (await page.locator(edgeSel).count()) === 1)

await page.locator('.edge-chip').first().click({ button: 'right' })
await page.waitForTimeout(300)
await page.locator('.ctx-foot button', { hasText: '删除连线' }).click()
await page.waitForTimeout(2600)
check('删除后连线消失', (await page.locator(edgeSel).count()) === 0)
check(
  '删除后镜头数据未被写坏',
  !lastPost || !(lastPost.shots || []).some((s) => s.transition_out),
  JSON.stringify((lastPost?.shots || []).map((s) => s.transition_out ?? null)),
)

const nodeBefore = await page.locator('.react-flow__node').count()
await page.locator('.react-flow__node').first().click()
await page.waitForTimeout(300)
await page.keyboard.press('Delete')
await page.waitForTimeout(900)
check('节点仍可用 Delete 删除', (await page.locator('.react-flow__node').count()) === nodeBefore - 1)

check('无 pageerror', errs.length === 0, errs[0] || '')
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-04-deleted.png') })

// 旧项目：接缝只在镜头数据里（画布 localStorage 为空），水合出的线要显示当前关系
state.project.shots[0].transition_out = {
  to: 'T2',
  mode: 'effect',
  effect: { type: 'dissolve', seconds: 0.5 },
}
await page.evaluate(() => localStorage.removeItem('storyboard-canvas-v1:edge-menu-e2e'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('旧项目水合出转场线', (await chipText()) === '叠化 0.5s', await chipText())
await page.locator('.edge-chip').first().click({ button: 'right' })
await page.waitForTimeout(400)
check('菜单显示当前关系为转场', (await page.locator('.ctx-radio-row.on[data-edge-rel="transition"]').count()) === 1)
check('菜单头部标明参与成片', (await page.locator('.ctx-head').innerText()).includes('已参与成片'))
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('旧项目 transition_out 未被改写', state.project.shots[0].transition_out?.mode === 'effect')
await browser.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
