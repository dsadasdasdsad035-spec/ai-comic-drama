/**
 * 剧本中心：书架、检索与排序、阅读框（目录 + 书页）、排版偏好、开发态菜单、画布深链。
 * 跑法：node verify-script-hub.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeProjectsDir, seed, startApp } from './verify-harness.mjs'
const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-script-hub-'))
const esbuild = path.join(root, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const navMod = await import(bundle(path.join(root, 'src/shell/nav.ts'), 'nav'))
const readerMod = await import(bundle(path.join(root, 'src/board/readerPrefs.ts'), 'readerPrefs'))

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

unit('isViewId(script)', navMod.isViewId('script'))
unit('NAV_ITEMS 含剧本', navMod.NAV_ITEMS.some((i) => i.id === 'script'))

// 排版偏好纯函数：默认值
const defaults = readerMod.READER_DEFAULTS
unit('阅读默认衬线 + 两端', defaults.family === 'serif' && defaults.align === 'justify')
unit('字号默认 17 / 行距 2.0', defaults.size === 17 && defaults.leading === 2)

const PORT = 5381
const PROJECTS = makeProjectsDir('script-hub-')
const PROJ = 'script-hub-demo'

// 场次正文要够长：目录跳转依赖纸页真的能滚动，否则第 2 场本来就在视口里
const longBeats =
  '测试对白。雨点砸在青石板上，溅起的水花打湿了灯笼下那一小片光。' +
  '沈砚把伞往门边一靠，抬手推开半掩的木门，屋里的人都停了话头。\\n\\n'.repeat(12)

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: 'ScriptHub' })
writeProject(root, ${JSON.stringify(PROJ)}, {
  episodes: [
    {
      no: 1,
      title: '第一集',
      hook: '一封没有署名的信，把三个陌生人锁进了同一间茶楼。',
      targetSeconds: 90,
      scenes: [
        { no: 1, slug: 'EP001-SC001', space: '内', place: '咖啡厅', time: '日', beats: '${longBeats}' },
        { no: 2, slug: 'EP001-SC002', space: '内', place: '后巷', time: '夜', beats: '${longBeats}' },
      ],
    },
    { no: 2, title: '第二集', targetSeconds: 95, scenes: [] },
  ],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'd', dialogue: [], cast: ['林一'] }],
})
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`${app}/#/p/${PROJ}/script`, { waitUntil: 'networkidle' })
  await page.locator('[data-script-hub][data-script-phase="list"]').waitFor({ timeout: 20000 })
  await page.waitForTimeout(400)

  // ---- 书架 ----
  unit('剧本列表屏', (await page.locator('[data-script-ep-card="1"]').count()) === 1)
  unit('书架 2 本', (await page.locator('[data-script-book]').count()) === 2)
  unit('列表无集下拉', (await page.locator('.epbar-trigger').count()) === 0)
  unit('无首帧走文字封面', (await page.locator('[data-script-book="1"] [data-script-book-cover="text"]').count()) === 1)

  const xs = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      return el ? Math.round(el.getBoundingClientRect().x) : null
    }
    return { bar: pick('[data-script-shelf-bar]'), grid: pick('.script-shelf-grid'), foot: pick('[data-script-shelf-foot]') }
  })
  unit('版心对齐', xs.bar != null && xs.bar === xs.grid && xs.grid === xs.foot, JSON.stringify(xs))

  // hover：真位移 + 阴影伪元素不透明
  const shadowBefore = await page.evaluate(
    () => getComputedStyle(document.querySelector('[data-script-book="1"] .script-book-leaf'), '::after').opacity,
  )
  await page.hover('[data-script-book="1"] .script-book-enter')
  await page.waitForTimeout(280)
  const hovered = await page.evaluate(() => {
    const enter = document.querySelector('[data-script-book="1"] .script-book-enter')
    const leaf = document.querySelector('[data-script-book="1"] .script-book-leaf')
    return { transform: getComputedStyle(enter).transform, shadow: getComputedStyle(leaf, '::after').opacity }
  })
  unit('hover 抬升', hovered.transform.includes('-6'), hovered.transform)
  unit('hover 阴影出现', Number(hovered.shadow) > Number(shadowBefore), `${shadowBefore} -> ${hovered.shadow}`)

  // 检索 / 筛选 / 空态
  await page.fill('[data-script-search]', '咖啡厅')
  await page.waitForTimeout(200)
  unit('按地点检索', (await page.locator('[data-script-book]').count()) === 1)
  await page.fill('[data-script-search]', '林一')
  await page.waitForTimeout(200)
  unit('按角色检索', (await page.locator('[data-script-book]').count()) === 1)
  await page.fill('[data-script-search]', '')
  await page.click('[data-script-filter="missing"]')
  await page.waitForTimeout(200)
  unit('缺剧本筛选', (await page.locator('[data-script-book]').count()) === 1)
  await page.click('[data-script-filter="all"]')
  await page.fill('[data-script-search]', '不存在的关键词')
  await page.waitForTimeout(200)
  unit('无匹配空态', (await page.locator('[data-script-shelf-empty]').count()) === 1)
  await page.fill('[data-script-search]', '')
  await page.waitForTimeout(150)

  // ---- 详情：目录 + 书页 ----
  await page.locator('[data-script-ep-card="1"] .script-book-enter').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(400)
  unit('详情屏', (await page.locator('[data-script-md-preview="script"]').count()) === 1)
  unit('阅读框', (await page.locator('[data-script-reader]').count()) === 1)
  unit('目录项数 = 场次数', (await page.locator('[data-reader-toc-item]').count()) === 2)
  const running = await page.locator('.script-reader-running').innerText()
  unit('页眉含集号与集名', running.includes('E01') && running.includes('第一集'), running.replace(/\n/g, ' / '))
  const foot = await page.locator('.script-reader-running-foot').innerText()
  unit('页脚含进度与百分比', /第\s*1\s*\/\s*2\s*场/.test(foot) && foot.includes('%'), foot.replace(/\n/g, ' / '))
  unit('阅读态不含开发工具条', (await page.locator('[data-md-pane-layout]').count()) === 0)
  unit('源码门禁默认关闭', (await page.locator('[data-md-source]').count()) === 0)

  await page.click('[data-reader-toc-item="2"]')
  await page.waitForTimeout(700)
  unit('目录点击定位', (await page.getAttribute('[data-reader-toc-item="2"]', 'aria-current')) === 'true')

  // 排版
  await page.click('[data-reader-type-toggle]')
  await page.locator('[data-reader-type-panel]').waitFor({ timeout: 10000 })
  await page.click('[data-reader-size="18"]')
  await page.waitForTimeout(200)
  const fs18 = await page.evaluate(() => getComputedStyle(document.querySelector('[data-reader-md]')).fontSize)
  unit('字号可改', fs18 === '18px', fs18)
  await page.click('[data-reader-align-btn="left"]')
  await page.waitForTimeout(150)
  const alignLeft = await page.evaluate(() => getComputedStyle(document.querySelector('[data-reader-md] p')).textAlign)
  unit('对齐可切左', alignLeft === 'left', alignLeft)
  await page.click('[data-reader-align-btn="justify"]')
  await page.keyboard.press('Escape')

  // 开发态收进 ⋯
  await page.click('[data-script-more-toggle]')
  await page.locator('[data-script-more-menu]').waitFor({ timeout: 10000 })
  await page.click('[data-script-more-menu] button:has-text("源码编辑")')
  await page.locator('[data-md-source]').waitFor({ timeout: 10000 })
  unit('源码 CodeMirror', (await page.locator('[data-md-source] .cm-editor').count()) === 1)
  unit('源码带布局属性', (await page.getAttribute('[data-md-pane-layout]', 'data-md-pane-layout')) === 'source')
  await page.click('[data-script-more-toggle]')
  await page.click('[data-script-menu-renderer="marked-html"]')
  unit('marked HTML 渲染引擎', (await page.getAttribute('[data-md-pane-renderer]', 'data-md-pane-renderer')) === 'marked-html')
  await page.click('[data-script-back-to-reading]')
  await page.locator('[data-script-reader]').waitFor({ timeout: 10000 })

  // 刷新后偏好仍生效（详情是应用 state，刷新回书架后重新进入）
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-script-book="1"] .script-book-enter').click()
  await page.locator('[data-script-reader]').waitFor({ timeout: 15000 })
  const persisted = await page.evaluate(() => getComputedStyle(document.querySelector('[data-reader-md]')).fontSize)
  unit('排版偏好持久化', persisted === '18px', persisted)

  await page.click('[data-script-preview-tab="shots"]')
  await page.waitForTimeout(300)
  unit('分镜 tab', (await page.locator('[data-script-md-preview="shots"]').count()) === 1)

  // 返回书架：选中态 + 上次读到
  await page.click('.script-hub-back')
  await page.locator('[data-script-phase="list"]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  unit('返回后选中态', (await page.getAttribute('[data-script-book="1"]', 'aria-current')) === 'true')
  unit('返回后显示上次读到', (await page.locator('[data-script-book="1"] .script-book-last').count()) === 1)

  await page.goto(`${app}/#/p/${PROJ}/board`, { waitUntil: 'networkidle' })
  await page.locator('[data-board-phase="episodes"]').waitFor({ timeout: 15000 })
  unit('画布目录无 data-board-import-script', (await page.locator('[data-board-import-script]').count()) === 0)

  await page.locator('[data-board-view-script="1"]').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  unit('画布看剧本进详情', (await page.locator('[data-script-ep="1"]').count()) === 1)

  await page.goto(`${app}/#/p/${PROJ}/board`, { waitUntil: 'networkidle' })
  await page.locator('[data-board-ep="1"]').click()
  await page.locator('[data-board-phase="canvas"]').waitFor({ timeout: 15000 })
  await page.locator('[data-board-ep-label].ep-chip-script').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15000 })
  unit('单集画布 chip 进剧本', (await page.locator('[data-script-md-preview="script"]').count()) === 1)
} finally {
  await browser.close()
  await stop()
}

if (bad) {
  console.error(`verify-script-hub: ${bad} failed`)
  process.exit(1)
}
console.log('verify-script-hub: all green')
