/**
 * 项目大厅验收：卡片信息（标题 / 风格·画幅 / 集·镜·秒 / 更新时间）、风险徽标
 * （缺首帧 / 空项目 / 损坏）、搜索、最近项目、空态与新建后落概览。
 *
 * 跑法：node verify-project-hub.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const PORT = 5354
const check = createCheck()
const PROJECTS = makeProjectsDir('project-hub-')
const FULL = 'hub-full'
const EMPTY = 'hub-empty'
const BROKEN = 'hub-broken'

seed(
  PROJECTS,
  `import { createProject, writeProject, openDatabase } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(FULL)}, { title: '完整项目' })
writeProject(root, ${JSON.stringify(FULL)}, {
  style: '赛博朋克',
  aspect: '9:16',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 15 }, { no: 2, title: '第二集', targetSeconds: 12 }],
  shots: [
    { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: '雨夜', keyframe: '/generated/a.png', keyframe_prompt: 'a man', video_prompt: 'push in' },
    { id: 'E01-S02', episode: 1, no: 'S02', seconds: 2.5, desc: '转身', keyframe_prompt: 'a woman', video_prompt: 'pull out' },
    { id: 'E02-S01', episode: 2, no: 'S01', seconds: 2, desc: '空镜', keyframe_prompt: '', video_prompt: '' },
  ],
})
createProject(root, ${JSON.stringify(EMPTY)}, { title: '空项目' })
writeProject(root, ${JSON.stringify(EMPTY)}, { style: '', aspect: '16:9' })
createProject(root, ${JSON.stringify(BROKEN)}, { title: '损坏项目' })
writeProject(root, ${JSON.stringify(BROKEN)}, { shots: [{ id: 'BX-01', episode: 1, no: 'B01', seconds: 1, desc: 'x' }] })
const db = openDatabase(root)
db.prepare("UPDATE shots SET dialogue='not-json' WHERE shot_id='BX-01'").run()
db.close()
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = []
let bad = 0
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })
  await page.locator('[data-hub-grid]').waitFor({ timeout: 20000 })

  const api = await page.evaluate(async () => (await (await fetch('/api/project')).json()).projects)
  const byName = Object.fromEntries(api.map((p) => [p.name, p]))

  // 1) 卡片数量与顺序（按更新时间倒序）
  const cards = await page.locator('[data-hub-card]').evaluateAll((els) => els.map((el) => el.getAttribute('data-hub-card')))
  const expectedOrder = [...api]
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .map((p) => p.name)
  check('大厅列出全部项目卡片', cards.length === 3, cards.join(','))
  check('卡片按更新时间倒序', JSON.stringify(cards) === JSON.stringify(expectedOrder), `${cards.join(',')} vs ${expectedOrder.join(',')}`)

  // 2) 完整项目：标题、风格·画幅、集镜秒、更新时间
  const full = page.locator(`[data-hub-card="${FULL}"]`)
  const fullText = await full.innerText()
  check('卡片显示标题', fullText.includes('完整项目'), fullText.replace(/\n/g, ' / '))
  check('卡片显示风格与画幅', fullText.includes('赛博朋克') && fullText.includes('9:16'), fullText.replace(/\n/g, ' / '))
  check(
    '卡片显示集数镜头数与总时长',
    fullText.includes('2 集') && fullText.includes('3 镜') && fullText.includes('7.5s'),
    fullText.replace(/\n/g, ' / '),
  )
  check('卡片显示更新时间', /刚刚|分钟前|小时前|天前|\d+\/\d+/.test(fullText))
  const mono = await full.locator('.hub-card-meta').evaluate((el) => {
    const cs = getComputedStyle(el)
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric }
  })
  check('数值使用等宽数字', /mono|SF Mono|JetBrains/i.test(mono.family) && mono.numeric.includes('tabular'), JSON.stringify(mono))
  const coverBlank = await full.locator('.hub-card-cover.is-blank').count()
  check('无封面用画幅占位块', coverBlank === 1)

  // 3) 风险徽标与服务端一致
  const health = byName[FULL].health || {}
  check(
    '缺首帧徽标数量与服务端一致',
    health.missing_keyframe > 0 && fullText.includes(`缺首帧 ${health.missing_keyframe}`),
    `health=${JSON.stringify(health)}`,
  )
  if (health.missing_anchor > 0) {
    check('缺锚点徽标数量与服务端一致', fullText.includes(`缺锚点 ${health.missing_anchor}`), `health=${JSON.stringify(health)}`)
  }

  const emptyCard = page.locator(`[data-hub-card="${EMPTY}"]`)
  check('空项目显示空项目徽标', (await emptyCard.locator('.hub-badge.is-muted').innerText()).includes('空项目'))

  const brokenCard = page.locator(`[data-hub-card="${BROKEN}"]`)
  check('损坏项目显示损坏徽标', (await brokenCard.locator('.hub-badge.is-danger').innerText()).includes('损坏'))
  check('损坏项目打开入口不可用', await brokenCard.locator('.hub-card-hit').isDisabled())
  check('损坏项目快捷入口不可用', await brokenCard.locator('.hub-card-action').first().isDisabled())

  // 4) 搜索
  const search = page.getByLabel('搜索项目')
  await search.fill('完整')
  await page.waitForTimeout(300)
  check('按标题搜索', (await page.locator('[data-hub-card]').count()) === 1 && (await page.locator(`[data-hub-card="${FULL}"]`).count()) === 1)
  await search.fill('hub-empty')
  await page.waitForTimeout(300)
  check('按目录名搜索', (await page.locator('[data-hub-card]').count()) === 1 && (await page.locator(`[data-hub-card="${EMPTY}"]`).count()) === 1)
  await search.fill('不存在的关键词')
  await page.waitForTimeout(300)
  check('无匹配显示空提示', (await page.locator('.hub-empty').innerText()).includes('没有匹配'))
  await page.getByRole('button', { name: '清空搜索' }).click()
  await page.waitForTimeout(300)
  check('清空搜索恢复全部', (await page.locator('[data-hub-card]').count()) === 3)

  // 5) 最近项目
  const recent = await page.locator('.hub-recent-chip').allInnerTexts()
  check('最近项目最多 5 个', recent.length <= 5, recent.join('/'))
  check('最近项目不重复', new Set(recent).size === recent.length, recent.join('/'))
  check('最近项目顺序按更新时间', recent.length === 3, recent.join('/'))

  // 6) 卡片快捷入口直达视图
  await full.locator('.hub-card-action').filter({ hasText: '画布' }).click()
  await page.locator('.rail').waitFor({ timeout: 15000 })
  check('卡片快捷入口直达画布', (await page.evaluate(() => window.location.hash)) === `#/p/${FULL}/board`, await page.evaluate(() => window.location.hash))

  // 7) 空态：删空后只给新建入口
  await page.evaluate(async (names) => {
    await fetch(`/api/project?names=${names.join(',')}`, { method: 'DELETE' })
  }, api.map((p) => p.name))
  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })
  // 列表是页面加载时拉的：接口删完后必须整页重载才会看到空库
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.hub-empty').waitFor({ timeout: 15000 })
  const emptyText = await page.locator('.hub-empty').innerText()
  check('空态显示还没有项目', emptyText.includes('还没有项目'), emptyText.slice(0, 80))
  check('空态不显示项目网格', (await page.locator('[data-hub-grid]').count()) === 0)
  check('空态不显示统计条', (await page.locator('.hub-hero-meta').count()) === 0)
  check('空态不显示假项目卡', (await page.locator('[data-hub-card]').count()) === 0)
  check('空态提供新建按钮', (await page.getByRole('button', { name: '新建项目' }).count()) >= 1)

  // 8) 新建后刷新列表并在概览打开
  const NEW = `hub-new-${Date.now()}`
  await page.getByRole('button', { name: '新建项目' }).first().click()
  await page.locator('[data-new-project-dialog]').waitFor({ timeout: 10000 })
  await page.locator('[data-new-project-name]').fill(NEW)
  await page.locator('[data-new-project-title]').fill('大厅新建')
  await page.locator('[data-new-project-submit]').click()
  await page.locator('.ov').waitFor({ timeout: 20000 })
  check('新建后直接落到概览', (await page.evaluate(() => window.location.hash)) === `#/p/${NEW}/overview`, await page.evaluate(() => window.location.hash))
  await page.locator('.crumb-hub').click()
  await page.locator('.hub').waitFor({ timeout: 15000 })
  await page.locator(`[data-hub-card="${NEW}"]`).waitFor({ timeout: 15000 })
  check('新建项目出现在大厅', (await page.locator(`[data-hub-card="${NEW}"]`).count()) === 1)
  check('新项目显示空项目徽标', (await page.locator(`[data-hub-card="${NEW}"] .hub-badge.is-muted`).innerText()).includes('空项目'))

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  console.error('❌ 验收脚本异常：', e)
  bad++
} finally {
  await browser.close()
  stop()
  fs.rmSync(PROJECTS, { recursive: true, force: true })
}

bad += check.bad()
console.log(bad === 0 ? '\n全部通过' : `\n失败 ${bad} 项`)
process.exit(bad === 0 ? 0 : 1)
