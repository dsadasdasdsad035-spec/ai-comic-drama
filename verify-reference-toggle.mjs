/**
 * 3D 参考开关验收：已开启的参考在视频过期或模型不支持 videoRef 时仍可取消；
 * 未开启且不可用时保持禁用；新鲜视频 + 2.0 模型仍可正常勾选。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-reference-toggle.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const PROJECT = `ref-toggle-${Date.now()}`
const EVIDENCE = path.join(ROOT, 'openspec/changes/3d-reference-toggle/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())

const tmp = fs.mkdtempSync(path.join(ROOT, '.verify-ref-toggle-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(ROOT, 'src/scheduleGeometry.ts'))}\n`)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(ROOT, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const geo = await import(bundle)

const FIXTURE = path.join(ROOT, 'public/videos/schedule-test.mp4')
fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
if (!fs.existsSync(FIXTURE)) {
  execFileSync(
    process.env.FFMPEG_BIN || 'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=960x540:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FIXTURE],
    { stdio: 'ignore' },
  )
}

const layout = {
  id: 'E01-SC01',
  episode: 1,
  sceneNo: 1,
  sceneSlug: '井道',
  w: 10,
  h: 8,
  walls: [],
  props: [],
  zones: [],
  source: 'manual',
}
const blocking = {
  keys: [{ t: 0, actors: [], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } }],
  source: 'manual',
}
const freshScene = { ...layout, id: 'E01-S02' }
const freshMeta = {
  version: 1,
  fingerprint: geo.scheduleFingerprint({ layout: freshScene, blocking, duration: 3, aspect: '16:9', mode: 'clean' }),
  mode: 'clean',
  duration: 3,
  aspect: '16:9',
  width: 960,
  height: 540,
  renderedAt: new Date().toISOString(),
}
const baseShot = {
  episode: 1,
  scene_no: 1,
  scene_slug: '井道',
  seconds: 3,
  size: '中景',
  move: '固定',
  cast: [],
  dialogue: '',
  keyframe_prompt: '参考开关测试',
  schedule_video: '/videos/schedule-test.mp4',
  schedule_frames: ['/generated/ref-toggle-frame.png'],
  shot_blocking: blocking,
}
await api(`/api/project?name=${encodeURIComponent(PROJECT)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: PROJECT, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(PROJECT)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
    shots: [
      {
        ...baseShot,
        id: 'E01-S01',
        no: 'S01',
        shot_scene: { ...layout, id: 'E01-S01' },
        use_schedule_video_ref: true,
        use_schedule_frames: true,
      },
      {
        ...baseShot,
        id: 'E01-S02',
        no: 'S02',
        shot_scene: freshScene,
        schedule_meta: freshMeta,
        use_schedule_video_ref: false,
        use_schedule_frames: false,
      },
    ],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'ref-toggle-mock'),
  { id: 'ref-toggle-mock', label: 'Ref Toggle Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'video', 'videoRef'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'ref-toggle-video' && m.key !== 'ref-toggle-video-1'),
  { key: 'ref-toggle-video', label: 'Ref Toggle 2.0', cap: 'video', provider: 'ref-toggle-mock', model: 'ref-toggle-2', supportsVideoRef: true },
  { key: 'ref-toggle-video-1', label: 'Ref Toggle 1.0', cap: 'video', provider: 'ref-toggle-mock', model: 'ref-toggle-1', supportsVideoRef: false },
]
settings.defaults = { ...(settings.defaults || {}), video: 'ref-toggle-video' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) {
    errors.push('console: ' + m.text())
  }
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  }
  return route.continue()
})

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
await page.evaluate(({ project }) => {
  localStorage.setItem('storyboard-model-pick', JSON.stringify({ video: 'ref-toggle-video' }))
  localStorage.removeItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`)
}, { project: PROJECT })
await page.reload({ waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(PROJECT)
await page.waitForTimeout(900)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(800)

const nodeId = async (shotId) =>
  page.evaluate(({ name, shotId }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === shotId)?.id
  }, { name: PROJECT, shotId })
const nodeData = async (shotId) =>
  page.evaluate(({ name, shotId }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === shotId)?.data
  }, { name: PROJECT, shotId })
const selectShot = async (shotId) => {
  const id = await nodeId(shotId)
  if (!id) return false
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    if (!el) return
    const opt = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
  }, id)
  await page.waitForTimeout(500)
  return true
}
const openVideoSchedule = async () => {
  const tab = page.locator('.si-tabs [role="tab"]', { hasText: '视频' })
  if ((await tab.count()) > 0) {
    await tab.click()
    await page.waitForTimeout(250)
  }
  const schedule = page.locator('[data-section="schedule"]')
  if ((await schedule.count()) > 0 && !(await schedule.evaluate((el) => el.open))) {
    await schedule.locator('summary').click()
    await page.waitForTimeout(250)
  }
}
const pollShot = async (shotId, predicate, timeout = 6000) => {
  const started = Date.now()
  let shot = null
  while (Date.now() - started < timeout) {
    const project = (await api(`/api/project?name=${encodeURIComponent(PROJECT)}`)).project
    shot = (project?.shots || []).find((s) => s.id === shotId)
    if (predicate(shot)) return shot
    await page.waitForTimeout(250)
  }
  return shot
}

check('两个镜头进入画布', Boolean(await nodeId('E01-S01')) && Boolean(await nodeId('E01-S02')))
check('选中过期镜头', await selectShot('E01-S01'))
await openVideoSchedule()
const vrLabel = page.locator('.vid-box label.chk', { hasText: '用 3D 调度视频作参考' })
const vrChk = vrLabel.locator('input[type=checkbox]')
const framesLabel = page.locator('.vid-box label.chk', { hasText: '带调度关键帧作参考' })
const framesChk = framesLabel.locator('input[type=checkbox]')

check('过期视频显示已过期', (await page.locator('.sched-badge').innerText()).includes('已过期'), await page.locator('.sched-badge').innerText())
check('过期视频参考默认开启', await vrChk.isChecked())
check('过期视频参考可以取消', !(await vrChk.isDisabled()))
check('过期视频提示取消不需要重渲', (await vrLabel.innerText()).includes('取消不需要重渲'), await vrLabel.innerText())
await page.locator('.vid-box').scrollIntoViewIfNeeded()
await page.waitForTimeout(250)
await page.screenshot({ path: path.join(EVIDENCE, 'stale-video-ref-on.png') })
await vrChk.uncheck()
await page.waitForTimeout(500)
check('取消后视频参考关闭', !(await vrChk.isChecked()))
check('未勾选且过期时视频参考禁用', await vrChk.isDisabled())

check('关键帧参考默认开启', await framesChk.isChecked())
check('过期关键帧参考可以取消', !(await framesChk.isDisabled()))
check('过期关键帧提示取消不需要重渲', (await framesLabel.innerText()).includes('取消不需要重渲'), await framesLabel.innerText())
await framesChk.uncheck()
await page.waitForTimeout(500)
check('取消后关键帧参考关闭', !(await framesChk.isChecked()))
check('未勾选且过期时关键帧参考禁用', await framesChk.isDisabled())

const savedS1 = await pollShot('E01-S01', (s) => s?.use_schedule_video_ref === false && s?.use_schedule_frames === false)
check('use_schedule_video_ref 落库为 false', savedS1?.use_schedule_video_ref === false, String(savedS1?.use_schedule_video_ref))
check('use_schedule_frames 落库为 false', savedS1?.use_schedule_frames === false, String(savedS1?.use_schedule_frames))
check('取消参考保留 3D 视频', savedS1?.schedule_video === '/videos/schedule-test.mp4', String(savedS1?.schedule_video))
check('取消参考保留关键帧', (savedS1?.schedule_frames ?? []).length === 1, JSON.stringify(savedS1?.schedule_frames))

check('选中新鲜镜头', await selectShot('E01-S02'))
await openVideoSchedule()
check('新鲜视频显示生效', (await page.locator('.sched-badge').innerText()).includes('生效'), await page.locator('.sched-badge').innerText())
check('新鲜视频参考未勾选', !(await vrChk.isChecked()))
check('新鲜视频参考可以勾选', !(await vrChk.isDisabled()))
await vrChk.check()
await page.waitForTimeout(500)
check('新鲜视频参考勾选成功', await vrChk.isChecked())

const modelSelect = page.locator('[data-cap-model-select="video"] select')
await modelSelect.selectOption('ref-toggle-video-1')
await page.waitForTimeout(500)
check('模型不支持时参考仍保持勾选', await vrChk.isChecked())
check('模型不支持时仍可取消', !(await vrChk.isDisabled()))
check('模型不支持提示取消不需要重渲', (await vrLabel.innerText()).includes('取消不需要重渲'), await vrLabel.innerText())
await page.locator('.vid-box').scrollIntoViewIfNeeded()
await page.waitForTimeout(250)
await page.screenshot({ path: path.join(EVIDENCE, 'model-unsupported-ref-on.png') })
await vrChk.uncheck()
await page.waitForTimeout(500)
check('取消后模型不支持时视频参考禁用', await vrChk.isDisabled())
await modelSelect.selectOption('ref-toggle-video')
await page.waitForTimeout(500)
check('切回支持模型后可勾选', !(await vrChk.isDisabled()) && !(await vrChk.isChecked()))

await page.setViewportSize({ width: 900, height: 820 })
await page.waitForTimeout(500)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('900px 无横向溢出', !overflow)
await page.screenshot({ path: path.join(EVIDENCE, 'reference-toggle-900.png') })
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
