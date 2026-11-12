/**
 * 镜头语言列表的缩略封面 / 按需播放 / 检索稳定 回归检查（自起临时 dev server）。
 *
 * 覆盖：
 * 1) 打开镜头语言只渲染封面，网格内不创建任何 video 元素，也不请求 MP4
 * 2) hover 停留后恰好一个视频在播放；移开即回到封面
 * 3) 搜索缩短结果后列表回到顶部
 *
 * 跑法：node verify-lexicon-thumbs.mjs
 */
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import path from 'node:path'
import { projectUrl } from './verify-lib.mjs'

const PORT = 5361
const check = createCheck()
const PROJECTS = makeProjectsDir('lexicon-thumbs-')
const NAME = 'lexicon-thumbs'

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(NAME)}, { title: '镜头语言封面验证' })
writeProject(root, ${JSON.stringify(NAME)}, {
  shots: [{ id: 'E01-S01', episode: 1, no: 1, seconds: 3, size: '中景', move: '推', desc: '封面验证', keyframe_prompt: '封面验证', video_prompt: 'v' }],
  characters: [],
})
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

  const mp4Requests = []
  page.on('request', (r) => {
    if (/\.mp4(\?|$)/.test(r.url())) mp4Requests.push(r.url())
  })

  await page.goto(projectUrl(NAME, 'assets', app), { waitUntil: 'domcontentloaded' })
  await page.locator('.rail').waitFor({ state: 'visible', timeout: 20000 })
  await page.getByRole('button', { name: '镜头语言', exact: true }).click()
  const grid = page.locator('[data-lexicon-grid]')
  await grid.waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(600)

  // 1) 打开即封面优先
  const tiles = await page.locator('.lex-tile').count()
  check('列表渲染了全部条目', tiles === 132, String(tiles))
  const gridVideos = await grid.locator('video').count()
  check('网格内没有 video 元素', gridVideos === 0, String(gridVideos))
  const pageVideos = await page.locator('video').count()
  check('整页没有 video 元素', pageVideos === 0, String(pageVideos))
  const posters = await grid.locator('img.lex-thumb-poster').count()
  check('每条都有封面图', posters === 132, String(posters))
  const mp4OnOpen = mp4Requests.filter((u) => u.includes('camera-moves-whitebox-132'))
  check('打开时没有请求预置 MP4', mp4OnOpen.length === 0, mp4OnOpen.slice(0, 3).join(' '))

  // 详情区先给封面，点「播放预览」才挂视频
  const dockCover = page.locator('.lex-dock-cover')
  check('详情区先显示封面按钮', (await dockCover.count()) === 1)
  await dockCover.click()
  await page.waitForTimeout(300)
  check('点播放后详情区才挂视频', (await page.locator('.lex-dock-video video').count()) === 1)
  await page.locator('.lex-tile').nth(5).click()
  await page.waitForTimeout(300)
  check('换条目后详情区回到封面', (await page.locator('.lex-dock-video video').count()) === 0)

  // 2) hover 后恰好一个播放，移开回到封面
  const first = page.locator('.lex-tile').nth(0)
  const second = page.locator('.lex-tile').nth(1)
  await first.hover()
  await page.waitForTimeout(450)
  check('hover 后出现一个播放中的视频', (await grid.locator('video').count()) === 1, String(await grid.locator('video').count()))
  check('播放中的是该条目', (await first.getAttribute('data-lexicon-playing')) === '1')

  await second.hover()
  await page.waitForTimeout(450)
  check('换条目后仍只有一个视频', (await grid.locator('video').count()) === 1, String(await grid.locator('video').count()))
  check('播放切到新条目', (await second.getAttribute('data-lexicon-playing')) === '1' && (await first.getAttribute('data-lexicon-playing')) === null)

  // 鼠标移出网格：回到全封面
  await page.mouse.move(5, 5)
  await page.waitForTimeout(400)
  check('移开后回到零视频', (await grid.locator('video').count()) === 0, String(await grid.locator('video').count()))

  // 3) 搜索缩短结果后回到顶部
  await grid.evaluate((el) => {
    el.scrollTop = 400
  })
  const scrolled = await grid.evaluate((el) => el.scrollTop)
  check('先把列表滚到中间', scrolled > 0, String(scrolled))
  await page.getByLabel('搜索镜头语言').fill('推')
  await page.waitForTimeout(500)
  const after = await grid.evaluate((el) => el.scrollTop)
  check('搜索后列表回到顶部', after === 0, String(after))
  const shrunk = await page.locator('.lex-tile').count()
  check('搜索结果已收窄', shrunk > 0 && shrunk < 132, String(shrunk))

  // 清除筛选恢复整库，且仍然只有封面
  await page.getByRole('button', { name: '清除筛选' }).click()
  await page.waitForTimeout(400)
  check('清除筛选恢复整库', (await page.locator('.lex-tile').count()) === 132, String(await page.locator('.lex-tile').count()))
  check('恢复后网格仍无视频', (await grid.locator('video').count()) === 0, String(await grid.locator('video').count()))

  check('无页面异常', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await browser.close().catch(() => {})
  await stop?.()
}

console.log(bad ? `verify-lexicon-thumbs: ${bad} 项失败` : 'verify-lexicon-thumbs: ok')
if (bad) process.exit(1)
