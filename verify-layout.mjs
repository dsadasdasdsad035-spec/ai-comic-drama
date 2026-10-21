/**
 * 调度（俯视）验证：
 * 1) Inspector 出现调度面板，空态有「AI 生成调度」
 * 2) AI 生成（拦截 /api/text）→ 画出人物 + 机位 + 轴线，落库 layout
 * 3) 拖拽人物后坐标变化并落库
 * 4) 「存为参考图」→ /api/save-image 生成 png 路径，落库 ref_sheet
 * 5) 出片请求把调度图放进 refImages，prompt 注明不要画出示意图
 * 跑法：node verify-layout.mjs
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

// 清空与素材库，避免干扰
await api('/api/project?name=recycle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assets: [] }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

// 拦截文本模型：给两个人物 + 机位
await p.route('**/api/text', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      model: 'fake-lite',
      text: '',
      json: {
        w: 10,
        h: 8,
        actors: [
          { name: '陈默', x: 0.25, y: 0.5, face: 0 },
          { name: '黑雨衣女人', x: 0.72, y: 0.48, face: 180 },
        ],
        camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.48 },
      },
    }),
  }),
)
const seedancePosts = []
await p.route('**/api/seedance**', async (route) => {
  if (route.request().method() === 'POST') {
    seedancePosts.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'layout-task' }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
  })
})

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1200)

// 选中目标镜
const nodeId = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId && x.data?.no === no)?.id
}, target.no)
check('找到目标镜节点', Boolean(nodeId), String(target.no))
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(700)

check('出现调度面板', (await p.locator('.layout-box').count()) === 1)
check('空态有生成按钮', (await p.locator('.layout-actions button', { hasText: 'AI 生成调度' }).count()) === 1)
check('空态画布提示', (await p.locator('.lv-empty').count()) === 1)

// AI 生成
await p.locator('.layout-actions button', { hasText: 'AI 生成调度' }).click()
await p.waitForTimeout(1600)
check('画出人物', (await p.locator('.lv-actor').count()) === 2, String(await p.locator('.lv-actor').count()))
check('画出机位', (await p.locator('.lv-cam').count()) === 1)
check('画出轴线', (await p.locator('.lv-axis').count()) === 1)

const layoutNow = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.layout ?? null
}, nodeId)
check('layout 写入节点', layoutNow?.actors?.length === 2, JSON.stringify(layoutNow?.actors?.map((a) => a.name)))

// 拖拽第一个人物
const actor = p.locator('.lv-actor').first()
const box = await actor.boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await p.mouse.down()
await p.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 10, { steps: 8 })
await p.mouse.up()
await p.waitForTimeout(600)
const moved = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.layout?.actors?.[0]?.x ?? null
}, nodeId)
check('拖拽改变站位', moved > layoutNow.actors[0].x + 0.05, `${layoutNow.actors[0].x} → ${moved}`)

// 存为参考图
await p.locator('.layout-actions button', { hasText: '存为参考图' }).click()
await p.waitForTimeout(1500)
const sheet = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.refSheet ?? null
}, nodeId)
check('生成调度图路径', typeof sheet === 'string' && sheet.startsWith('/generated/'), String(sheet))
check('调度图文件存在', Boolean(sheet) && fs.existsSync('public' + sheet))

// 出片：调度图进 refImages
// 方舟 last_frame 与 reference_image 互斥：先取消尾帧约束，验证调度图这条通路
const lockBox = p.locator('.chk', { hasText: '以下一镜画面作尾帧约束' }).locator('input')
if (await lockBox.isChecked()) {
  await lockBox.uncheck()
  await p.waitForTimeout(300)
}
await p.waitForTimeout(2200)
await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1200)
check('出片请求发出', seedancePosts.length === 1, String(seedancePosts.length))
if (seedancePosts.length) {
  const body = seedancePosts[0]
  check('refImages 含调度图', (body.refImages ?? []).includes(sheet), JSON.stringify(body.refImages))
  check('prompt 注明只取空间关系', /俯视调度示意图|不要把示意图/.test(body.prompt ?? ''), String(body.prompt).slice(-60))
}

// 落库校验
await p.waitForTimeout(2600)
const saved = (await api('/api/project?name=recycle')).project.shots.find((s) => s.id === target.id)
check('layout 落库', Array.isArray(saved?.layout?.actors) && saved.layout.actors.length === 2)
check('ref_sheet 落库', saved?.ref_sheet === sheet, String(saved?.ref_sheet))

// 还原
{
  const j = (await api('/api/project?name=recycle')).project
  const shots = j.shots.map((s) => (s.id === target.id ? { ...s, layout: backup.layout, ref_sheet: backup.ref_sheet } : s))
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { ...j, shots } }),
  })
}

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.locator('.layout-box').screenshot({ path: '/tmp/layout-panel.png' }).catch(() => {})
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
