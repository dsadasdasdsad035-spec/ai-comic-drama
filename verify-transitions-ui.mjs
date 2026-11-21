/**
 * 接缝 UI 回归：标记转场、默认叠化、中点标签、接缝设置、预设切换、
 * 批量统一叠化、清空边后按 transition_out 修复、非相邻标记、预览与导出总长。
 * 生成式转场已退役，本脚本不再覆盖出片、首尾帧与失效判定。
 * 跑法：先 npm run dev，再 node verify-transitions-ui.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const shotsDir = path.join(root, 'openspec', 'changes', 'remove-generated-transitions', 'evidence')
fs.mkdirSync(shotsDir, { recursive: true })
const APP_URL = 'http://127.0.0.1:5273/'
/** 夹具从 public/ 现取：早先写死的文件名已被清理，硬编码会让导出步骤永远拿不到素材 */
const pickFixtures = () => {
  const imgs = fs
    .readdirSync(path.join(root, 'public', 'generated'))
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
  const vids = fs
    .readdirSync(path.join(root, 'public', 'videos'))
    .filter((f) => /\.mp4$/i.test(f))
    .sort()
  if (imgs.length < 3 || !vids.length) throw new Error('public/ 缺少测试用的图片或视频夹具')
  // 时间线断言按「每镜 3 秒」写，成片时长会盖过 seconds，所以挑一条 3 秒的片子
  const secondsOf = (f) => {
    try {
      return Number(
        execFileSync('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'csv=p=0',
          path.join(root, 'public', 'videos', f),
        ]).toString().trim(),
      )
    } catch {
      return 0
    }
  }
  const vid = vids.find((f) => Math.abs(secondsOf(f) - 3) < 0.06) ?? vids[0]
  return {
    IMG1: `/generated/${imgs[0]}`,
    IMG2: `/generated/${imgs[1]}`,
    IMG3: `/generated/${imgs[2]}`,
    VID: `/videos/${vid}`,
  }
}
const { IMG1, IMG2, IMG3, VID } = pickFixtures()

const mkShot = (id, no, keyframe, prompt = '') => ({
  id, episode: 1, no, seconds: 3, size: '中景', move: '固定',
  keyframe, keyframe_prompt: prompt, dialogue: '', cast: [], handEdited: [],
  clip: VID,
})
const state = {
  project: {
    name: 'tr-e2e', aspect: '16:9',
    shots: [
      mkShot('T1', 'S01', IMG1, '夜市推车，霓虹反光，低机位跟拍'),
      mkShot('T2', 'S02', IMG2, '摊主把义体手臂推过桌面，暖色顶光'),
    ],
    characters: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  },
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: state.project.shots, characters: [], savedAt: new Date().toISOString() }),
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
      projects: [{ name: state.project.name, title: state.project.name, shots: state.project.shots.length }],
    }),
  })
})

// 关系与状态读边上的类名；接缝摘要一半读中点标签，一半读菜单头部
const edgeSel = '.react-flow__edge-shot'
const edgeClass = async () =>
  (await page.locator(edgeSel).count()) > 0
    ? (await page.locator(edgeSel).first().getAttribute('class')) ?? ''
    : ''
const relationNow = async () => (await edgeClass()).match(/edge-rel-(\w+)/)?.[1] ?? ''
const stateNow = async () => (await edgeClass()).match(/edge-state-(\w+)/)?.[1] ?? ''
const chipText = async () =>
  (await page.locator('.edge-chip').count()) > 0
    ? (await page.locator('.edge-chip').first().innerText()).trim()
    : ''
/** 单击线身打开关系菜单（坐标决定落点，取画布中部即可） */
const clickEdge = async () => {
  await page.locator(`${edgeSel} .react-flow__edge-interaction`).first().dispatchEvent('click', {
    clientX: 700,
    clientY: 420,
  })
  await page.waitForTimeout(500)
}
/** 打开菜单读头部摘要后关掉 */
const headOfEdge = async () => {
  await clickEdge()
  const t = (await page.locator('.ctx-head').innerText()).trim()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return t
}
const timelineText = () => page.locator('.ntl-sum').innerText()
const shot = (n) => page.screenshot({ path: path.join(shotsDir, n) })

/** 重载后会回到「分集目录」：画布页先出选集卡，点进第 1 集才有分镜卡与连线 */
const reenterBoard = async () => {
  const cards = page.locator('.board-ep-card')
  if (await cards.count()) await cards.first().click()
  await page.locator('.wb-bar-detail').waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1800)
}

await page.goto(`${APP_URL.replace(/\/$/, '')}/#/`, { waitUntil: 'domcontentloaded' })
const trName = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/project')
    const d = await r.json()
    return (d.projects || [])[0]?.name || ''
  } catch {
    return ''
  }
})
if (trName) {
  await page.evaluate((n) => {
    window.location.hash = `#/p/${encodeURIComponent(n)}/board`
  }, trName)
}
await page.locator('.rail').waitFor({ timeout: 20000 })
await reenterBoard()

check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
check('初始一条硬切', (await relationNow()) === 'cut', await edgeClass())
check('初始 6.0s', (await timelineText()).includes('6.0s'), await timelineText())
check('硬切连线没有中点标签', (await page.locator('.edge-chip').count()) === 0)
await shot('transition-01-cut.png')

await clickEdge()
check('单击连线弹出菜单', (await page.locator('.ctx-menu--edge').count()) === 1)
check('单击连线不改关系', (await relationNow()) === 'cut', await edgeClass())
check('单击连线不打开面板', (await page.locator('.tr-panel').count()) === 0)
check('四个关系单选齐全', (await page.locator('.ctx-radio-row').count()) === 4)
await page.locator('.ctx-radio-row[data-edge-rel="flashback"] .ctx-main').click()
await page.waitForTimeout(500)
check('菜单单选切到闪回', (await relationNow()) === 'flashback', await edgeClass())
check('点关系后菜单不关闭', (await page.locator('.ctx-menu--edge').count()) === 1)
await page.locator('.ctx-radio-row[data-edge-rel="cut"] .ctx-main').click()
await page.waitForTimeout(500)
check('菜单可切回硬切', (await relationNow()) === 'cut', await edgeClass())
await page.locator('.ctx-radio-row[data-edge-rel="transition"] .ctx-main').click()
await page.waitForTimeout(700)
check(
  '标记转场 → 叠化 0.5s',
  (await page.locator('.ctx-head').innerText()).includes('叠化 0.5s'),
  await page.locator('.ctx-head').innerText(),
)
check('叠化总长 5.5s', (await timelineText()).includes('5.5s'), await timelineText())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// 中点标签：只属于转场线，内容恒定为效果名 + 时长
check('转场连线出现中点标签', (await page.locator('.edge-chip').count()) === 1)
check('标签写叠化 0.5s', (await chipText()) === '叠化 0.5s', await chipText())
const chipPointer = await page
  .locator('.edge-chip')
  .evaluate((el) => getComputedStyle(el).pointerEvents)
check('标签不吃指针事件', chipPointer === 'none', chipPointer)
await shot('transition-02-dissolve.png')

// 接缝设置
await clickEdge()
await page.locator('.ctx-menu .ctx-actions button', { hasText: '接缝设置' }).click()
await page.waitForTimeout(500)
const panel1 = await page.locator('.tr-panel').innerText()
check('接缝设置打开', (await page.locator('.tr-panel').count()) === 1)
check('面板标题为「接缝设置」', (await page.locator('.tr-panel .panel-head b').innerText()).trim() === '接缝设置')
check('相邻两镜不报未参与', !panel1.includes('未参与成片'))
check('面板显示成片 -0.5s', panel1.includes('成片 -0.5s'))
check('面板没有模式切换', (await page.locator('.tr-panel .tr-seg button', { hasText: '生成' }).count()) === 0)
check('面板没有出片入口', (await page.locator('.tr-panel footer').count()) === 0)
check('面板没有提示词输入', (await page.locator('.tr-panel textarea').count()) === 0)
await shot('transition-03-panel.png')

// 预设切换：中点标签与菜单摘要同步更新
await page.locator('.tr-panel .fold-head', { hasText: '全部预设' }).click()
await page.waitForTimeout(300)
await page.locator('.tr-panel button', { hasText: '擦除→' }).first().click()
await page.waitForTimeout(500)
check('擦除→ 更新中点标签', (await chipText()).includes('擦除→ 0.5s'), await chipText())
await page.locator('.tr-x').click()
await page.waitForTimeout(300)
check('擦除→ 更新菜单摘要', (await headOfEdge()).includes('擦除→ 0.5s'), await relationNow())

// 擦除/推移在预览里只是近似，提示文案在连播面板
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('擦除/推移标注以导出为准', (await page.locator('.pv-approx').count()) === 1)
check('预览总长 5.5s', (await page.locator('.pv-time').innerText()).includes('5.5s'), await page.locator('.pv-time').innerText())
check(
  '预览条目只有镜头，没有转场块',
  (await page.locator('.pv-seg').count()) === 2,
  String(await page.locator('.pv-seg').count()),
)
await page.locator('.pv-x[aria-label="关闭连播"]').click()
await page.waitForTimeout(300)

// 批量统一叠化
await page.locator('.bm .tm-btn').click()
await page.waitForTimeout(300)
await page.locator('.bm-item', { hasText: '全片统一叠化' }).click()
await page.waitForTimeout(900)
check('批量叠化回到叠化 0.5s', (await chipText()) === '叠化 0.5s', await chipText())

// 等写回项目，再清空画布边后重载：转场线应能按 transition_out 修复
await page.waitForTimeout(2200)
const key = 'storyboard-canvas-v1:tr-e2e'
await page.evaluate((k) => {
  const raw = localStorage.getItem(k)
  if (!raw) return
  const p = JSON.parse(raw)
  p.edges = []
  localStorage.setItem(k, JSON.stringify(p))
}, key)
await page.reload({ waitUntil: 'networkidle' })
await reenterBoard()
check('清空边后重载恢复转场线', (await relationNow()) === 'transition', await edgeClass())
check('恢复后标签仍为叠化 0.5s', (await chipText()) === '叠化 0.5s', await chipText())
check('恢复后总长仍 5.5s', (await timelineText()).includes('5.5s'), await timelineText())
await shot('transition-04-repaired.png')

// 预览与导出
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('预览总长 5.5s', (await page.locator('.pv-time').innerText()).includes('5.5s'), await page.locator('.pv-time').innerText())
await page.getByRole('button', { name: '导出成片' }).click()
let msg = ''
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1500)
  const m = page.locator('.pv-msg.ok').first()
  if ((await m.count()) > 0) {
    msg = (await m.innerText()).trim()
    if (/镜|失败|超时/.test(msg)) break
  }
}
if (!msg) console.log('  [export msgs]', JSON.stringify(await page.locator('.pv-msg').allTextContents()))
check('导出 5.5s', msg.includes('5.5s'), msg.slice(0, 160))
check('导出回执不提转场失效', !(await page.locator('.pv-msg').allTextContents()).join(' ').includes('已失效'))
await page.screenshot({ path: path.join(shotsDir, 'transition-05-export.png') })
await page.locator('.pv-x[aria-label="关闭连播"]').click()
await page.waitForTimeout(300)

// 非相邻：3 镜，S01 的转场指向 S03
state.project.shots = [
  mkShot('T1', 'S01', IMG1, '夜市推车'),
  mkShot('T2', 'S02', IMG2, '摊主推手臂'),
  mkShot('T3', 'S03', IMG3, '回收人低头'),
]
state.project.shots[0].transition_out = {
  to: 'T3',
  mode: 'effect',
  effect: { type: 'dissolve', seconds: 0.5 },
}
await page.evaluate((k) => localStorage.removeItem(k), key)
await page.reload({ waitUntil: 'networkidle' })
await reenterBoard()
check('非相邻线条标 inactive', (await page.locator('.react-flow__edge-shot.edge-state-inactive').count()) === 1)
const warn = await page.locator('.ntl-warn').allTextContents()
check('时间线提示未参与', warn.some((x) => x.includes('转场未参与')), warn.join('|'))
check('非相邻不让总长变短', (await timelineText()).includes('9.0s'), await timelineText())
await shot('transition-06-inactive.png')

// 旧存档带生成配置：按 effect 渲染，不插入片段、不显示失效
state.project.shots = [mkShot('T1', 'S01', IMG1, '夜市推车'), mkShot('T2', 'S02', IMG2, '摊主推手臂')]
state.project.shots[0].transition_out = {
  to: 'T2',
  mode: 'generated',
  effect: { type: 'dissolve', seconds: 0.5 },
  generated: {
    targetSeconds: 1.2,
    prompt: '旧提示词',
    inheritRefs: true,
    video: { url: VID },
  },
}
await page.evaluate((k) => localStorage.removeItem(k), key)
await page.reload({ waitUntil: 'networkidle' })
await reenterBoard()
check('旧生成配置按转场线渲染', (await relationNow()) === 'transition', await edgeClass())
check('旧生成配置标签只写效果', (await chipText()) === '叠化 0.5s', await chipText())
check('旧生成配置不插入片段', (await timelineText()).includes('5.5s'), await timelineText())
check('旧生成配置无失效标记', (await page.locator('.react-flow__edge-shot.edge-state-stale').count()) === 0)
await shot('transition-07-legacy.png')

const pageErrors = logs.filter((l) => /pageerror/i.test(l))
check('没有页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
await browser.close()
process.exit(bad ? 1 : 0)
