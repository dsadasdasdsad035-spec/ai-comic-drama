/**
 * 连线单击菜单回归：画布连线无标签、单击线身弹菜单、右击不弹菜单、关系单选、
 * 转场设置入口、正在编辑的边高亮、贴边翻面、菜单删除连线（镜头数据不变）。
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
  clip: '/videos/edge-menu-placeholder.mp4',
  prod_kind: 'video',
  keyframe_prompt: '',
  dialogue: '',
  cast: [],
  handEdited: [],
})
const edgePathDash = async () =>
  (await page.locator(`${edgeSel} .react-flow__edge-path`).count()) > 0
    ? await page.locator(`${edgeSel} .react-flow__edge-path`).first().evaluate((el) => getComputedStyle(el).strokeDasharray)
    : ''
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

// 画布不再有标签，关系与状态一律读边上的类名（edge-rel-* / edge-state-*）
const edgeSel = '.react-flow__edge-shot'
const interactionSel = `${edgeSel} .react-flow__edge-interaction`
const edgeClass = async () =>
  (await page.locator(edgeSel).count()) > 0
    ? (await page.locator(edgeSel).first().getAttribute('class')) ?? ''
    : ''
const relationOf = async () => (await edgeClass()).match(/edge-rel-(\w+)/)?.[1] ?? ''
const ctxMenuCount = () => page.locator('.ctx-menu--edge').count()
const headText = async () =>
  (await ctxMenuCount()) > 0 ? (await page.locator('.ctx-head').first().innerText()).trim() : ''
/** 单击线身：React Flow 的 20px 交互条，坐标直接决定菜单落点 */
const clickEdge = async (x = 700, y = 420) => {
  await page.locator(interactionSel).first().dispatchEvent('click', { clientX: x, clientY: y })
  await page.waitForTimeout(400)
}
const closeMenu = async () => {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
}

// 大厅是唯一入口：先按 hash 打开被 mock 的项目，再进画布
await page.goto(`${APP_URL.replace(/\/$/, '')}/#/`, { waitUntil: 'domcontentloaded' })
const edgeProjectName = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/project')
    const d = await r.json()
    return (d.projects || [])[0]?.name || ''
  } catch {
    return ''
  }
})
if (edgeProjectName) {
  await page.evaluate((n) => {
    window.location.hash = `#/p/${encodeURIComponent(n)}/board`
  }, edgeProjectName)
}
await page.locator('.rail').waitFor({ timeout: 20000 })
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1800)

check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
check('画布上没有任何连线标签', (await page.locator('.edge-chip').count()) === 0)
const edgeId = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1:edge-menu-e2e') || '{}')
  return (s.edges || []).find((e) => !e.id.startsWith('ref-'))?.id ?? null
})
check('找到分镜顺序连线', !!edgeId, String(edgeId))
check('初始关系为硬切', (await relationOf()) === 'cut', await edgeClass())

// 单击线身 → 菜单
await clickEdge()
check('单击线身弹出关系菜单', (await ctxMenuCount()) === 1)
check('四个关系单选齐全', (await page.locator('.ctx-radio-row').count()) === 4)
check('当前值打点', (await page.locator('.ctx-radio-row.on[data-edge-rel="cut"]').count()) === 1)
check('头部带接缝摘要', (await headText()).includes('直接拼接'), await headText())
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-01-open.png') })

// 点关系：菜单不关，关系跟着变
await page.locator('.ctx-radio-row[data-edge-rel="flashback"] .ctx-main').click()
await page.waitForTimeout(400)
check('点关系后菜单不关闭', (await ctxMenuCount()) === 1)
check('关系切到闪回', (await relationOf()) === 'flashback', await edgeClass())
check('打点跟随', (await page.locator('.ctx-radio-row.on[data-edge-rel="flashback"]').count()) === 1)
await closeMenu()
check('Esc 关闭菜单', (await ctxMenuCount()) === 0)
check('关闭菜单后关系仍是闪回', (await relationOf()) === 'flashback', await edgeClass())

// 右击不再是入口，也不弹浏览器原生菜单（页面里没有 dialog 说明拦截生效）
await page.locator(interactionSel).first().dispatchEvent('contextmenu', { clientX: 700, clientY: 420 })
await page.waitForTimeout(400)
check('右击连线不弹菜单', (await ctxMenuCount()) === 0)

// 单击进入转场 → 转场设置
await clickEdge()
await page.locator('.ctx-radio-row[data-edge-rel="transition"] .ctx-main').click()
await page.waitForTimeout(700)
check('落到转场 → 默认叠化 0.5s', (await headText()).includes('叠化 0.5s'), await headText())
check('边类名已切到转场', (await relationOf()) === 'transition', await edgeClass())
check(
  '双出片转场为实线',
  ['none', ''].includes(String(await edgePathDash())),
  await edgePathDash(),
)
await page.locator('.ctx-menu .ctx-actions button', { hasText: '转场设置' }).click()
await page.waitForTimeout(500)
check('菜单关闭', (await ctxMenuCount()) === 0)
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

// 贴边翻面：在视口右下角单击线身，菜单也不能出视口
await clickEdge(1500, 900)
const mbox = await page.locator('.ctx-menu--edge').boundingBox()
check(
  '菜单不出视口',
  Boolean(mbox) && mbox.x >= 0 && mbox.y >= 0 && mbox.x + mbox.width <= 1560 && mbox.y + mbox.height <= 940,
  JSON.stringify(mbox),
)
await page.screenshot({ path: path.join(shotsDir, 'edge-menu-03-flip.png') })

// 回到硬切（不触发删除确认）
await page.locator('.ctx-radio-row[data-edge-rel="cut"] .ctx-main').click()
await page.waitForTimeout(300)
await closeMenu()

// 键盘 Delete 不再能删边（selectable=false），仍能删节点
await clickEdge()
await page.keyboard.press('Delete')
await page.waitForTimeout(500)
check('键盘 Delete 不删边', (await page.locator(edgeSel).count()) === 1)
await closeMenu()

await clickEdge()
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

// 旧项目：接缝只在镜头数据里（画布 localStorage 为空），水合出的线要能读出当前关系
state.project.shots[0].transition_out = {
  to: 'T2',
  mode: 'effect',
  effect: { type: 'dissolve', seconds: 0.5 },
}
await page.evaluate(() => localStorage.removeItem('storyboard-canvas-v1:edge-menu-e2e'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('旧项目水合出转场线', (await relationOf()) === 'transition', await edgeClass())
await clickEdge()
check('菜单显示当前关系为转场', (await page.locator('.ctx-radio-row.on[data-edge-rel="transition"]').count()) === 1)
check('菜单头部标明参与成片', (await headText()).includes('已参与成片'), await headText())
await closeMenu()
check('旧项目 transition_out 未被改写', state.project.shots[0].transition_out?.mode === 'effect')
await browser.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
