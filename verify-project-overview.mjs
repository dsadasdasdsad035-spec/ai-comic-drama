/**
 * 项目概览验收：KPI（集数 / 镜头 / 总时长 / 角色 / 缺首帧 / 缺锚点）、集行（镜数 + 目标时长）、
 * 下一步状态机（导入分镜 / 拆角色 / 补首帧 / 补锚点 / 打开画布）、点集行切集并打开画布、空项目空态。
 *
 * 跑法：node verify-project-overview.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const PORT = 5355
const check = createCheck()
const PROJECTS = makeProjectsDir('project-overview-')
const READY = 'ov-ready'
const NOCAST = 'ov-nochar'
const NOFRAME = 'ov-noframes'
const ANCHOR = 'ov-anchor'
const EMPTY = 'ov-empty'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
const char = { name: '甲', look_en: 'a tall man in a red coat' }
const shot = (id, ep, no, sec, kf, cast) => ({
  id, episode: ep, no, seconds: sec, desc: no, keyframe: kf, keyframe_prompt: 'a tall man in a red coat, wide shot', video_prompt: 'push in', cast,
})
const eps = [{ no: 1, title: '第一集', targetSeconds: 15 }, { no: 2, title: '第二集', targetSeconds: 12 }]

createProject(root, ${JSON.stringify(READY)}, { title: '就绪项目' })
writeProject(root, ${JSON.stringify(READY)}, {
  style: '赛博朋克', aspect: '9:16', episodes: eps,
  characters: [char],
  shots: [shot('E01-S01', 1, 'S01', 3, '/generated/a.png', ['甲']), shot('E01-S02', 1, 'S02', 2.5, '/generated/b.png', ['甲']), shot('E02-S01', 2, 'S01', 2, '/generated/c.png', ['甲'])],
})
createProject(root, ${JSON.stringify(NOCAST)}, { title: '缺角色项目' })
writeProject(root, ${JSON.stringify(NOCAST)}, { episodes: eps, shots: [shot('E01-S01', 1, 'S01', 3, '/generated/a.png')] })
createProject(root, ${JSON.stringify(NOFRAME)}, { title: '缺首帧项目' })
writeProject(root, ${JSON.stringify(NOFRAME)}, { episodes: eps, characters: [char], shots: [shot('E01-S01', 1, 'S01', 3, '', ['甲']), shot('E01-S02', 1, 'S02', 2, '', ['甲'])] })
createProject(root, ${JSON.stringify(ANCHOR)}, { title: '缺锚点项目' })
writeProject(root, ${JSON.stringify(ANCHOR)}, {
  episodes: eps, characters: [char],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'S01', keyframe: '/generated/a.png', keyframe_prompt: 'a woman walking', video_prompt: 'v', cast: ['甲'] }],
})
createProject(root, ${JSON.stringify(EMPTY)}, { title: '空项目' })
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

  const open = async (name) => {
    await page.evaluate((n) => {
      window.location.hash = `#/p/${n}/overview`
    }, name)
    await page.locator('.ov').waitFor({ timeout: 20000 })
    await page.waitForTimeout(500)
  }
  const stat = async (label) =>
    page.locator('.ov-stat').filter({ hasText: label }).locator('b').innerText()

  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })

  // 1) KPI 与集行
  await open(READY)
  check('概览标题为项目标题', (await page.locator('.ov-title h1').innerText()).includes('就绪项目'))
  check('KPI 集数', (await stat('集数')) === '2', await stat('集数'))
  check('KPI 镜头数', (await stat('镜头')) === '3', await stat('镜头'))
  check('KPI 总时长', (await stat('总时长')) === '8s', await stat('总时长'))
  check('KPI 角色数', (await stat('角色')) === '1', await stat('角色'))
  check('KPI 缺首帧', (await stat('缺首帧')) === '0', await stat('缺首帧'))
  check('KPI 缺锚点', (await stat('缺锚点')) === '0', await stat('缺锚点'))

  const epRows = await page.locator('.ov-eps li').allInnerTexts()
  check('集行显示镜数与目标时长', epRows.length === 2 && epRows[0].includes('2 镜') && epRows[0].includes('目标 15s') && epRows[1].includes('1 镜') && epRows[1].includes('目标 12s'), epRows.join(' / '))
  check('集行显示集号与标题', epRows[0].includes('E01') && epRows[0].includes('第一集') && epRows[1].includes('E02'), epRows.join(' / '))

  // 2) 主操作唯一 + 就绪态
  const primary = page.locator('.ov .btn:not(.btn-ghost)')
  check('概览只有一个强调按钮', (await primary.count()) === 1, String(await primary.count()))
  check('镜头齐全时主操作是打开画布', (await page.locator('.ov-next-cta').innerText()).includes('打开画布'), await page.locator('.ov-next-cta').innerText())

  // 3) 点集行切集并打开画布
  await page.locator('[data-ov-ep="2"]').click()
  await page.locator('.app-main').waitFor({ timeout: 15000 })
  check('点集行打开画布', (await page.evaluate(() => window.location.hash)) === `#/p/${READY}/board`, await page.evaluate(() => window.location.hash))
  await page.waitForTimeout(800)
  const epLabel = await page.locator('.epbar-trigger').getAttribute('aria-label')
  check('画布集选择器切到 E02', String(epLabel).includes('E02'), String(epLabel))
  check('画布集摘要为 1 镜', String(epLabel).includes('1 镜'), String(epLabel))

  // 4) 状态机：缺角色 → 缺首帧 → 缺锚点 → 空项目
  await open(NOCAST)
  check('缺角色时主操作是去创意', (await page.locator('.ov-next-cta').innerText()).includes('去创意拆角色'), await page.locator('.ov-next-cta').innerText())
  check('缺角色时强调按钮仍只有一个', (await page.locator('.ov .btn:not(.btn-ghost)').count()) === 1)

  await open(NOFRAME)
  check('缺首帧时主操作是去画布出首帧', (await page.locator('.ov-next-cta').innerText()).includes('去画布出首帧'), await page.locator('.ov-next-cta').innerText())
  check('缺首帧 KPI 按健康度计数', (await stat('缺首帧')) === '2', await stat('缺首帧'))
  check('缺首帧统计带警示色', (await page.locator('.ov-stat.is-warn').count()) >= 1)

  await open(ANCHOR)
  check('缺锚点 KPI 按健康度计数', (await stat('缺锚点')) === '1', await stat('缺锚点'))
  check('缺锚点时主操作是补齐锚点', (await page.locator('.ov-next-cta').innerText()).includes('去画布补齐锚点'), await page.locator('.ov-next-cta').innerText())

  await open(EMPTY)
  check('空项目主操作是导入分镜', (await page.locator('.ov-next-cta').innerText()).includes('导入分镜表'), await page.locator('.ov-next-cta').innerText())
  check('空项目显示分集空态', (await page.locator('.ov-muted').innerText()).includes('还没有分集'), await page.locator('.ov-muted').innerText())
  check('空项目 KPI 全零', (await stat('镜头')) === '0' && (await stat('总时长')) === '0s', `${await stat('镜头')} / ${await stat('总时长')}`)

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
