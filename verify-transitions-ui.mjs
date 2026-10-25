/**
 * 转场 UI 回归：标记转场、默认叠化、面板、模式切换、批量跳过生成、
 * 关键帧/视频（mock 接口）、清空边后修复、非相邻标记、预览与导出总长。
 * 跑法：先 npm run dev，再 node verify-transitions-ui.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const shotsDir = path.join(root, 'openspec', 'changes', 'transition-joins', 'evidence')
fs.mkdirSync(shotsDir, { recursive: true })
const APP_URL = 'http://127.0.0.1:5273/'
const IMG1 = '/generated/shot-1792653104009-fe6e05.jpg'
const IMG2 = '/generated/shot-1792635049165-29ec33.jpg'
const IMG3 = '/generated/shot-1792635742562-193def.jpg'
const VID = '/videos/shot-vid-1792813683482-86dc69.mp4'

const mkShot = (id, no, keyframe, prompt = '') => ({
  id, episode: 1, no, seconds: 3, size: '中景', move: '固定',
  keyframe, keyframe_prompt: prompt, dialogue: '', cast: [], handEdited: [],
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

const chipTexts = () => page.locator('.edge-chip').allTextContents()
const timelineText = () => page.locator('.ntl-sum').innerText()
const shot = (n) => page.screenshot({ path: path.join(shotsDir, n) })

await page.goto(APP_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)

check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
check('初始一条硬切', (await chipTexts())[0] === '硬切', (await chipTexts()).join('|'))
check('初始 6.0s', (await timelineText()).includes('6.0s'), await timelineText())
await shot('transition-01-cut.png')

await page.locator('.edge-chip').first().click()
await page.waitForTimeout(700)
check('标记转场 → 叠化 0.5s', (await chipTexts())[0] === '叠化 0.5s', (await chipTexts()).join('|'))
check('叠化总长 5.5s', (await timelineText()).includes('5.5s'), await timelineText())
await shot('transition-02-dissolve.png')

await page.locator('.edge-chip-more').first().click()
await page.waitForTimeout(500)
const panel1 = await page.locator('.tr-panel').innerText()
check('面板打开', (await page.locator('.tr-panel').count()) === 1)
check('相邻两镜不报未参与', !panel1.includes('未参与成片'))
check('面板显示成片 -0.5s', panel1.includes('成片 -0.5s'))
await shot('transition-03-panel.png')

await page.locator('.tr-panel button', { hasText: '擦除' }).first().click()
await page.locator('.tr-panel button', { hasText: '→' }).first().click()
await page.waitForTimeout(400)
check('擦除→ 更新 chip', (await chipTexts())[0] === '擦除→ 0.5s', (await chipTexts()).join('|'))
check('擦除/推移标注以导出为准', (await page.locator('.tr-panel').innerText()).includes('以导出为准'))

await page.locator('.tr-panel button', { hasText: '生成' }).first().click()
await page.waitForTimeout(400)
const panel2 = await page.locator('.tr-panel').innerText()
check('切到生成模式', panel2.includes('生成转场'))
check('无关键帧时视频按钮禁用', await page.locator('.tr-panel button:has-text("生成转场视频")').isDisabled())
check('无关键帧有说明', panel2.includes('没有已确认的关键帧'))

await page.locator('.tr-panel button', { hasText: '生成关键帧' }).first().click()
await page.waitForTimeout(900)
check('关键帧候选 1 张', (await page.locator('.tr-cand').count()) === 1)
check(
  '关键帧参考包含两镜边界',
  Array.isArray(seedreamBody?.refImages) &&
    seedreamBody.refImages.includes(IMG1) &&
    seedreamBody.refImages.includes(IMG2),
  JSON.stringify(seedreamBody?.refImages || []),
)
check('关键帧提示词带上下文', String(seedreamBody?.prompt || '').includes('上一镜'), String(seedreamBody?.prompt || '').slice(0, 40))

await page.locator('.tr-panel button', { hasText: '生成转场视频' }).first().click()
await page.waitForTimeout(4200)
check('转场视频已生成', (await page.locator('.tr-video').count()) === 1)
check('chip → 生成 1.2s', (await chipTexts())[0] === '生成 1.2s', (await chipTexts()).join('|'))
check('生成转场总长 6.8s', (await timelineText()).includes('6.8s'), await timelineText())
check(
  '视频请求带边界 + 关键帧',
  videoBody?.transition?.boundaryOut === IMG1 &&
    videoBody?.transition?.boundaryIn === IMG2 &&
    videoBody?.transition?.keyframe === IMG1,
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
check('批量叠化跳过生成转场', (await chipTexts())[0] === '生成 1.2s', (await chipTexts()).join('|'))

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
check('清空边后重载恢复转场线', (await chipTexts())[0] === '生成 1.2s', (await chipTexts()).join('|'))
check('恢复后总长仍 6.8s', (await timelineText()).includes('6.8s'), await timelineText())
await shot('transition-05-repaired.png')

// 相邻镜头画面变化 → 需要重生成
await page.waitForTimeout(2200)
state.project.shots[0].keyframe = IMG3
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('边界变化后 chip 标失效', (await page.locator('.edge-chip.stale').count()) === 1)
await page.locator('.edge-chip-more').first().click()
await page.waitForTimeout(400)
check('面板提示需要重生成', (await page.locator('.tr-panel').innerText()).includes('需要重生成'))
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
check('非相邻 chip 标 inactive', (await page.locator('.edge-chip.inactive').count()) === 1)
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
const dryBase = {
  prompt: 'transition test',
  ratio: '16:9',
  transition: {
    keyframe: 'https://example.com/keyframe.jpg',
    boundaryOut: 'https://example.com/out.jpg',
    boundaryIn: 'https://example.com/in.jpg',
  },
}
const ark = await dry({ ...dryBase, modelKey: 'ark-video', seconds: 2 })
check(
  '方舟：关键帧作首帧、不带参考图',
  ark.json.request?.content?.some((x) => x.role === 'first_frame' && x.image_url?.url === 'https://example.com/keyframe.jpg') &&
    !ark.json.request?.content?.some((x) => x.role === 'reference_image'),
  JSON.stringify(ark.json.request?.content?.map((x) => x.role)),
)
const s25 = await dry({ ...dryBase, modelKey: 'apimart-video-seedance-2-5', seconds: 4 })
const roles = Object.fromEntries((s25.json.request?.image_with_roles || []).map((x) => [x.role, x.url]))
check(
  'Seedance 2.5：关键帧首帧 + B 首帧尾帧，不混参考图',
  roles.first_frame === 'https://example.com/keyframe.jpg' &&
    roles.last_frame === 'https://example.com/in.jpg' &&
    !roles.reference_image,
  JSON.stringify(roles),
)
check('Seedance 2.5 首尾帧用 adaptive 比例', s25.json.request?.size === 'adaptive', String(s25.json.request?.size))
const kling = await dry({ ...dryBase, modelKey: 'apimart-video-kling-v3', seconds: 3 })
check(
  'Kling v3：关键帧首帧 + B 首帧尾帧',
  (kling.json.request?.image_urls || []).length === 2 &&
    kling.json.request.image_urls[0] === 'https://example.com/keyframe.jpg' &&
    kling.json.request.image_urls[1] === 'https://example.com/in.jpg' &&
    !kling.json.request?.image_with_roles,
  JSON.stringify(kling.json.request || null),
)
const noKf = await dry({
  prompt: 'transition test',
  ratio: '16:9',
  modelKey: 'ark-video',
  seconds: 2,
  transition: { boundaryOut: 'https://example.com/out.jpg' },
})
check('缺关键帧明确拒绝', noKf.status === 400 && String(noKf.json.message || '').includes('关键帧'), String(noKf.json.message || ''))

const pageErrors = logs.filter((l) => /pageerror/i.test(l))
check('没有页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
await browser.close()
process.exit(bad ? 1 : 0)
