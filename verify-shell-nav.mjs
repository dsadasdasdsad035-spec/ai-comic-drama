/**
 * 左栏导航验收：展开 240 / 折叠 64、`[` 快捷键、画布窄屏自动折叠、手动优先、
 * 项目块菜单（最近项目 / 新建 / 管理 / 返回大厅）与 Esc 归还焦点。
 *
 * 跑法：node verify-shell-nav.mjs
 */
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import path from 'node:path'

const PORT = 5353
const check = createCheck()
const PROJECTS = makeProjectsDir('shell-nav-')
const A = 'nav-a'
const B = 'nav-b'
const C = 'nav-c'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
const shot = (id, ep = 1) => ({ id, episode: ep, no: Number(id.split('-').pop()), seconds: 3, desc: id, keyframe_prompt: id, video_prompt: 'v' })
createProject(root, ${JSON.stringify(A)}, { title: '导航甲' })
writeProject(root, ${JSON.stringify(A)}, { shots: [shot('E01-S01'), shot('E01-S02'), shot('E02-S01', 2)], characters: [{ id: 'c1', name: '甲' }] })
createProject(root, ${JSON.stringify(B)}, { title: '导航乙' })
createProject(root, ${JSON.stringify(C)}, { title: '导航丙' })
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = []
let bad = 0
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } })
  page.on('pageerror', (e) => errors.push(String(e)))

  const railWidth = () => page.locator('.rail').evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const collapsed = async () => (await page.locator('.rail').getAttribute('data-collapsed')) === 'true'
  const manual = () => page.evaluate(() => localStorage.getItem('sb.railCollapsed'))

  // 1) 展开 / 折叠 / 快捷键
  await page.goto(`${app}/#/p/${A}/board`, { waitUntil: 'networkidle' })
  await page.locator('.rail').waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)
  check('1500px 画布默认展开左栏', !(await collapsed()) && (await railWidth()) === 240, String(await railWidth()))

  await page.locator('.rail-collapse').click()
  await page.waitForTimeout(350)
  check('点击折叠到 64px', (await collapsed()) && (await railWidth()) === 64, String(await railWidth()))
  check('折叠状态写入 sb.railCollapsed', (await manual()) === '1', String(await manual()))
  const labelsHidden = await page.locator('.rail-nav .rail-label').first().evaluate((el) => getComputedStyle(el).display)
  const ariaStill = await page.getByRole('button', { name: '画布', exact: true }).getAttribute('aria-label')
  check('折叠后标签退出布局', labelsHidden === 'none', labelsHidden)
  check('折叠后仍保留可访问名', ariaStill === '画布', String(ariaStill))

  await page.locator('body').click({ position: { x: 700, y: 500 } })
  await page.keyboard.press('[')
  await page.waitForTimeout(350)
  check('快捷键 [ 展开', !(await collapsed()) && (await manual()) === '0', String(await manual()))

  // 输入框里按 [ 不应折叠
  await page.evaluate(() => {
    const i = document.createElement('input')
    i.id = '__rail_probe'
    document.body.appendChild(i)
    i.focus()
  })
  await page.keyboard.press('[')
  await page.waitForTimeout(300)
  const afterTyping = await collapsed()
  await page.evaluate(() => document.getElementById('__rail_probe')?.remove())
  check('输入框内 [ 不触发折叠', afterTyping === false)

  // 2) 画布窄屏自动折叠；手动优先
  await page.evaluate(() => localStorage.removeItem('sb.railCollapsed'))
  await page.setViewportSize({ width: 1280, height: 900 })
  // 手动状态在 React state 里，清 localStorage 后必须重载才会按自动规则计算
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.rail').waitFor({ timeout: 20000 })
  await page.waitForTimeout(500)
  check('1280px 画布自动折叠', await collapsed(), String(await railWidth()))
  await page.locator('.rail-collapse').click()
  await page.waitForTimeout(400)
  check('手动展开后不再自动折叠', !(await collapsed()), String(await railWidth()))
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForTimeout(500)
  check('手动展开在窗口变化后仍生效', !(await collapsed()))

  // 3) <900 强制折叠且不可展开
  await page.setViewportSize({ width: 880, height: 900 })
  await page.waitForTimeout(500)
  check('窄屏强制折叠', await collapsed())
  await page.locator('.rail-collapse').click()
  await page.waitForTimeout(300)
  check('窄屏下折叠按钮不生效', await collapsed())

  // 4) 项目块菜单
  await page.setViewportSize({ width: 1500, height: 960 })
  await page.waitForTimeout(400)
  await page.locator('[data-project-menu]').click()
  await page.locator('[data-project-menu-panel]').waitFor({ timeout: 5000 })
  const items = await page.locator('[data-project-menu-panel] [role="menuitem"]').allInnerTexts()
  check(
    '菜单含最近项目 / 新建 / 管理 / 返回大厅',
    (await page.locator('[data-project-recent]').count()) >= 1 &&
      (await page.locator('[data-project-new]').count()) === 1 &&
      (await page.locator('[data-project-manage]').count()) === 1 &&
      (await page.locator('[data-project-hub]').count()) === 1,
    items.join(' / '),
  )
  check(
    '最近项目最多 5 个且不含当前项目',
    (await page.locator('[data-project-recent]').count()) <= 5 &&
      (await page.locator(`[data-project-recent="${A}"]`).count()) === 0,
  )
  check('菜单打开时按钮 aria-expanded=true', (await page.locator('[data-project-menu]').getAttribute('aria-expanded')) === 'true')

  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  check('Esc 关闭菜单', (await page.locator('[data-project-menu-panel]').count()) === 0)
  const focusBack = await page.evaluate(() => document.activeElement?.hasAttribute('data-project-menu') === true)
  check('Esc 关闭后焦点回到项目块', focusBack)

  // 5) 最近项目点选切项目
  await page.locator('[data-project-menu]').click()
  await page.locator(`[data-project-recent="${B}"]`).click()
  await page.waitForTimeout(800)
  check('最近项目切换到目标项目', (await page.evaluate(() => window.location.hash)).includes(`#/p/${B}/`), await page.evaluate(() => window.location.hash))
  check('项目块显示新项目', (await page.locator('.rail-project-name').innerText()).includes(B))

  // 6) 返回大厅
  await page.locator('[data-project-menu]').click()
  await page.locator('[data-project-hub]').click()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  check('菜单可返回大厅', (await page.evaluate(() => window.location.hash)) === '#/')
  check('返回大厅后不渲染左栏', (await page.locator('.rail').count()) === 0)

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))
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
