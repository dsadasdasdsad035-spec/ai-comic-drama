/**
 * 3D 快速出片回归：右键生成 → 场景/走位调用 → 干净 POV mp4 → 元数据/持久化。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-3d-render.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-3d-render-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => {
  const r = await fetch(`${URL}${p}`, init)
  return r.json()
}
const post = (body) =>
  api(`/api/project?name=${encodeURIComponent(NAME)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '9:16' }),
})
await post({
  episodes: [
    {
      no: 1,
      title: '雨夜',
      hook: '她还活着',
      scenes: [{ no: 1, slug: '井道', place: '地下泵房', time: '深夜', beats: 'A 在门口停下', characters: ['A'], intensity: 6, tone: '悬疑' }],
    },
  ],
  shots: [
    {
      id: 'E01-S01',
      episode: 1,
      no: 'S01',
      scene_no: 1,
      scene_slug: '井道',
      seconds: 2,
      size: '中景',
      move: '推',
      desc: 'A 在门口停下',
      cast: ['A'],
      dialogue: [{ speaker: 'A', text: '别动' }],
      keyframe_prompt: 'A at the door',
      shot_scene: { id: 'E01-S01', episode: 1, sceneNo: 1, sceneSlug: '井道', w: 10, h: 8, walls: [], props: [{ id: 'p1', name: '铁箱', shape: 'box', x: 2, z: 2, w: 1, d: 0.6, h: 1, rotation: 0 }], zones: [], source: 'legacy' },
      shot_blocking: {
        keys: [
          { t: 0, actors: [{ name: 'A', x: 0.4, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } },
          { t: 1, actors: [{ name: 'A', x: 0.5, y: 0.5, face: 5 }], camera: { x: 0.5, y: 0.82, lookX: 0.5, lookY: 0.5, height: 1.62, fov: 44 } },
        ],
        source: 'legacy',
      },
    },
  ],
})

const sceneJson = {
  w: 10,
  h: 8,
  walls: [
    { x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 },
    { x1: 0, z1: 8, x2: 10, z2: 8, height: 2.8, thickness: 0.18, openings: [{ at: 6, width: 1, height: 2.1, kind: 'door' }] },
    { x1: 0, z1: 0, x2: 0, z2: 8, height: 2.8, thickness: 0.18 },
    { x1: 10, z1: 0, x2: 10, z2: 8, height: 2.8, thickness: 0.18 },
  ],
  props: [{ name: '铁箱', shape: 'box', x: 2, z: 2, w: 1, d: 0.6, h: 1, rotation: 0 }],
  zones: [{ name: '表演区', kind: 'action', x: 2, z: 2, w: 4, d: 3 }],
}
const blockingJson = {
  keys: [
    { t: 0, actors: [{ name: 'A', x: 0.4, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.45, height: 1.6, fov: 45 } },
    { t: 1, actors: [{ name: 'A', x: 0.45, y: 0.5, face: 5 }], camera: { x: 0.5, y: 0.82, lookX: 0.5, lookY: 0.45, height: 1.62, fov: 44 } },
  ],
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
p.on('console', (m) => {
  const u = m.location()?.url || ''
  if (
    m.type() === 'error' &&
    !/fake|verify-/.test(u) &&
    !/Expected static flag/.test(m.text()) &&
    !/Failed to load resource|404/.test(m.text())
  ) {
    errors.push('console: ' + m.text() + ' @ ' + u)
  }
})
const textPosts = []
await p.route('**/api/text', (route) => {
  const body = JSON.parse(route.request().postData() || '{}')
  textPosts.push(body)
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json: { scene: sceneJson, blocking: blockingJson, notes: 'bundle' }, text: '' }),
  })
})

await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(900)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(800)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)

const stored = () =>
  p.evaluate((name) => JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}'), NAME)
const nodeId = await p.evaluate(
  ({ name }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  },
  { name: NAME },
)
check('目标镜头进入画布', Boolean(nodeId), String(nodeId))
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(500)
await p.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await p.waitForTimeout(300)
await p.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()

const nodeData = async () => {
  const s = await stored()
  return (s.nodes || []).find((x) => x.id === nodeId)?.data ?? null
}
let d = null
for (let i = 0; i < 80; i++) {
  await p.waitForTimeout(750)
  d = await nodeData()
  if (d?.scheduleVideo && d?.scheduleMeta) break
  if (d?.scheduleVideo && !d?.shotBlocking) break
}
check('生成调度视频', typeof d?.scheduleVideo === 'string' && d.scheduleVideo.startsWith('/videos/'), String(d?.scheduleVideo))
check('生成镜头走位', Array.isArray(d?.shotBlocking?.keys) && d.shotBlocking.keys.length === 2, JSON.stringify(d?.shotBlocking?.keys?.length))
check('走位写入场次', d?.sceneNo === 1 && d?.sceneSlug === '井道', JSON.stringify({ no: d?.sceneNo, slug: d?.sceneSlug }))
check('渲染元数据 clean/2s/9:16', d?.scheduleMeta?.mode === 'clean' && d?.scheduleMeta?.duration === 2 && d?.scheduleMeta?.aspect === '9:16', JSON.stringify(d?.scheduleMeta))
check('运镜文案非固定 0.6 米', typeof d?.motionNote === 'string' && d.motionNote.length > 8 && !d.motionNote.includes('0.6 米'), String(d?.motionNote).slice(0, 100))
check('legacy 路径不请求文本模型', textPosts.length === 0, JSON.stringify(textPosts.map((x) => String(x.prompt).slice(0, 8))))
check('legacy 走位/场景来自已有结构化数据', d?.shotBlocking?.keys?.length === 2 && Boolean(d?.shotScene))

const file = d?.scheduleVideo ? `public${d.scheduleVideo}` : ''
check('视频文件落盘', Boolean(file) && fs.existsSync(file), file)
let probe = null
if (file && fs.existsSync(file)) {
  probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  )
  const stream = probe.streams?.[0]
  const dur = Number(probe.format?.duration)
  check('视频尺寸跟随 9:16', stream?.width === 540 && stream?.height === 960, JSON.stringify(stream))
  check('视频时长约 2 秒', dur >= 1.8 && dur <= 2.3, String(dur))
}

// 保存视频失败：旧视频/元数据必须保持不变
const beforeVideo = d?.scheduleVideo
const beforeMeta = JSON.stringify(d?.scheduleMeta)
await p.route('**/api/save-video', (route) =>
  route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: '模拟转码失败' }) }),
)
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await p.waitForTimeout(400)
await p.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await p.waitForTimeout(300)
await p.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()
await p.waitForTimeout(4200)
const afterFail = await nodeData()
check('保存视频失败不覆盖旧视频', afterFail?.scheduleVideo === beforeVideo, `${afterFail?.scheduleVideo} / ${beforeVideo}`)
check('保存视频失败不覆盖旧元数据', JSON.stringify(afterFail?.scheduleMeta) === beforeMeta)
await p.unroute('**/api/save-video')

const project = (await api(`/api/project?name=${encodeURIComponent(NAME)}`)).project
const shot = project.shots?.find((s) => s.id === 'E01-S01')
check('每镜 shotScene 持久化', shot?.shot_scene?.id === 'E01-S01' && shot?.shot_scene?.props?.length === 1, JSON.stringify(shot?.shot_scene?.id))
check('走位/元数据持久化', shot?.shot_blocking?.keys?.length === 2 && shot?.schedule_meta?.mode === 'clean', JSON.stringify(shot?.schedule_meta))
check('页面无异常', errors.length === 0, errors.join('\n').slice(0, 500))

await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
