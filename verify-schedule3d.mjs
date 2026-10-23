/**
 * 3D 调度视频 → 抽帧参考回归（新场景/走位数据链路）。
 * 覆盖：右键生成干净 POV、scheduleMeta、运镜文案、Inspector 状态、抽帧进 refImages、落库。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-schedule3d.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-schedule3d-${Date.now()}`
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())
const post = (body) =>
  api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
const sceneJson = {
  w: 10,
  h: 8,
  walls: [{ x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 }],
  props: [],
  zones: [],
}
const blockingJson = {
  keys: [
    { t: 0, actors: [{ name: 'A', x: 0.4, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
    { t: 1, actors: [{ name: 'A', x: 0.5, y: 0.5, face: 4 }], camera: { x: 0.5, y: 0.82, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 44 } },
  ],
}
await post({
  episodes: [{ no: 1, title: '测试集', scenes: [{ no: 1, slug: '井道', place: '泵房', time: '夜' }] }],
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      scene_no: 1,
      scene_slug: '井道',
      seconds: 3,
      size: '中景',
      move: '推',
      desc: 'A 在门口',
      cast: ['A'],
      keyframe: '/generated/shot-1792635057902-5480cf.jpg',
      keyframe_prompt: 'A at the door',
      shot_scene: { id: 'E01-S01', episode: 1, sceneNo: 1, sceneSlug: '井道', ...sceneJson, source: 'manual' },
      shot_blocking: { ...blockingJson, source: 'manual' },
    },
  ],
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
p.on('console', (m) => {
  if (
    m.type() === 'error' &&
    !/fake|verify-/.test(m.location()?.url || '') &&
    !/Expected static flag/.test(m.text()) &&
    !/Failed to load resource|404/.test(m.text())
  )
    errors.push('console: ' + m.text())
})
await p.route('**/api/text', (route) => {
  const body = JSON.parse(route.request().postData() || '{}')
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json: { scene: sceneJson, blocking: blockingJson }, text: '' }),
  })
})
const posts = []
await p.route('**/api/seedance**', (route) => {
  if (route.request().method() === 'POST') {
    posts.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'sched-task' }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
  })
})

await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(900)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(700)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(800)
const nodeId = await p.evaluate(
  ({ name }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  },
  { name: NAME },
)
check('找到目标镜节点', Boolean(nodeId), String(nodeId))
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(500)
await p.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await p.waitForTimeout(300)
const actionLabels = await p.locator('.ctx-action').evaluateAll((els) => els.map((e) => e.textContent || ''))
check('右键含编辑/生成 3D', actionLabels.some((t) => t.includes('编辑 3D 调度')) && actionLabels.some((t) => t.includes('生成调度视频（3D）')), actionLabels.join(' | '))
check('2D 俯视入口已移除', !actionLabels.some((t) => t.includes('生成调度（俯视）')), actionLabels.join(' | '))
await p.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()

const nodeData = async () => {
  const s = await p.evaluate((name) => JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}'), NAME)
  return (s.nodes || []).find((x) => x.id === nodeId)?.data ?? null
}
let d = null
for (let i = 0; i < 80; i++) {
  await p.waitForTimeout(750)
  d = await nodeData()
  if (d?.scheduleVideo && d?.scheduleFrames?.length) break
}
check('生成调度视频路径', typeof d?.scheduleVideo === 'string' && d.scheduleVideo.startsWith('/videos/'), String(d?.scheduleVideo))
check('视频文件落盘', Boolean(d?.scheduleVideo) && fs.existsSync('public' + d.scheduleVideo), d?.scheduleVideo || '')
check('转出 mp4', String(d?.scheduleVideo || '').endsWith('.mp4'), String(d?.scheduleVideo))
check('抽出关键帧', Array.isArray(d?.scheduleFrames) && d.scheduleFrames.length >= 2, JSON.stringify(d?.scheduleFrames))
check('生成走位与干净元数据', d?.shotBlocking?.keys?.length === 2 && d?.scheduleMeta?.mode === 'clean', JSON.stringify(d?.scheduleMeta))
check('生成运镜文案', typeof d?.motionNote === 'string' && d.motionNote.length > 8 && !d.motionNote.includes('0.6 米'), String(d?.motionNote).slice(0, 80))

await p.waitForTimeout(700)
check('Inspector 出现 3D 状态', (await p.locator('.sched-head').count()) === 1 && (await p.locator('.sched-badge.ok').count()) === 1)
check('Inspector 出现 3D 调度行', (await p.locator('.sched-row').count()) === 1)
check('2D 俯视面板已移除', (await p.locator('.layout-box').count()) === 0)
check('画布卡片无俯视缩略图', (await p.locator('.shot-layout').count()) === 0)
const frameChk = p.locator('.chk', { hasText: '带调度关键帧作参考' }).locator('input')
check('出现关键帧勾选项（默认关）', (await frameChk.count()) === 1 && !(await frameChk.isChecked()))

check('Inspector 无尾帧约束入口', (await p.locator('.chk', { hasText: '以下一镜画面作尾帧约束' }).count()) === 0)
await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1400)
check('未勾选出片请求发出', posts.length === 1, String(posts.length))
const body1 = posts[0] ?? {}
check('prompt 带【运镜与走位】', /【运镜与走位】/.test(body1.prompt ?? ''), String(body1.prompt ?? '').slice(-80))
check('未勾选时不含白模帧', !(body1.refImages ?? []).some((u) => (d?.scheduleFrames ?? []).includes(u)), JSON.stringify(body1.refImages))

await p.waitForTimeout(2600)
await frameChk.check()
await p.waitForTimeout(400)
await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1500)
check('勾选后出片请求发出', posts.length === 2, String(posts.length))
const body2 = posts[1] ?? {}
check('勾选后白模帧进参考图', (body2.refImages ?? []).some((u) => (d?.scheduleFrames ?? []).includes(u)), JSON.stringify(body2.refImages))
check('参考图不超过 4 张', (body2.refImages ?? []).length <= 4, String(body2.refImages?.length))

await p.waitForTimeout(2600)
const saved = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots.find((s) => s.id === 'E01-S01')
check('schedule_video 落库', saved?.schedule_video === d?.scheduleVideo, String(saved?.schedule_video))
check('schedule_frames 落库', (saved?.schedule_frames ?? []).length === (d?.scheduleFrames ?? []).length)
check('motion_note 落库', saved?.motion_note === d?.motionNote, String(saved?.motion_note).slice(0, 40))
check('use_schedule_frames 落库', saved?.use_schedule_frames === true)

if (errors.length) console.log('\n--- error ---\n' + errors.slice(0, 3).join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
