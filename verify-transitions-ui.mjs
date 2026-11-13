/**
 * 转场 UI 回归：标记转场、默认叠化、面板、模式切换、批量跳过生成、
 * 关键帧/视频（mock 接口）、清空边后修复、非相邻标记、预览与导出总长。
 * 跑法：先 npm run dev，再 node verify-transitions-ui.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const shotsDir = path.join(root, 'openspec', 'changes', 'transition-joins', 'evidence')
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
  // 首尾帧从成片抽：两镜都要有成片（项目字段叫 clip）
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
let seedreamBody = null
let videoBody = null
/** /api/frames 请求体：首尾帧抽取走这条接口 */
const framesBodies = []

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
await page.route('**/api/frames', async (route) => {
  const body = route.request().postDataJSON() || {}
  framesBodies.push(body)
  // times:[0] 取首帧（下镜的第一帧），其余取尾帧（上镜的最后一帧）
  const times = Array.isArray(body.times) ? body.times : []
  const url = times.length && Number(times[0]) === 0 ? IMG2 : IMG1
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: [url], duration: 3, times }),
  })
})
await page.route('**/api/seedream', async (route) => {
  seedreamBody = route.request().postDataJSON()
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: [IMG1], url: IMG1, size: '1024x576', elapsed: 12 }),
  })
})
await page.route('**/api/seedance**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    videoBody = req.postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'mock-v', mode: 'transition' }),
    })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: VID }),
  })
})

// 画布连线不再有标签：关系与状态读边上的类名，接缝摘要读单击菜单的头部
const edgeSel = '.react-flow__edge-shot'
const edgeClass = async () =>
  (await page.locator(edgeSel).count()) > 0
    ? (await page.locator(edgeSel).first().getAttribute('class')) ?? ''
    : ''
const relationNow = async () => (await edgeClass()).match(/edge-rel-(\w+)/)?.[1] ?? ''
const stateNow = async () => (await edgeClass()).match(/edge-state-(\w+)/)?.[1] ?? ''
/** 单击线身打开关系菜单（坐标决定落点，取画布中部即可） */
const clickEdge = async () => {
  await page.locator(`${edgeSel} .react-flow__edge-interaction`).first().dispatchEvent('click', {
    clientX: 700,
    clientY: 420,
  })
  await page.waitForTimeout(500)
}
/** 打开菜单读头部摘要后关掉，用来替代原来读 chip 文本的断言 */
const headOfEdge = async () => {
  await clickEdge()
  const t = (await page.locator('.ctx-head').innerText()).trim()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return t
}
const timelineText = () => page.locator('.ntl-sum').innerText()
const shot = (n) => page.screenshot({ path: path.join(shotsDir, n) })

await page.goto(`${APP_URL.replace(/\/$/, '')}/#/`, { waitUntil: 'domcontentloaded' })
// 大厅是唯一入口：按 hash 打开被 mock 的项目（项目列表在页面里读，mock 才生效）
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
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1800)

check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
check('初始一条硬切', (await relationNow()) === 'cut', await edgeClass())
check('初始 6.0s', (await timelineText()).includes('6.0s'), await timelineText())
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
await shot('transition-02-dissolve.png')

await page.locator('.ctx-menu .ctx-actions button', { hasText: '转场设置' }).click()
await page.waitForTimeout(500)
const panel1 = await page.locator('.tr-panel').innerText()
check('面板打开', (await page.locator('.tr-panel').count()) === 1)
check('相邻两镜不报未参与', !panel1.includes('未参与成片'))
check('面板显示成片 -0.5s', panel1.includes('成片 -0.5s'))
await shot('transition-03-panel.png')

await page.locator('.tr-panel .fold-head', { hasText: '全部预设' }).click()
await page.waitForTimeout(300)
await page.locator('.tr-panel button', { hasText: '擦除→' }).first().click()
await page.waitForTimeout(400)
check('擦除→ 更新接缝摘要', (await headOfEdge()).includes('擦除→ 0.5s'), await relationNow())

// 擦除/推移在预览里只是近似，提示文案在连播面板
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('擦除/推移标注以导出为准', (await page.locator('.pv-approx').count()) === 1)
await page.locator('.pv-x[aria-label="关闭连播"]').click()
await page.waitForTimeout(300)

await page.locator('.tr-seg button', { hasText: '生成' }).click()
await page.waitForTimeout(400)
const panel2 = await page.locator('.tr-panel').innerText()
check('切到生成模式', panel2.includes('出片设置'))
check('首尾帧默认未选', panel2.includes('首帧未选 · 尾帧未选'))
check(
  '首尾帧非必填，生成按钮可用',
  await page.locator('.tr-panel footer button', { hasText: '生成视频' }).isEnabled(),
)

await page.locator('.tr-panel .fold-head', { hasText: '转场与边界' }).click()
await page.waitForTimeout(300)
await page.locator('.tr-panel button', { hasText: '选择出片参考' }).click()
await page.waitForTimeout(400)
await page.locator('.orp-actions button', { hasText: '抽取两镜成片帧' }).click()
await page.waitForTimeout(1200)
check('抽帧覆盖两镜成片', framesBodies.filter((b) => b.video === VID).length >= 2, JSON.stringify(framesBodies.map((b) => b.times)))
check('两个首尾帧槽位都已选', (await page.locator('.orp-slot-state', { hasText: '已选' }).count()) === 2)
// 当前出片模型不支持尾帧：清掉尾帧只留首帧，否则按钮被阻断（模型切换不在本用例范围）
await page.locator('.orp-slot[data-boundary-slot="in"] button', { hasText: '清除' }).click()
await page.waitForTimeout(300)
check(
  '清掉尾帧后不再阻断出片',
  await page.locator('.tr-panel footer button', { hasText: '生成视频' }).isEnabled(),
)
await page.locator('.orp-close').click()
await page.waitForTimeout(400)

await page.locator('.tr-panel footer button', { hasText: '生成视频' }).click()
await page.waitForTimeout(4200)
check('转场视频已生成', (await page.locator('.si-video-preview video').count()) === 1)
check('接缝摘要 → 生成 1.2s', (await headOfEdge()).includes('生成 1.2s'), await relationNow())
check('生成转场总长 6.8s', (await timelineText()).includes('6.8s'), await timelineText())
check(
  '视频请求带首帧边界',
  videoBody?.transition?.boundaryOut === IMG1 &&
    !videoBody?.transition?.boundaryIn &&
    videoBody?.transition?.bridging === 'morph',
  JSON.stringify(videoBody?.transition || null),
)
check('视频请求 2s（1.2s 目标 + 余量）', videoBody?.seconds === 2, String(videoBody?.seconds))
await shot('transition-04-generated.png')
await page.locator('.tr-x').click()
await page.waitForTimeout(300)

// 批量叠化必须跳过生成转场
await page.locator('.bm .tm-btn').click()
await page.waitForTimeout(300)
await page.locator('.bm-item', { hasText: '全片统一叠化' }).click()
await page.waitForTimeout(700)
check('批量叠化跳过生成转场', (await headOfEdge()).includes('生成 1.2s'), await relationNow())

// 等写回项目，再清空画布边后重载：生成转场应能按 transition_out 修复
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
await page.waitForTimeout(1800)
check('清空边后重载恢复转场线', (await headOfEdge()).includes('生成 1.2s'), await relationNow())
check('恢复后总长仍 6.8s', (await timelineText()).includes('6.8s'), await timelineText())
await shot('transition-05-repaired.png')

// 相邻镜头画面变化 → 需要重生成
await page.waitForTimeout(2200)
state.project.shots[0].keyframe = IMG3
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('边界变化后线条标失效', (await page.locator('.react-flow__edge-shot.edge-state-stale').count()) === 1)
await clickEdge()
await page.locator('.ctx-menu .ctx-actions button', { hasText: '转场设置' }).click()
await page.waitForTimeout(400)
check('面板提示需要重生成', (await page.locator('.tr-panel').innerText()).includes('出片条件已变'))
await page.locator('.tr-x').click()
await page.waitForTimeout(300)
await shot('transition-05b-stale.png')

// 预览与导出
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('预览总长 6.8s', (await page.locator('.pv-time').innerText()).includes('6.8s'), await page.locator('.pv-time').innerText())
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
check('导出 6.8s 且含 1 转场', msg.includes('6.8s') && msg.includes('1 转场'), msg.slice(0, 160))
check(
  '导出报告失效转场',
  (await page.locator('.pv-msg.warn').first().innerText()).includes('1 条生成转场已失效'),
  (await page.locator('.pv-msg.warn').first().innerText()).slice(0, 160),
)
await page.screenshot({ path: path.join(shotsDir, 'transition-06-export.png') })
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
await page.waitForTimeout(1800)
check('非相邻线条标 inactive', (await page.locator('.react-flow__edge-shot.edge-state-inactive').count()) === 1)
const warn = await page.locator('.ntl-warn').allTextContents()
check('时间线提示未参与', warn.some((x) => x.includes('转场未参与')), warn.join('|'))
check('非相邻不让总长变短', (await timelineText()).includes('9.0s'), await timelineText())
await shot('transition-07-inactive.png')

// 视频请求分流（dryRun，不真的出片）
const dry = async (body) => {
  const r = await fetch('http://127.0.0.1:5273/api/seedance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, dryRun: true }),
  })
  return { status: r.status, json: await r.json() }
}
const BOUNDARY = {
  boundaryOut: 'https://example.com/out.jpg',
  boundaryIn: 'https://example.com/in.jpg',
}
const dryBase = {
  prompt: 'transition test',
  ratio: '16:9',
}
// 旧版过渡关键帧（bridging 缺省）：方舟只吃关键帧当首帧，没有尾帧
const ark = await dry({
  ...dryBase,
  modelKey: 'ark-video',
  seconds: 2,
  transition: { ...BOUNDARY, keyframe: 'https://example.com/keyframe.jpg' },
})
check(
  '方舟：关键帧作首帧、不带参考图',
  ark.json.request?.content?.some((x) => x.role === 'first_frame' && x.image_url?.url === 'https://example.com/keyframe.jpg') &&
    !ark.json.request?.content?.some((x) => x.role === 'reference_image'),
  JSON.stringify(ark.json.request?.content?.map((x) => x.role)),
)
// 首尾直变（bridging=morph）：首帧取上镜尾帧、尾帧取下镜首帧，与 reference_image 互斥
const s25 = await dry({ ...dryBase, modelKey: 'apimart-video-seedance-2-5', seconds: 4, transition: { ...BOUNDARY, bridging: 'morph' } })
const roles = Object.fromEntries((s25.json.request?.image_with_roles || []).map((x) => [x.role, x.url]))
check(
  'Seedance 2.5：morph 首帧 + 尾帧，不混参考图',
  roles.first_frame === BOUNDARY.boundaryOut &&
    roles.last_frame === BOUNDARY.boundaryIn &&
    !roles.reference_image,
  JSON.stringify(roles),
)
check('Seedance 2.5 首尾帧用 adaptive 比例', s25.json.request?.size === 'adaptive', String(s25.json.request?.size))
const kling = await dry({ ...dryBase, modelKey: 'apimart-video-kling-v3', seconds: 3, transition: { ...BOUNDARY, bridging: 'morph' } })
check(
  'Kling v3：morph 首帧 + 尾帧',
  (kling.json.request?.image_urls || []).length === 2 &&
    kling.json.request.image_urls[0] === BOUNDARY.boundaryOut &&
    kling.json.request.image_urls[1] === BOUNDARY.boundaryIn &&
    !kling.json.request?.image_with_roles,
  JSON.stringify(kling.json.request || null),
)
// 不支持尾帧的模型必须明确拒绝首尾直变
const arkMorph = await dry({
  ...dryBase,
  modelKey: 'ark-video',
  seconds: 2,
  transition: { ...BOUNDARY, bridging: 'morph' },
})
check(
  '方舟没有尾帧：morph 只送首帧（阻断由客户端提示）',
  arkMorph.status === 200 &&
    arkMorph.json.request?.content?.some((x) => x.role === 'first_frame') &&
    !arkMorph.json.request?.content?.some((x) => x.role === 'last_frame'),
  JSON.stringify(arkMorph.json.request?.content?.map((x) => x.role)),
)

const pageErrors = logs.filter((l) => /pageerror/i.test(l))
check('没有页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
await browser.close()
process.exit(bad ? 1 : 0)
