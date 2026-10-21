/**
 * 3D 调度视频 → 出片参考（绕开 Seedance 不吃视频的限制）验证：
 * 1) 分镜卡右击只出现 3D 相关动作（2D 俯视入口已移除）
 * 2) 点击 → three.js 渲染 + MediaRecorder 录制 → /api/save-video 落盘 mp4
 * 3) /api/frames 抽出关键帧 jpg
 * 4) Inspector 出现 3D 调度预览 + 运镜文案 + 「带调度关键帧作参考」勾选项；没有 2D 俯视面板/画布缩略图
 * 5) 未勾选出片：prompt 带【运镜与走位】，参考图里没有白模帧
 * 6) 勾选后出片：白模关键帧进入 refImages
 * 7) 落库校验 + 还原
 * 跑法：node verify-schedule3d.mjs
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
const put = (project) =>
  fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  })

const j0 = (await api('/api/project?name=recycle')).project
const sorted = [...j0.shots].sort((a, b) => String(a.no).localeCompare(String(b.no), 'zh'))
const target = sorted[0]
const backup = {
  layout: target.layout,
  schedule_video: target.schedule_video,
  schedule_frames: target.schedule_frames,
  motion_note: target.motion_note,
  use_schedule_frames: target.use_schedule_frames,
}

// 预清理：目标镜调度相关数据全部清空
{
  const j = (await api('/api/project?name=recycle')).project
  const shots = j.shots.map((s) =>
    s.id === target.id
      ? {
          ...s,
          layout: undefined,
          schedule_video: '',
          schedule_frames: [],
          motion_note: '',
          use_schedule_frames: false,
        }
      : s,
  )
  await put({ ...j, shots })
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
p.on('console', (m) => {
  // 过滤两类噪音：① 桩数据 404（/videos/fake.mp4、历史跑残留的 fake 图、verify-* 素材）
  // ② React 19 dev 的 "Expected static flag was missing"（基线就有，与调度功能无关，生产构建不出现）
  const u = m.location()?.url || ''
  if (m.type() === 'error' && !/fake|verify-/.test(u) && !/Expected static flag/.test(m.text()))
    errors.push('console: ' + m.text() + ' @ ' + u)
})

// 文本模型：给两个人物 + 机位
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
          { name: '陈默', x: 0.28, y: 0.55, face: 0 },
          { name: '黑雨衣女人', x: 0.7, y: 0.45, face: 180 },
        ],
        camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5 },
      },
    }),
  }),
)
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
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1200)

const nodeId = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId && x.data?.no === no)?.id
}, target.no)
check('找到目标镜节点', Boolean(nodeId), String(target.no))

// 选中 + 右键
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(700)
await p.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await p.waitForTimeout(400)
check('右键菜单出现', (await p.locator('.ctx-menu').count()) === 1)
const actionLabels = await p.locator('.ctx-action').evaluateAll((els) => els.map((e) => e.textContent || ''))
check(
  '菜单含「生成调度视频（3D）」',
  actionLabels.some((t) => t.includes('生成调度视频（3D）')),
  actionLabels.join(' | '),
)
check(
  '菜单含「调度关键帧作参考」',
  actionLabels.some((t) => t.includes('调度关键帧作参考')),
  actionLabels.join(' | '),
)
check(
  '2D 俯视入口已移除',
  !actionLabels.some((t) => t.includes('生成调度（俯视）')),
  actionLabels.join(' | '),
)
await p.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()

// 等渲染 + 上传 + 抽帧
const nodeData = () =>
  p.evaluate((nid) => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    return (s.nodes || []).find((x) => x.id === nid)?.data ?? null
  }, nodeId)

let d = null
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000)
  d = await nodeData()
  if (d?.scheduleVideo) break
}
check('生成调度视频路径', typeof d?.scheduleVideo === 'string' && d.scheduleVideo.startsWith('/videos/'), String(d?.scheduleVideo))
check(
  '视频文件落盘',
  Boolean(d?.scheduleVideo) && fs.existsSync('public' + d.scheduleVideo),
  d?.scheduleVideo ? String(fs.statSync('public' + d.scheduleVideo).size) : '',
)
check('转出 mp4（兼容性）', String(d?.scheduleVideo || '').endsWith('.mp4'), String(d?.scheduleVideo))
check('抽出关键帧', Array.isArray(d?.scheduleFrames) && d.scheduleFrames.length >= 2, JSON.stringify(d?.scheduleFrames))
check(
  '关键帧文件落盘',
  Boolean(d?.scheduleFrames?.length) && d.scheduleFrames.every((u) => fs.existsSync('public' + u)),
  String(d?.scheduleFrames?.[0]),
)
check('生成运镜文案', typeof d?.motionNote === 'string' && d.motionNote.length > 8, String(d?.motionNote).slice(0, 60))
check('layout 同时落地', Array.isArray(d?.layout?.actors) && d.layout.actors.length === 2)

// Inspector UI
await p.waitForTimeout(600)
check('Inspector 出现 3D 调度行', (await p.locator('.sched-row').count()) === 1)
const src = await p.locator('.sched-row video').getAttribute('src').catch(() => null)
check('预览指向调度视频', src === d?.scheduleVideo, String(src))
const hints = await p.locator('.motion-hint').allInnerTexts()
check('Inspector 显示运镜文案', hints.some((t) => t.includes('运镜')), hints.join(' | ').slice(0, 80))
check('2D 俯视面板已移除', (await p.locator('.layout-box').count()) === 0)
check('画布卡片无俯视缩略图', (await p.locator('.shot-layout').count()) === 0)
const frameChk = p.locator('.chk', { hasText: '带调度关键帧作参考' }).locator('input')
check('出现关键帧勾选项（默认关）', (await frameChk.count()) === 1 && !(await frameChk.isChecked()))

const lockBox = p.locator('.chk', { hasText: '以下一镜画面作尾帧约束' }).locator('input')
if (await lockBox.isChecked()) {
  await lockBox.uncheck()
  await p.waitForTimeout(300)
}

// 5) 未勾选 → prompt 有运镜，参考图无白模帧
await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1200)
check('出片请求发出', posts.length === 1, String(posts.length))
const body1 = posts[0] ?? {}
check('prompt 带【运镜与走位】', /【运镜与走位】/.test(body1.prompt ?? ''), String(body1.prompt ?? '').slice(-70))
check(
  '未勾选时不含白模帧',
  !(body1.refImages ?? []).some((u) => (d?.scheduleFrames ?? []).includes(u)),
  JSON.stringify(body1.refImages),
)

// 6) 勾选 → 白模帧进参考
await p.waitForTimeout(2600)
await frameChk.check()
await p.waitForTimeout(400)
await p.locator('.vid-box button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1400)
check('第二次出片请求发出', posts.length === 2, String(posts.length))
const body2 = posts[1] ?? {}
check(
  '勾选后白模帧进参考图',
  (body2.refImages ?? []).some((u) => (d?.scheduleFrames ?? []).includes(u)),
  JSON.stringify(body2.refImages),
)
check('勾选后 prompt 仍带运镜', /【运镜与走位】/.test(body2.prompt ?? ''))
check('参考图不超过 4 张', (body2.refImages ?? []).length <= 4, String(body2.refImages?.length))

// 7) 落库
await p.waitForTimeout(2600)
const saved = (await api('/api/project?name=recycle')).project.shots.find((s) => s.id === target.id)
check('schedule_video 落库', saved?.schedule_video === d?.scheduleVideo, String(saved?.schedule_video))
check('schedule_frames 落库', (saved?.schedule_frames ?? []).length === (d?.scheduleFrames ?? []).length)
check('motion_note 落库', saved?.motion_note === d?.motionNote, String(saved?.motion_note).slice(0, 40))
check('use_schedule_frames 落库', saved?.use_schedule_frames === true)

// 还原
{
  const j = (await api('/api/project?name=recycle')).project
  const shots = j.shots.map((s) => (s.id === target.id ? { ...s, ...backup } : s))
  await put({ ...j, shots })
}

await p.locator('.sched-row').screenshot({ path: '/tmp/sched-row.png' }).catch(() => {})
if (errors.length) console.log('\n--- error ---\n' + errors.slice(0, 3).join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
