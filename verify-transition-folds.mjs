/**
 * 转场面板折叠验收（outgoing-panel-folds §4）：
 * 1) 效果预设两段式：常用 4 项固定、全部预设折叠、展开后按原分组、选中后保持展开；
 * 2) 生成模式默认态：出片设置折叠、提示词展开，提示词与「生成视频」同屏；
 * 3) 两条路径同构：折叠头子元素顺序为 chevron → title → meta。
 *
 * 跑法：先 npm run dev，再 node verify-transition-folds.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5273/'

/** 夹具从 public/ 现取，避免写死的文件名被清理后失效 */
const pickFixtures = () => {
  const imgs = fs
    .readdirSync(path.join(root, 'public', 'generated'))
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
  const vids = fs
    .readdirSync(path.join(root, 'public', 'videos'))
    .filter((f) => /\.mp4$/i.test(f))
    .sort()
  if (imgs.length < 2 || !vids.length) throw new Error('public/ 缺少测试用的图片或视频夹具')
  return { IMG1: `/generated/${imgs[0]}`, IMG2: `/generated/${imgs[1]}`, VID: `/videos/${vids[0]}` }
}
const { IMG1, IMG2, VID } = pickFixtures()

/** 首尾帧只从成片抽，所以两镜都带 clip */
const mkShot = (id, no, keyframe, prompt = '') => ({
  id,
  episode: 1,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  keyframe,
  keyframe_prompt: prompt,
  dialogue: '',
  cast: [],
  handEdited: [],
  clip: VID,
})

const state = {
  project: {
    name: 'tr-folds',
    aspect: '16:9',
    shots: [
      mkShot('T1', 'S01', IMG1, '夜市推车，霓虹反光，低机位跟拍'),
      mkShot('T2', 'S02', IMG2, '摊主把义体手臂推过桌面，暖色顶光'),
    ],
    characters: [],
    assets: [],
    designs: [],
    episodes: [{ no: 1, title: 'E1' }],
    sceneLayouts: [],
  },
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    const body = req.postDataJSON() || {}
    for (const s of body.shots || []) {
      const old = state.project.shots.find((x) => x.id === s.id)
      if (old) Object.assign(old, s)
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: state.project.shots, characters: [] }),
    })
  }
  if (url.searchParams.get('name')) {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, project: state.project }),
    })
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      root: '/mock',
      projects: [{ name: state.project.name, title: state.project.name, shots: 2 }],
    }),
  })
})

await page.goto(APP_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)

// 标记为转场并打开面板
await page.locator('.edge-chip').first().click({ button: 'right' })
await page.waitForTimeout(400)
await page.locator('.ctx-radio-row[data-edge-rel="transition"] .ctx-main').click()
await page.waitForTimeout(500)
await page.locator('.ctx-menu .ctx-actions button', { hasText: '转场设置' }).click()
await page.waitForTimeout(500)
check('转场面板打开', (await page.locator('.tr-panel').count()) === 1)

// ---------------------------------------------------------------- 效果预设两段式
const presetState = () =>
  page.evaluate(() => {
    const panel = document.querySelector('.tr-panel')
    if (!panel) return null
    const common = panel.querySelector('.tr-preset-common')
    const all = panel.querySelector('.tr-preset-all')
    const commonBtns = common ? [...common.querySelectorAll('button')] : []
    const allBody = all ? all.querySelector('.fold-body') : null
    return {
      commonCount: commonBtns.length,
      commonLabels: commonBtns.map((b) => b.textContent.trim()),
      allOpen: all?.dataset.open,
      allMeta: all?.querySelector('.fold-meta')?.textContent?.trim() ?? '',
      allBodyHeight: allBody ? Math.round(allBody.getBoundingClientRect().height) : -1,
      allGroups: allBody ? allBody.querySelectorAll('.tr-preset-group').length : -1,
      allButtons: allBody ? allBody.querySelectorAll('button').length : -1,
      presetBlockHeight: Math.round(
        (common?.getBoundingClientRect().height ?? 0) +
          (all?.getBoundingClientRect().height ?? 0),
      ),
    }
  })

const common = await presetState()
check('常用段固定 4 项', common.commonCount === 4, String(common.commonCount))
check(
  '常用段覆盖叠化/黑场/白闪/推移',
  ['叠化', '黑场', '白闪', '推移→'].every((l) => common.commonLabels.some((x) => x.includes(l))),
  common.commonLabels.join('|'),
)
check('全部预设默认折叠', common.allOpen === 'false', String(common.allOpen))
check('全部预设折叠后不占高度', common.allBodyHeight === 0, String(common.allBodyHeight))
check('默认态预设区不超过一行加分组标题', common.presetBlockHeight <= 90, String(common.presetBlockHeight))

await page.locator('.tr-panel .fold-head', { hasText: '全部预设' }).click()
await page.waitForTimeout(300)
const expanded = await presetState()
check('展开后分为原分组', expanded.allGroups >= 2, String(expanded.allGroups))
const allCount = Number(expanded.allMeta.match(/^(\d+) 种$/)?.[1] ?? -1)
check('全部预设条目数可解析', allCount > 0, expanded.allMeta)
check('内置目录不少于 12 项', allCount + 4 >= 12, `常用4 + 其余${allCount}`)
check('展开后按钮数与计数一致', expanded.allButtons === allCount, `${expanded.allButtons} vs ${allCount}`)

await page.locator('.tr-panel .tr-preset-all .tr-grid button').nth(0).click()
await page.waitForTimeout(250)
check('选中后全部预设保持展开', (await presetState()).allOpen === 'true')

// ---------------------------------------------------------------- 生成模式默认态
await page.locator('.tr-seg button', { hasText: '生成' }).click()
await page.waitForTimeout(400)
const gen = await page.evaluate(() => {
  const panel = document.querySelector('.tr-panel')
  const vid = panel?.querySelector('[data-section="videoSettings"]')
  const prompt = panel?.querySelector('[data-video-prompt-panel]')
  const foot = panel?.querySelector('footer button')
  const box = (el) => (el ? el.getBoundingClientRect() : null)
  return {
    vidOpen: vid?.dataset.open,
    vidTitle: vid?.querySelector('.fold-title')?.textContent?.trim(),
    vidMeta: vid?.querySelector('.fold-meta')?.textContent?.trim(),
    promptOpen: prompt?.dataset.open,
    promptBox: box(prompt),
    footBox: box(foot),
    viewport: window.innerHeight,
  }
})
check('生成态出片设置默认折叠', gen.vidOpen === 'false', String(gen.vidOpen))
check('出片设置标题与分镜一致', gen.vidTitle === '出片设置', String(gen.vidTitle))
check(
  '摘要含模型/分辨率/秒数/估价',
  /·\s*(480p|720p)\s*·.*?s\s*·\s*¥/.test(gen.vidMeta ?? ''),
  gen.vidMeta ?? '',
)
check('生成态提示词默认展开', gen.promptOpen === 'true', String(gen.promptOpen))
check(
  '默认态提示词与生成按钮同屏',
  Boolean(gen.promptBox && gen.footBox) &&
    gen.promptBox.top >= 0 &&
    gen.footBox.bottom <= gen.viewport,
  JSON.stringify({ promptTop: gen.promptBox?.top, footBottom: gen.footBox?.bottom, vh: gen.viewport }),
)

// ---------------------------------------------------------------- 两条路径同构
const heads = await page.evaluate(() =>
  [...document.querySelectorAll('.tr-panel .fold-head')].map((h) =>
    [...h.children].map((c) => c.className.split(' ')[0]),
  ),
)
check(
  '所有折叠头都是 chevron → title → meta',
  heads.length > 0 &&
    heads.every(
      (h) => h[0] === 'fold-chevron' && h[1] === 'fold-title' && h[2] === 'fold-meta',
    ),
  JSON.stringify(heads),
)

check('无 pageerror', errors.length === 0, errors[0] ?? '')
await browser.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
