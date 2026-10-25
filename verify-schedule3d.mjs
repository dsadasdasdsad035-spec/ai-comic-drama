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
check('右键没有 3D 动作', !actionLabels.some((t) => /3D 调度|调度视频|调度关键帧/.test(t)), actionLabels.join(' | '))
check('2D 俯视入口已移除', !actionLabels.some((t) => t.includes('生成调度（俯视）')), actionLabels.join(' | '))
await p.keyboard.press('Escape')
await p.waitForTimeout(200)
await p.locator(`[data-id="${nodeId}"]`).click()
await p.waitForTimeout(500)
check('Inspector 没有 3D 区块', (await p.locator('.sched-head, .sched-row').count()) === 0)
check('Inspector 没有打开 3D 入口', !(await p.locator('.inspector').innerText()).includes('打开 3D 调度'))
check('2D 俯视面板已移除', (await p.locator('.layout-box').count()) === 0)
check('画布卡片无俯视缩略图', (await p.locator('.shot-layout').count()) === 0)

await p.getByRole('button', { name: '提示词', exact: true }).click()
await p.waitForTimeout(900)
const cell = p.locator('.pt-table tbody tr').first().locator('.pt-3d')
check('提示词工作台有 3D 入口', (await cell.locator('button', { hasText: '打开' }).count()) === 1, await cell.innerText())
await cell.locator('button', { hasText: '打开' }).click()
await p.waitForTimeout(1600)
check('提示词侧能打开 3D 工作台', (await p.locator('[aria-label="3D 代码工作台"]').count()) === 1)
await p.locator('[aria-label="3D 代码工作台"]').getByRole('button', { name: '关闭' }).click()
await p.waitForTimeout(500)

const saved = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project.shots.find((s) => s.id === 'E01-S01')
check('没有因打开 3D 自动渲染', !saved?.schedule_video, String(saved?.schedule_video))
check('没有写旧抽帧开关', saved?.use_schedule_frames !== true, String(saved?.use_schedule_frames))

if (errors.length) console.log('\n--- error ---\n' + errors.slice(0, 3).join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
