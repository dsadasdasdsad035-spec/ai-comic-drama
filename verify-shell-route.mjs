/**
 * 外壳路由验收：冷启动落大厅、直达链接、非法视图回落概览、不存在项目回落大厅、
 * 返回键、重复导航不重复 push、按项目记住上次视图、返回大厅不改项目数据。
 *
 * 跑法：node verify-shell-route.mjs
 */
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import path from 'node:path'

const PORT = 5352
const check = createCheck()
const PROJECTS = makeProjectsDir('shell-route-')
const ONE = 'route-one'
const TWO = 'route-two'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(ONE)}, { title: '路线项目' })
writeProject(root, ${JSON.stringify(ONE)}, {
  style: '赛博朋克',
  aspect: '9:16',
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'a', keyframe_prompt: 'a', video_prompt: 'v' },
    { id: 'E01-S02', episode: 1, no: 'S02', seconds: 2.5, desc: 'b', keyframe_prompt: 'b', video_prompt: 'v' },
    { id: 'E02-S01', episode: 2, no: 'S01', seconds: 4, desc: 'c', keyframe_prompt: 'c', video_prompt: 'v' },
  ],
})
createProject(root, ${JSON.stringify(TWO)}, { title: '空项目' })
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const pageErrors = []
const requested = []
let bad = 0
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } })
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/project?name=')) requested.push(u)
  })

  const hash = () => page.evaluate(() => window.location.hash)
  const hubVisible = async () => (await page.locator('.hub').count()) > 0 && (await page.locator('.rail').count()) === 0
  const openCard = async (name) => {
    await page.locator(`[data-hub-card="${name}"] .hub-card-hit`).click()
    await page.locator('.rail').waitFor({ timeout: 15000 })
  }

  // 1) 冷启动：大厅、不自动加载项目、地址规范成 #/
  await page.goto(`${app}/`, { waitUntil: 'networkidle' })
  await page.locator('.hub').waitFor({ timeout: 20000 })
  check('冷启动落项目大厅', await hubVisible())
  check('冷启动规范成 #/', (await hash()) === '#/', await hash())
  check('冷启动不加载任何项目', requested.length === 0, String(requested.length))
  check('冷启动不渲染工作区左栏', (await page.locator('.rail').count()) === 0)
  check('大厅显示项目卡片', (await page.locator('[data-hub-card]').count()) === 2)

  // 2) 非法路径与不存在的项目都回落大厅
  await page.evaluate(() => {
    window.location.hash = '#/p'
  })
  await page.waitForTimeout(400)
  check('非法 hash 回落大厅', await hubVisible(), await hash())
  await page.goto(`${app}/#/p/not-a-project/board`, { waitUntil: 'networkidle' })
  await page.locator('.hub').waitFor({ timeout: 15000 })
  check('不存在的项目回落大厅', await hubVisible(), await hash())
  check('回落大厅不改写为已删项目', (await hash()) === '#/', await hash())

  // 3) 无历史视图 → 概览
  await openCard(ONE)
  check('打开项目落到概览', (await hash()) === `#/p/${ONE}/overview`, await hash())
  check('概览一屏可见', (await page.locator('.ov').count()) === 1)
  const crumbs = await page.locator('.crumbs').innerText()
  check('面包屑显示项目与视图', crumbs.includes('路线项目') && crumbs.includes('概览'), crumbs.replace(/\n/g, ' / '))

  // 4) 直达链接 + 非法视图回落概览
  await page.goto(`${app}/#/p/${ONE}/chars`, { waitUntil: 'networkidle' })
  await page.locator('.rail').waitFor({ timeout: 15000 })
  check('直达角色视图', (await page.getByRole('button', { name: '角色', exact: true }).getAttribute('aria-current')) === 'page')
  await page.goto(`${app}/#/p/${ONE}/prompts`, { waitUntil: 'networkidle' })
  await page.locator('.ov').waitFor({ timeout: 15000 })
  check('未知视图回落概览', (await page.locator('.ov').count()) === 1)
  check('未知视图不改写 hash', (await hash()) === `#/p/${ONE}/prompts`, await hash())

  // 5) 返回键：大厅 → 项目 → 返回
  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })
  await openCard(ONE)
  await page.goBack()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  check('返回键回到大厅', await hubVisible(), await hash())
  await page.goForward()
  await page.locator('.rail').waitFor({ timeout: 15000 })
  check('前进键回到项目', (await hash()).startsWith(`#/p/${ONE}/`), await hash())

  // 6) 重复导航不重复 push
  const beforeLen = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(600)
  const afterFirst = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(400)
  const afterSecond = await page.evaluate(() => history.length)
  check('首次切视图产生一条历史', afterFirst === beforeLen + 1, `${beforeLen} → ${afterFirst}`)
  check('重复点击同一视图不重复 push', afterSecond === afterFirst, `${afterFirst} → ${afterSecond}`)

  // 7) 记住上次视图（按项目）
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.rail').waitFor({ timeout: 15000 })
  check('刷新后回到上次视图', (await hash()) === `#/p/${ONE}/chars`, await hash())
  await page.locator('.crumb-hub').click()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  await openCard(ONE)
  check('从大厅重开恢复上次视图', (await hash()) === `#/p/${ONE}/chars`, await hash())
  // 没有历史：清掉该项目的记录，再打开必须落概览
  await page.evaluate(() => localStorage.removeItem('sb.lastView.route-one'))
  await page.locator('.crumb-hub').click()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  await openCard(ONE)
  check('清除记录后打开落概览', (await hash()) === `#/p/${ONE}/overview`, await hash())

  // 8) 视图不串项目：切到空项目不带上一个项目的视图
  await page.evaluate((name) => {
    window.location.hash = `#/p/${name}/overview`
  }, TWO)
  await page.locator('.ov').waitFor({ timeout: 15000 })
  check('另一个项目落在自己的概览', (await hash()) === `#/p/${TWO}/overview`, await hash())

  // 9) 返回大厅不改项目数据
  const before = await page.evaluate(async () => (await (await fetch('/api/project?name=route-one')).json()).project)
  await page.locator('.crumb-hub').click()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  const after = await page.evaluate(async () => (await (await fetch('/api/project?name=route-one')).json()).project)
  check('返回大厅不改项目数据', JSON.stringify(before) === JSON.stringify(after))

  check('页面无脚本错误', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
} catch (e) {
  console.error('❌ 验收脚本异常：', e)
  bad++
} finally {
  await browser.close()
  stop()
}

bad += check.bad()
console.log(bad === 0 ? '\n全部通过' : `\n失败 ${bad} 项`)
process.exit(bad === 0 ? 0 : 1)
