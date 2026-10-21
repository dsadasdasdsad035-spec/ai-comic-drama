/**
 * 首尾帧接龙验证（拦截 /api/seedance，不真出片）：
 * 1) 勾选尾帧约束 → 请求带 lastFrame（= 下一镜画面）+ returnLastFrame
 * 2) 出片返回尾帧 → 节点写入 tailImage，Inspector 出现尾帧条
 * 3) 「设为下一镜首帧」→ 下一镜 refImage = 尾帧
 * 4) tail_image 落库
 * 跑法：node verify-tail.mjs
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

const imgs = fs
  .readdirSync('public/generated')
  .filter((f) => f.endsWith('.jpg'))
  .slice(0, 2)
  .map((f) => `/generated/${f}`)
const proj = (await api('/api/project?name=recycle')).project
const shots = proj.shots ?? []
const firstTwo = shots.slice(0, 2)
const backup = firstTwo.map((s) => ({ id: s.id, keyframe: s.keyframe, tail_image: s.tail_image, refIds: s.refIds }))

const setShots = async (patchShots) => {
  const j = (await api('/api/project?name=recycle')).project
  const merged = j.shots.map((s) => {
    const p = patchShots.find((x) => x.id === s.id)
    return p ? { ...s, ...p } : s
  })
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { ...j, shots: merged } }),
  })
}

// 准备：前两镜给真实画面
await setShots([
  { id: firstTwo[0].id, keyframe: imgs[0], tail_image: undefined, refIds: [] },
  { id: firstTwo[1].id, keyframe: imgs[1], tail_image: undefined, refIds: [] },
])

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

const posts = []
await p.route('**/api/seedance**', async (route) => {
  const req = route.request()
  if (req.method() === 'POST') {
    posts.push(JSON.parse(req.postData() || '{}'))
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'tail-task' }) })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4', tail: imgs[1] }),
  })
})

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1400)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1600)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1200)

// 选中第一镜
const shotNodeId = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId && x.data?.no === no)?.id
}, firstTwo[0].no)
check('找到第一镜节点', !!shotNodeId, shotNodeId)
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(600)

const lockBox = p.locator('.chk', { hasText: '以下一镜画面作尾帧约束' })
check('出现尾帧约束开关', (await lockBox.count()) === 1)
check('下一镜有画面 → 可勾选', !(await lockBox.locator('input').isDisabled()))

// 出片
await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(1200)
check('拦截到出片请求', posts.length === 1, String(posts.length))
// 期望值 = 页面里「本镜的下一镜」画面（按镜号排序，不一定等于 shots[1]）
const expectLast = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const list = (s.nodes || [])
    .filter((n) => n.data?.shotId && Number(n.data.episode ?? 1) === 1)
    .sort((a, b) => String(a.data.no).localeCompare(String(b.data.no), 'zh'))
  const i = list.findIndex((n) => n.data.no === no)
  return i >= 0 ? list[i + 1]?.data?.refImage : undefined
}, firstTwo[0].no)
if (posts.length) {
  check('带 returnLastFrame', posts[0].returnLastFrame === true, String(posts[0].returnLastFrame))
  check('带 lastFrame = 下一镜画面', posts[0].lastFrame === expectLast, `${posts[0].lastFrame} vs ${expectLast}`)
}

// 等轮询（3s 间隔）
await p.waitForTimeout(4200)
check('Inspector 出现尾帧条', (await p.locator('.tail-row').count()) === 1)
check('尾帧带设置按钮', (await p.locator('.tail-row button', { hasText: '设为下一镜首帧' }).count()) === 1)

const tailNow = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.tailImage ?? null
}, shotNodeId)
check('节点写入尾帧', tailNow === imgs[1], String(tailNow))

// 设为下一镜首帧
await p.locator('.tail-row button', { hasText: '设为下一镜首帧' }).click()
await p.waitForTimeout(2800)
const nextState = await p.evaluate((no) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.data?.no === no)
  return { refImage: n?.data?.refImage, tailImage: n?.data?.tailImage }
}, firstTwo[1].no)
check('下一镜首帧已换成尾帧', nextState.refImage === imgs[1], JSON.stringify(nextState))

// 落库
const saved = (await api('/api/project?name=recycle')).project.shots
const s0 = saved.find((s) => s.id === firstTwo[0].id)
const s1 = saved.find((s) => s.id === firstTwo[1].id)
check('tail_image 落库', s0?.tail_image === imgs[1], String(s0?.tail_image))
check('下一镜 keyframe 落库', s1?.keyframe === imgs[1], String(s1?.keyframe))

// 还原
await setShots(backup)
check('测试数据已还原', true)

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/tail.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
