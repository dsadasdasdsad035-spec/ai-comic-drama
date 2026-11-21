/**
 * 导出回归：无接缝保持硬切；效果转场按重叠缩短成片。
 * 1) 直接调 /api/assemble 断言 6.0s / 5.5s
 * 2) 用 mock 项目走一遍 UI 导出（连播 → 导出成片）
 * 跑法：先 npm run dev，再 node verify-export.mjs
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { chromium } from 'playwright-core'

const API = 'http://127.0.0.1:5273'
const OUT = '/tmp/sb-shots'
/** 夹具现取：写死文件名在素材清理后会让导出步骤永远拿不到画面 */
const imgs = fs
  .readdirSync(path.join(process.cwd(), 'public', 'generated'))
  .filter((f) => /\.jpe?g$/i.test(f))
  .sort()
const vids = fs
  .readdirSync(path.join(process.cwd(), 'public', 'videos'))
  .filter((f) => /\.mp4$/i.test(f))
  .sort()
if (imgs.length < 2 || !vids.length) throw new Error('public/ 缺少测试用的图片或视频夹具')
const IMG = `/generated/${imgs[0]}`
const IMG2 = `/generated/${imgs[1]}`
const VID = `/videos/${vids[0]}`
fs.mkdirSync(OUT, { recursive: true })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---- 1. 服务端折叠 ----
const assemble = async (segments, joins) => {
  const r = await fetch(`${API}/api/assemble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      segments,
      resolution: '480p',
      ...(joins ? { joins } : {}),
    }),
  })
  const j = await r.json()
  if (!j.ok) throw new Error(j.message || '提交合成失败')
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const s = await (await fetch(`${API}/api/assemble?id=${j.id}`)).json()
    if (s.status === 'succeeded') return s
    if (s.status === 'failed') throw new Error(s.message || '合成失败')
  }
  throw new Error('合成超时')
}
const flat = [
  { seconds: 3, image: IMG },
  { seconds: 3, image: IMG2 },
]
const plain = await assemble(flat, null)
check('无 joins 保持硬切 6.0s', Math.abs(plain.seconds - 6) <= 0.11, String(plain.seconds))
const folded = await assemble(flat, [{ mode: 'cut' }, { mode: 'effect', seconds: 0.5, xfade: 'fade' }])
check('叠化 3+3-0.5=5.5s', Math.abs(folded.seconds - 5.5) <= 0.11, String(folded.seconds))
check('叠化不新增转场片段', (folded.transitions ?? 0) === 0)
/**
 * 服务端兼容：旧请求仍可能带 kind:'transition' 片段。
 * 前端不再产生这种段落，这里只确认服务端照旧接受、按真实片长计入、不报错。
 */
const clipSeconds = Number(
  execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0',
    path.join(process.cwd(), 'public', 'videos', path.basename(VID)),
  ]).toString().trim(),
) || 0
const withClip = await assemble(
  [
    { seconds: 3, image: IMG },
    { kind: 'transition', seconds: clipSeconds, video: VID },
    { seconds: 3, image: IMG2 },
  ],
  [{ mode: 'cut' }, { mode: 'effect', seconds: 0.2, xfade: 'fade' }, { mode: 'effect', seconds: 0.2, xfade: 'fade' }],
)
const expectClip = 3 + clipSeconds + 3 - 0.4
check(
  '旧 kind:transition 段落按真实片长合成',
  Math.abs(withClip.seconds - expectClip) <= 0.25,
  `${withClip.seconds} vs ${expectClip.toFixed(2)}`,
)
check('转场片段计入 transitions', (withClip.transitions ?? 0) === 1)

// ---- 2. UI 导出（mock 项目，2 镜静帧）----
const project = {
  name: 'export-e2e', aspect: '16:9',
  shots: [
    { id: 'T1', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定', keyframe: IMG, keyframe_prompt: '夜市', dialogue: '', cast: [], handEdited: [] },
    { id: 'T2', episode: 1, no: 'S02', seconds: 3, size: '中景', move: '固定', keyframe: IMG2, keyframe_prompt: '摊主', dialogue: '', cast: [], handEdited: [] },
  ],
  characters: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
}
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, shots: project.shots, characters: [], savedAt: new Date().toISOString() }),
    })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 2 }] }),
  })
})

const waitExport = async () => {
  let msg = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500)
    const m = page.locator('.pv-msg.ok').first()
    if ((await m.count()) > 0) {
      msg = (await m.innerText()).trim()
      if (/镜|失败|超时/.test(msg)) break
    }
  }
  return msg
}

// 大厅是唯一入口：先按 hash 打开被 mock 的项目，再进画布
await page.goto(`${API.replace(/\/$/, '')}/#/`, { waitUntil: 'domcontentloaded' })
const exportProjectName = await page.evaluate(async () => {
  try {
    const r = await fetch('/api/project')
    const d = await r.json()
    return (d.projects || [])[0]?.name || ''
  } catch {
    return ''
  }
})
if (exportProjectName) {
  await page.evaluate((n) => {
    window.location.hash = `#/p/${encodeURIComponent(n)}/board`
  }, exportProjectName)
}
/** 画布页先出「分集目录」：点进第 1 集才有分镜卡与连线。卡片本身可能不跳，兜底点「进分镜」 */
const reenterBoard = async () => {
  const cards = page.locator('.board-ep-card')
  if (await cards.count()) await cards.first().click()
  const detail = page.locator('.wb-bar-detail')
  try {
    await detail.waitFor({ state: 'visible', timeout: 4000 })
  } catch {
    const enter = page.locator('button', { hasText: '进分镜' }).first()
    if (await enter.count()) await enter.click()
    await detail.waitFor({ state: 'visible', timeout: 20000 })
  }
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1800)
}
await page.locator('.rail').waitFor({ timeout: 20000 })
await reenterBoard()
const exportNodeCount = await page.locator('.react-flow__node').count()
check('项目加载 2 镜', exportNodeCount === 2, String(exportNodeCount))
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('预览 6.0s', (await page.locator('.pv-time').innerText()).includes('6.0s'))
await page.screenshot({ path: `${OUT}/40-export-idle.png` })
await page.getByRole('button', { name: '导出成片' }).click()
const msgPlain = await waitExport()
check('UI 导出无转场 6.0s', msgPlain.includes('6.0s'), msgPlain.slice(0, 160))
await page.screenshot({ path: `${OUT}/41-export-plain.png` })
await page.locator('.pv-x[aria-label="关闭连播"]').click()
await page.waitForTimeout(300)

// 单击连线 → 菜单里落到转场（默认叠化 0.5s）
await page
  .locator('.react-flow__edge-shot .react-flow__edge-interaction')
  .first()
  .dispatchEvent('click', { clientX: 700, clientY: 420 })
await page.waitForTimeout(500)
await page.locator('.ctx-radio-row[data-edge-rel="transition"] .ctx-main').click()
await page.waitForTimeout(500)
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
check('标记转场 → 5.5s', (await page.locator('.ntl-sum').innerText()).includes('5.5s'))
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
check('预览 5.5s', (await page.locator('.pv-time').innerText()).includes('5.5s'))
await page.getByRole('button', { name: '导出成片' }).click()
const msgJoin = await waitExport()
check('UI 导出叠化 5.5s', msgJoin.includes('5.5s'), msgJoin.slice(0, 160))
await page.screenshot({ path: `${OUT}/42-export-dissolve.png` })

const pageErrors = logs.filter((l) => /pageerror/i.test(l))
check('没有页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '))

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
await browser.close()
process.exit(bad ? 1 : 0)
