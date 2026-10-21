/**
 * 调度图上画布 + 出片自动绑定验证：
 * 1) 有 layout 的卡片上出现俯视缩略图
 * 2) 菜单「显示调度图」可关可开
 * 3) 没有 ref_sheet 时直接出片 → 自动导出调度图并放进 refImages
 * 跑法：node verify-layout-canvas.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())

const project = (await api('/api/project?name=recycle')).project
const sorted = [...project.shots].sort((a, b) => String(a.no).localeCompare(String(b.no), 'zh'))
const target = sorted[0]
const backup = { layout: target.layout, ref_sheet: target.ref_sheet }

const demoLayout = {
  w: 10,
  h: 8,
  actors: [
    { name: '陈默', x: 0.25, y: 0.5, face: 0 },
    { name: '黑雨衣女人', x: 0.72, y: 0.48, face: 180 },
  ],
  camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.48 },
}

// 给目标镜注入 layout，清掉 ref_sheet 以验证「自动导出」
{
  const j = (await api('/api/project?name=recycle')).project
  const shots = j.shots.map((s) =>
    s.id === target.id ? { ...s, layout: demoLayout, ref_sheet: '', refIds: [] } : s,
  )
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { ...j, shots } }),
  })
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

const posts = []
await p.route('**/api/seedance**', async (route) => {
  if (route.request().method() === 'POST') {
    posts.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'lc-task' }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
  })
})

// 清掉上次留下的开关状态
await p.addInitScript(() => localStorage.removeItem('storyboard-layout-on'))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1200)
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
await p.locator('.bm-item', { hasText: '适配视图' }).click()
await p.waitForTimeout(1800)

const thumbs = await p.locator('.shot-layout').count()
check('卡片上出现调度缩略图', thumbs >= 1, String(thumbs))

// 关掉开关
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
await p.locator('.bm-item', { hasText: '显示调度图' }).click()
await p.waitForTimeout(700)
check('关闭后缩略图消失', (await p.locator('.shot-layout').count()) === 0)
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
await p.locator('.bm-item', { hasText: '显示调度图' }).click()
await p.waitForTimeout(700)
check('重新打开恢复', (await p.locator('.shot-layout').count()) >= 1)

// 选中目标镜 → 关掉尾帧约束 → 直接出片（不手动存图）
const nodeId = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId && x.data?.no === no)?.id
}, target.no)
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(600)
const lockBox = p.locator('.chk', { hasText: '以下一镜画面作尾帧约束' }).locator('input')
if ((await lockBox.count()) && (await lockBox.isChecked())) {
  await lockBox.uncheck()
  await p.waitForTimeout(300)
}

const hadSheet = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return Boolean((s.nodes || []).find((x) => x.id === nid)?.data?.refSheet)
}, nodeId)
check('出片前没有现成的调度图', hadSheet === false)

await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(2000)
check('出片请求发出', posts.length === 1, String(posts.length))
const body = posts[0] ?? {}
const sheetInReq = (body.refImages ?? []).find((u) => String(u).includes('layout-'))
check('自动导出的调度图进了 refImages', Boolean(sheetInReq), JSON.stringify(body.refImages))
check('调度图文件已落盘', Boolean(sheetInReq) && fs.existsSync('public' + sheetInReq), String(sheetInReq))
check('prompt 注明只取空间关系', /俯视调度示意/.test(body.prompt ?? ''))

await p.waitForTimeout(2400)
const saved = (await api('/api/project?name=recycle')).project.shots.find((s) => s.id === target.id)
check('自动生成的 ref_sheet 已落库', saved?.ref_sheet === sheetInReq, String(saved?.ref_sheet))

// 还原
{
  const j = (await api('/api/project?name=recycle')).project
  const shots = j.shots.map((s) =>
    s.id === target.id ? { ...s, layout: backup.layout, ref_sheet: backup.ref_sheet } : s,
  )
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { ...j, shots } }),
  })
}

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/layout-canvas.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
