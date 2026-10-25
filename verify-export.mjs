/**
 * 导出回归：无接缝保持硬切；效果转场按重叠缩短成片。
 * 1) 直接调 /api/assemble 断言 6.0s / 5.5s
 * 2) 用 mock 项目走一遍 UI 导出（连播 → 导出成片）
 * 跑法：先 npm run dev，再 node verify-export.mjs
 */
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const API = 'http://127.0.0.1:5273'
const OUT = '/tmp/sb-shots'
const IMG = '/generated/shot-1792653104009-fe6e05.jpg'
const IMG2 = '/generated/shot-1792635049165-29ec33.jpg'
const VID = '/videos/shot-vid-1792813683482-86dc69.mp4'
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
const withClip = await assemble(
  [
    { seconds: 3, image: IMG },
    { kind: 'transition', seconds: 4, video: VID },
    { seconds: 3, image: IMG2 },
  ],
  [{ mode: 'cut' }, { mode: 'effect', seconds: 0.2, xfade: 'fade' }, { mode: 'effect', seconds: 0.2, xfade: 'fade' }],
)
check('无 trim 的转场片段保留真实 4s（3+4.04+3-0.4=9.6s）', Math.abs(withClip.seconds - 9.6) <= 0.16, String(withClip.seconds))
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

await page.goto(`${API}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1800)
check('项目加载 2 镜', (await page.locator('.react-flow__node').count()) === 2)
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

await page.locator('.edge-chip').first().click()
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
