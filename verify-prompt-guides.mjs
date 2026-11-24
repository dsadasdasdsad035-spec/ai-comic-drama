/**
 * 提示词写作指南验收（真实 UI，不花额度）。
 *
 * 覆盖：快照结构合法性、facets 全部落在词表内、Tab 渲染、按轴分组、
 * 轴切换、指南切换、正反示范对照、出处链接、四宽度不横向滚动。
 *
 * 跑法：node verify-prompt-guides.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5417
const PROJ = 'guides'
const PROJECTS = makeProjectsDir('verify-prompt-guides-')

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---------------------------------------------------------------- 静态校验
const SNAPSHOT = path.join(root, 'public/presets/prompt-guides/v1.json')
const TAXONOMY = path.join(root, 'public/presets/prompt-taxonomy/v1.json')
unit('快照文件存在', fs.existsSync(SNAPSHOT))

const doc = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'))
const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY, 'utf8'))
const validFacet = new Set()
for (const a of taxonomy.axes) for (const v of a.values) validFacet.add(`${a.id}:${v.id}`)

unit('许可是仅参考', doc.license === 'reference-only', doc.license)
unit('指南条数 > 10', doc.guides.length > 10, `${doc.guides.length} 篇`)
unit('有来源与抓取时间', doc.sources.length > 0 && doc.sources.every((s) => s.url && s.fetchedAt), `${doc.sources.length} 个来源`)

const badFacets = []
for (const g of doc.guides) {
  for (const f of g.facets || []) if (!validFacet.has(f)) badFacets.push(`${g.id}: ${f}`)
}
unit('所有 facets 都在词表内', badFacets.length === 0, badFacets.slice(0, 3).join('; '))

const htmlLeft = doc.guides.filter((g) => /<[a-z][^>]*>/i.test(`${g.body}\n${g.prompt}`))
unit('正文无 HTML 残留', htmlLeft.length === 0, htmlLeft.slice(0, 2).map((g) => g.id).join(', '))

const kinds = doc.guides.reduce((m, g) => {
  const k = g.badPrompt || g.goodPrompt ? 'contrast' : g.settingsText ? 'recipe' : 'variant'
  m[k] = (m[k] || 0) + 1
  return m
}, {})
unit('三种模板都解析出了内容', Object.keys(kinds).length === 3, JSON.stringify(kinds))

const coveredAxis = new Set()
for (const g of doc.guides) for (const f of g.facets || []) coveredAxis.add(f.split(':')[0])
unit('覆盖轴数 >= 10', coveredAxis.size >= 10, `${coveredAxis.size} 个轴`)

// ---------------------------------------------------------------- 起服务
seed(
  PROJECTS,
  `
import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const r = ${JSON.stringify(PROJECTS)}
createProject(r, ${JSON.stringify(PROJ)}, { title: 'Guides' })
writeProject(r, ${JSON.stringify(PROJ)}, { episodes: [], shots: [], characters: [], designs: [] })
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(`${app}/#/p/${PROJ}/assets`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-prompt-guide-tab]', { timeout: 20_000 })
  unit('素材页出现写作指南 Tab', true)

  await page.click('[data-prompt-guide-tab]')
  await page.waitForSelector('[data-prompt-guide-tab-panel]', { timeout: 15_000 })
  await page.waitForSelector('[data-prompt-guide-card]', { timeout: 15_000 })
  unit('Tab 渲染面板', true)

  const axisBtns = page.locator('[data-prompt-guide-axis]')
  const axisN = await axisBtns.count()
  unit('左侧按轴分组', axisN >= 10, `${axisN} 个轴`)
  unit('轴数不超过 18', axisN <= 18, `${axisN}`)

  const cards = page.locator('[data-prompt-guide-card]')
  unit('默认展示某轴的指南', (await cards.count()) > 0, `${await cards.count()} 篇`)

  // 切轴
  const firstAxisKey = await axisBtns.first().getAttribute('data-prompt-guide-axis')
  const second = axisBtns.nth(1)
  const secondAxisKey = await second.getAttribute('data-prompt-guide-axis')
  await second.click()
  await page.waitForTimeout(400)
  const onAxis = await second.evaluate((el) => el.classList.contains('on'))
  unit('点轴后进入选中态', onAxis, secondAxisKey || '')
  unit('点轴后列表切换', (await page.locator('[data-prompt-guide-card]').count()) > 0)
  unit('切轴前有选中的轴', Boolean(firstAxisKey))

  // 详情：默认有内容
  const detail = page.locator('[data-prompt-guide-detail]')
  unit('右侧展示指南详情', (await detail.count()) === 1)
  const detailText = await detail.innerText()
  unit('详情含标题', detailText.length > 30)
  unit('详情标注许可/出处', /原文|仅参考|参考/.test(detailText), detailText.slice(0, 50).replace(/\s+/g, ' '))
  unit('详情展示提示词正文', (await page.locator('[data-prompt-guide-prompt]').count()) === 1)

  // 对照型：正反示范都在
  const contrastCard = page.locator('[data-prompt-guide-card]').filter({ hasText: '对照' }).first()
  if (await contrastCard.count()) {
    await contrastCard.click()
    await page.waitForTimeout(400)
    const t = await page.locator('[data-prompt-guide-detail]').innerText()
    unit('对照型同时给出反面与推荐', /反面示范/.test(t) && /推荐/.test(t))
    unit('反面示范与推荐写法都渲染为代码块', (await page.locator('.guide-pre.is-bad').count()) === 1 && (await page.locator('.guide-pre.is-good').count()) === 1)
  } else {
    // 换个轴继续找
    let found = false
    for (let i = 0; i < Math.min(axisN, 6); i += 1) {
      await axisBtns.nth(i).click()
      await page.waitForTimeout(250)
      const c = page.locator('[data-prompt-guide-card]').filter({ hasText: '对照' }).first()
      if (await c.count()) {
        await c.click()
        await page.waitForTimeout(400)
        const t = await page.locator('[data-prompt-guide-detail]').innerText()
        unit('对照型同时给出反面与推荐', /反面示范/.test(t) && /推荐/.test(t))
        found = true
        break
      }
    }
    if (!found) unit('对照型同时给出反面与推荐', false, '没找到对照型指南')
  }

  // 出处链接可点
  const srcLink = page.locator('[data-prompt-guide-detail] a[href^="https://"]').first()
  unit('详情带外部原文链接', (await srcLink.count()) === 1)

  // 四宽度不横向滚动
  for (const w of [1600, 1280, 900, 390]) {
    await page.setViewportSize({ width: w, height: 1000 })
    await page.waitForTimeout(350)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    unit(`${w}px 无横向滚动`, overflow <= 0, `overflowX=${overflow}`)
  }

  // 案例库 Tab 未受影响
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.click('[data-prompt-case-tab]')
  await page.waitForTimeout(600)
  unit('案例 Tab 仍可切换', (await page.locator('[data-prompt-case-tab-panel]').count()) === 1)
  unit('案例 Tab 未混入指南面板', (await page.locator('[data-prompt-case-tab-panel] [data-prompt-guide-tab-panel]').count()) === 0)

  unit('无未捕获页面异常', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close()
  await stop()
  fs.rmSync(PROJECTS, { recursive: true, force: true })
}

if (bad) {
  console.error(`verify-prompt-guides: ${bad} failed`)
  process.exit(1)
}
console.log('verify-prompt-guides: all green')
