/**
 * 剧本书页阅读模式的浏览器验收（真实 UI，不花额度）。
 *
 * 覆盖：书页渲染、场次目录、排版偏好持久化、四套纸张主题、
 * mermaid 渲染与白名单降级、宽图内滚、脚本注入防护、reduced-motion。
 *
 * 跑法：node verify-script-reader.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-script-reader-'))
const PORT = 5411
const PROJ = 'reader'
const PROJECTS = makeProjectsDir('verify-script-reader-projects-')

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 三段场次：第二段带一个 mermaid 流程图，第三段带一个白名单外类型 */
const BEATS_2 = [
  '林晚推门进来，雨声灌了满屋。',
  '',
  '```mermaid',
  'flowchart TD',
  '  A[进门] --> B{看见谁}',
  '  B -->|是她| C[转身]',
  '  B -->|不是| D[坐下]',
  '```',
  '',
  '她停在门口没有动。',
].join('\n')

const BEATS_3 = [
  '收尾。',
  '',
  '```mermaid',
  'mindmap',
  '  root((中心))',
  '    分支一',
  '```',
  '',
  '一句话结束。',
].join('\n')

const BEATS_1 = [
  '第一场正文。',
  '',
  '#### 用户自己写的小标题',
  '',
  '小标题之后还有一段。',
].join('\n')

seed(
  PROJECTS,
  `
import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: 'Reader' })
writeProject(root, ${JSON.stringify(PROJ)}, {
  episodes: [{
    no: 1,
    title: '雨夜访客',
    scenes: [
      { no: 1, slug: 'EP001-SC001', space: '内', place: '旧公寓', time: '夜', beats: ${JSON.stringify(BEATS_1)} },
      { no: 2, slug: 'EP001-SC002', space: '内', place: '客厅', time: '夜', beats: ${JSON.stringify(BEATS_2)} },
      { no: 3, slug: 'EP001-SC003', space: '外', place: '楼梯间', time: '深夜', beats: ${JSON.stringify(BEATS_3)} },
    ],
  }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'd', dialogue: [], cast: [] }],
})
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${app}/#/p/${PROJ}/script`, { waitUntil: 'networkidle' })
  await page.locator('[data-script-hub][data-script-phase="list"]').waitFor({ timeout: 20_000 })

  await page.locator('[data-script-ep-card="1"] .script-book-enter').click()
  await page.locator('[data-script-phase="detail"]').waitFor({ timeout: 15_000 })
  await page.waitForSelector('[data-script-reader]', { timeout: 15_000 })

  // ---- 书页结构 ----
  unit('书页渲染', (await page.locator('[data-script-reader-page]').count()) === 1)
  unit('书页内含正文', (await page.locator('.reader-md').count()) === 1)
  const runningText = await page.locator('.script-reader-running').innerText()
  unit('页眉含集号', /EP001|第\s*1\s*集/.test(runningText), runningText.replace(/\s+/g, ' ').slice(0, 40))
  unit('页眉含集名', runningText.includes('雨夜访客'))
  const footText = await page.locator('.script-reader-running-foot').innerText()
  unit('页脚含场次进度', /第\s*\d+\s*\/\s*3\s*场/.test(footText), footText.replace(/\s+/g, ' '))
  unit('页脚含百分比', /%/.test(footText))

  // ---- 场次目录 ----
  const tocItems = page.locator('[data-reader-toc-item]')
  unit('目录项数等于场次数', (await tocItems.count()) === 3, `${await tocItems.count()} 项`)
  unit('目录首项为当前项', (await page.locator('[data-reader-toc-item="1"]').getAttribute('aria-current')) === 'true')

  // 点第三场：滚动 + 高亮
  await page.locator('[data-reader-toc-item="3"]').click()
  await page.waitForTimeout(700)
  unit('点目录后当前项切到第 3 场', (await page.locator('[data-reader-toc-item="3"]').getAttribute('aria-current')) === 'true')
  const footAfter = await page.locator('[data-script-reader-page]').evaluate((el) => el.scrollTop)
  unit('点目录后书页发生滚动', footAfter > 0, `scrollTop=${footAfter}`)

  // ---- 锚点不错位（beats 里有 h4 小标题时） ----
  const anchors = await page.evaluate(() =>
    [...document.querySelectorAll('.reader-md h2[data-reader-scene]')].map((h) => ({
      scene: h.dataset.readerScene,
      id: h.id,
    })),
  )
  unit('三个场次标题各自有锚点', anchors.length === 3, JSON.stringify(anchors.map((a) => a.scene)))
  unit('锚点按场次而非顺序编号', anchors.map((a) => a.scene).join(',') === '1,2,3', JSON.stringify(anchors))

  // ---- mermaid ----
  await page.waitForTimeout(2500)
  const diagrams = page.locator('[data-md-diagram] svg')
  unit('流程图渲染成 SVG', (await diagrams.count()) >= 1, `${await diagrams.count()} 个`)
  const unsupported = page.locator('[data-md-diagram-unsupported]')
  unit('白名单外类型降级为代码块', (await unsupported.count()) === 1)
  const unsupportedText = await unsupported.first().innerText()
  unit('降级块说明不支持原因', /不支持/.test(unsupportedText), unsupportedText.replace(/\s+/g, ' ').slice(0, 60))

  // 注入防护：脚本标签不得进入 DOM
  const injected = await page.evaluate(() =>
    [...document.querySelectorAll('.reader-md script, .reader-md [onerror], .reader-md [onclick]')].length,
  )
  unit('正文内无活动脚本节点', injected === 0, `${injected} 个`)

  // ---- 宽图内滚 ----
  const diagramScroll = await page.evaluate(() => {
    const el = document.querySelector('[data-md-diagram]')
    if (!el) return null
    return { overflowX: getComputedStyle(el).overflowX, clientW: el.clientWidth, scrollW: el.scrollWidth }
  })
  unit('图表容器允许横向滚动', diagramScroll?.overflowX === 'auto', JSON.stringify(diagramScroll))
  const pageWidth = await page.locator('[data-script-reader-page]').evaluate((el) => el.clientWidth)
  unit('书页版心不被图表撑宽', pageWidth > 0 && pageWidth < 1200, `${pageWidth}px`)

  // 点击图表放大
  if ((await diagrams.count()) > 0) {
    await page.locator('[data-md-diagram]').first().click()
    await page.waitForTimeout(400)
    unit('点击图表打开大图', (await page.locator('.md-diagram-zoom').count()) === 1)
    await page.locator('.md-diagram-zoom').first().click({ position: { x: 10, y: 10 } })
    await page.waitForTimeout(300)
    unit('关闭大图', (await page.locator('.md-diagram-zoom').count()) === 0)
  }

  // ---- 排版菜单与主题 ----
  await page.locator('[data-reader-type-toggle]').click()
  await page.waitForSelector('[data-reader-type-panel]', { timeout: 5_000 })
  unit('排版菜单打开', true)

  const sizeBefore = await page.locator('.reader-md').evaluate((el) => getComputedStyle(el).fontSize)
  await page.locator('[data-reader-size="18"]').click()
  await page.waitForTimeout(300)
  const sizeAfter = await page.locator('.reader-md').evaluate((el) => getComputedStyle(el).fontSize)
  unit('改字号立即生效', sizeBefore !== sizeAfter && sizeAfter === '18px', `${sizeBefore} -> ${sizeAfter}`)

  for (const theme of ['paper', 'parchment', 'ink', 'terminal']) {
    await page.locator(`[data-reader-theme-btn="${theme}"]`).click()
    await page.waitForTimeout(250)
    const applied = await page.locator('[data-script-reader]').getAttribute('data-reader-theme')
    unit(`纸张主题可切：${theme}`, applied === theme, applied || '(无)')
  }

  // 对比度：正文 vs 纸张
  const contrast = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/\d+(\.\d+)?/g)
      if (!m) return 0
      const [r, g, b] = m.slice(0, 3).map(Number)
      const f = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const body = document.querySelector('.reader-md')
    const pageEl = document.querySelector('[data-script-reader-page]')
    if (!body || !pageEl) return null
    const fg = lum(getComputedStyle(body).color)
    const bg = lum(getComputedStyle(pageEl).backgroundColor)
    const hi = Math.max(fg, bg)
    const lo = Math.min(fg, bg)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10
  })
  unit('当前主题正文对比度 ≥4.5', (contrast ?? 0) >= 4.5, `${contrast}:1`)

  // 主题切换后图表重绘（配色不沿用旧主题）
  await page.waitForTimeout(2000)
  const svgCountAfter = await page.locator('[data-md-diagram] svg').count()
  unit('切主题后图表仍渲染', svgCountAfter >= 1, `${svgCountAfter} 个`)

  // ---- 偏好持久化 ----
  await page.locator('[data-reader-theme-btn="parchment"]').click()
  await page.locator('[data-reader-size="16"]').click()
  await page.waitForTimeout(300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-script-ep-card="1"] .script-book-enter').click()
  await page.waitForSelector('[data-script-reader]', { timeout: 15_000 })
  const persisted = await page.locator('[data-script-reader]').getAttribute('data-reader-theme')
  const persistedSize = await page.locator('.reader-md').evaluate((el) => getComputedStyle(el).fontSize)
  unit('刷新后纸张主题保持', persisted === 'parchment', persisted || '')
  unit('刷新后字号保持', persistedSize === '16px', persistedSize)

  // ---- reduced motion ----
  const rmPage = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await rmPage.goto(`${app}/#/p/${PROJ}/script`, { waitUntil: 'networkidle' })
  await rmPage.locator('[data-script-ep-card="1"] .script-book-enter').click()
  await rmPage.waitForSelector('[data-script-reader]', { timeout: 15_000 })
  const rmAnim = await rmPage.evaluate(() => getComputedStyle(document.querySelector('[data-script-reader-page]')).scrollBehavior)
  unit('reduced-motion 下取消平滑滚动', rmAnim === 'auto', rmAnim)
  await rmPage.close()

  // ---- 分镜 tab 不套书页 ----
  await page.locator('[data-script-preview-tab="shots"]').click()
  await page.waitForTimeout(600)
  unit('分镜 tab 用表格预览', (await page.locator('[data-script-md-preview="shots"]').count()) === 1)
  unit('分镜 tab 不渲染书页', (await page.locator('[data-script-reader-page]').count()) === 0)
  const shotsBg = await page.locator('.script-md-preview').evaluate((el) => getComputedStyle(el).backgroundColor)
  unit('分镜页使用纸张配色', shotsBg !== 'rgba(0, 0, 0, 0)', shotsBg)

  unit('无未捕获页面异常', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await stop()
  fs.rmSync(outDir, { recursive: true, force: true })
}

if (bad) {
  console.error(`verify-script-reader: ${bad} failed`)
  process.exit(1)
}
console.log('verify-script-reader: all green')
