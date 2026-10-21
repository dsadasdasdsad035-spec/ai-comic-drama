/**
 * 3D 调度视频参考 UI / 路由验证（Playwright，不调用真实 Seedance）：
 * 1) 设置页：2.0/2.5 预置、支持视频参考勾选、2.5 任务类型持久化
 * 2) Inspector：视频参考开关、抽帧/尾帧互斥
 * 3) 出片请求：refVideos、@视频1、无首帧/尾帧/cameraFixed
 * 4) /api/seedance dryRun：2.0 走 Files API mock、1.0 / 缺文件 / 非方舟渠道报错
 *
 * 建议用独立实例跑：
 *   SB_PROJECTS_DIR=/tmp/video-ref-ui npm run dev -- --port 5280
 *   APP_URL=http://127.0.0.1:5280 node verify-video-ref-ui.mjs
 * 没有 5280 实例时会跳过（verify-all 不会因此变红）。
 */
import http from 'node:http'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) => fetch(`${APP_URL}${p}`, init).then((r) => r.json())
const postJson = (p, body) =>
  api(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const putSettings = (body) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

// 测试夹具：3 秒 960×540 的 mp4 / webm，避免依赖 public/videos 里恰好有素材
const FIXTURE_MP4 = 'public/videos/schedule-test.mp4'
const FIXTURE_WEBM = 'public/videos/schedule-test.webm'
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg'
fs.mkdirSync('public/videos', { recursive: true })
if (!fs.existsSync(FIXTURE_MP4)) {
  execFileSync(
    FFMPEG,
    ['-y', '-f', 'lavfi', '-i', 'color=c=white:s=960x540:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FIXTURE_MP4],
    { stdio: 'ignore' },
  )
}
if (!fs.existsSync(FIXTURE_WEBM)) {
  execFileSync(
    FFMPEG,
    ['-y', '-i', FIXTURE_MP4, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '45', '-an', FIXTURE_WEBM],
    { stdio: 'ignore' },
  )
}

const health = await fetch(`${APP_URL}/api/health`).then((r) => r.json()).catch(() => null)
if (!health) {
  console.error(`跳过：dev server 未启动：${APP_URL}（需要独立实例，见文件头）`)
  process.exit(0)
}
const original = (await api('/api/settings')).settings
const model20 = (original.models || []).find((m) => m.key === 'ark-video-2-0')
const model25 = (original.models || []).find((m) => m.key === 'ark-video-2-5')
check('预置 Seedance 2.0', Boolean(model20?.supportsVideoRef), JSON.stringify(model20))
check('预置 Seedance 2.5 任务类型', model25?.videoRefTaskType === 'reference', JSON.stringify(model25))
check('默认 video 仍是 1.0', original.defaults?.video === 'ark-video', String(original.defaults?.video))

// 独立项目：用于验证 use_schedule_video_ref 真的写进 project.json
const PROJECT = 'aaa-video-ref-ui'
await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '视频参考 UI 测试' }),
}).catch(() => {})
await api(`/api/project?name=${PROJECT}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: '测试集', scenes: [] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'E01-S01',
        seconds: 3,
        size: '中景',
        move: '推',
        keyframe_prompt: '人物站在门口，雨丝斜切画面',
        video_prompt: '镜头缓慢前推',
        keyframe: '/generated/none.jpg',
        schedule_video: '/videos/schedule-test.mp4',
        schedule_frames: ['/generated/sched-test-0.jpg', '/generated/sched-test-1.jpg'],
        motion_note: '机位在场地正南侧、距场地中心约 1.0 米、高 1.6 米',
      },
    ],
  }),
})

// ---- 本地 Files API mock：route dryRun 不碰真实方舟 ----
let mockOrigin = ''
let mockUploads = 0
const mock = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  const send = (status, obj) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }
  if (req.method === 'POST' && u.pathname === '/api/v3/files') {
    mockUploads++
    for await (const _ of req) {
      /* 排空 multipart */
    }
    return send(200, { id: 'file-mock', status: 'processing' })
  }
  if (req.method === 'GET' && u.pathname === '/api/v3/files/file-mock') {
    return send(200, {
      id: 'file-mock',
      status: 'active',
      download_url: `${mockOrigin}/video.mp4`,
      expire_at: Math.floor(Date.now() / 1000) + 3600,
    })
  }
  res.statusCode = 404
  res.end('not found')
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
mockOrigin = `http://127.0.0.1:${mock.address().port}`

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

try {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    localStorage.setItem('storyboard-model-pick', JSON.stringify({ video: 'ark-video-2-0' }))
    localStorage.removeItem('storyboard-canvas-v1')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  // 用镜头表把项目里的镜头推到画布：这会填 syncedRef，后续改动才写回 project.json
  await page.locator('header').getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1500)
  await page.locator('header').getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(1200)

  const nodeId = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  })
  check('镜头已生成到画布', Boolean(nodeId), String(nodeId))
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    if (!el) return
    const opt = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
  }, nodeId)
  await page.waitForTimeout(600)

  const modelSelect = page.locator('[data-cap-model-select="video"] select')
  check('视频选择器列出 2.0', (await modelSelect.locator('option', { hasText: 'Seedance 2.0' }).count()) > 0)
  check('当前选中 2.0', (await modelSelect.inputValue()) === 'ark-video-2-0', await modelSelect.inputValue())

  const vrLabel = page.locator('.vid-box label.chk', { hasText: '用 3D 调度视频作参考' })
  const vrChk = vrLabel.locator('input[type=checkbox]')
  check('视频参考开关可见', (await vrLabel.count()) === 1)
  check('视频参考可勾选（模型支持）', !(await vrChk.isDisabled()))
  await vrChk.check()
  await page.waitForTimeout(250)

  const framesChk = page
    .locator('.vid-box label.chk', { hasText: '带调度关键帧作参考' })
    .locator('input[type=checkbox]')
  check('勾视频参考后抽帧禁用', await framesChk.isDisabled())
  check('抽帧显示已忽略', (await page.locator('.vid-box').innerText()).includes('视频参考优先，抽帧已忽略'))
  const tailChk = page
    .locator('.vid-box label.chk', { hasText: '以下一镜画面作尾帧约束' })
    .locator('input[type=checkbox]')
  check('尾帧约束禁用', await tailChk.isDisabled())
  check(
    '显示首尾帧互斥原因',
    (await page.locator('.vid-box').innerText()).includes('视频参考模式下不再有首帧/尾帧硬锁'),
  )

  await page.waitForTimeout(1600)
  const saved = (await api(`/api/project?name=${PROJECT}`)).project
  const savedShot = (saved.shots || []).find((s) => s.id === 'E01-S01')
  check('use_schedule_video_ref 落库', savedShot?.use_schedule_video_ref === true, JSON.stringify(savedShot))
  check(
    'schedule_video 仍是本地路径',
    savedShot?.schedule_video === '/videos/schedule-test.mp4',
    String(savedShot?.schedule_video),
  )

  const posts = []
  await page.route('**/api/seedance**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData() || '{}'))
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: 'fake-video', mode: 'video' }),
      })
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
    })
  })

  await page.getByRole('button', { name: '生成视频', exact: true }).click()
  await page.waitForTimeout(1200)
  check('拦截到出片请求', posts.length === 1, String(posts.length))
  if (posts.length) {
    const b = posts[0]
    check(
      '请求带 refVideos',
      Array.isArray(b.refVideos) && b.refVideos[0] === '/videos/schedule-test.mp4',
      JSON.stringify(b.refVideos),
    )
    check('不带首帧 image', !b.image, String(b.image))
    check('不带 lastFrame', !b.lastFrame, String(b.lastFrame))
    check('不带 cameraFixed', !('cameraFixed' in b), JSON.stringify(b.cameraFixed))
    check('modelKey 是 2.0', b.modelKey === 'ark-video-2-0', String(b.modelKey))
    check('提示词用 @视频1', /@视频1/.test(String(b.prompt)), String(b.prompt).slice(0, 120))
    check(
      '提示词限定白模范围',
      /不要照搬/.test(String(b.prompt)) && /白模/.test(String(b.prompt)) && /文字标签/.test(String(b.prompt)),
      String(b.prompt).slice(0, 200),
    )
    check(
      '参考图用 @图像N',
      Array.isArray(b.refImages) && b.refImages.includes('/generated/none.jpg') && /@图像1/.test(String(b.prompt)),
      JSON.stringify(b.refImages),
    )
    check(
      '视频参考时忽略抽帧',
      !(b.refImages || []).includes('/generated/sched-test-0.jpg'),
      JSON.stringify(b.refImages),
    )
  }

  // 取消视频参考，回到 1.0 的抽帧通路
  await vrChk.uncheck()
  await page.waitForTimeout(250)
  check('取消视频参考后抽帧可勾', !(await framesChk.isDisabled()))
  await framesChk.check()
  await page.getByRole('button', { name: '重出视频', exact: true }).click()
  await page.waitForTimeout(1200)
  check('第二次出片请求', posts.length === 2, String(posts.length))
  if (posts.length >= 2) {
    const b2 = posts[1]
    check('取消视频参考后不带 refVideos', !b2.refVideos, JSON.stringify(b2.refVideos))
    check(
      '抽帧进入 refImages',
      Array.isArray(b2.refImages) && b2.refImages.includes('/generated/sched-test-0.jpg'),
      JSON.stringify(b2.refImages),
    )
    check('提示词回到 [图N]', /\[图1\]/.test(String(b2.prompt)), String(b2.prompt).slice(0, 120))
    check('首帧模式带 cameraFixed', 'cameraFixed' in b2, JSON.stringify(b2.cameraFixed))
  }

  // ---- 设置页 ----
  const nav = (name) => page.locator('header').getByRole('button', { name, exact: true }).click()
  await nav('设置')
  await page.waitForSelector('h3:text-is("模型表")')
  check('设置页有视频参考分组', (await page.locator('body').innerText()).includes('视频 · 多参考图 / 视频参考'))

  const itemByLabel = async (label) => {
    const idx = await page.locator('.st-model-item').evaluateAll(
      (items, label) => items.findIndex((el) => el.querySelector('input.st-model-label')?.value === label),
      label,
    )
    if (idx < 0) throw new Error(`找不到模型行：${label}`)
    return page.locator('.st-model-item').nth(idx)
  }
  const item20 = await itemByLabel('Seedance 2.0（视频参考）')
  const item25 = await itemByLabel('Seedance 2.5（视频参考）')
  check('2.0 预置已勾选支持视频参考', await item20.locator('.st-model-video-ref input').isChecked())
  check('2.5 任务类型为参考生视频', (await item25.locator('.st-model-video-ref select').inputValue()) === 'reference')

  await item20.locator('.st-model-video-ref input').uncheck()
  await item25.locator('.st-model-video-ref select').selectOption('')
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.waitForTimeout(900)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await nav('设置')
  await page.waitForSelector('h3:text-is("模型表")')
  const item20b = await itemByLabel('Seedance 2.0（视频参考）')
  const item25b = await itemByLabel('Seedance 2.5（视频参考）')
  check('视频参考勾选保存后仍生效', !(await item20b.locator('.st-model-video-ref input').isChecked()))
  check('2.5 任务类型保存后仍生效', (await item25b.locator('.st-model-video-ref select').inputValue()) === '')
  await item20b.locator('.st-model-video-ref input').check()
  await item25b.locator('.st-model-video-ref select').selectOption('reference')
  await page.getByRole('button', { name: '保存设置' }).click()
  await page.waitForTimeout(700)

  // ---- /api/seedance dryRun：mock Files API + 预检 ----
  const mockProviders = original.providers.map((p) =>
    p.id === 'ark' ? { ...p, baseUrl: `${mockOrigin}/api/v3`, apiKey: 'test-key' } : p,
  )
  await putSettings({ providers: mockProviders, models: original.models, defaults: original.defaults })

  const dry20 = await postJson('/api/seedance', {
    dryRun: true,
    refVideos: ['/videos/schedule-test.mp4'],
    prompt: '参考调度视频',
    seconds: 3,
    modelKey: 'ark-video-2-0',
  })
  check('dryRun 2.0 成功', dry20.ok === true && dry20.mode === 'video', JSON.stringify(dry20).slice(0, 200))
  const content = dry20.request?.content ?? []
  const videoItems = content.filter((c) => c.type === 'video_url')
  check(
    'dryRun 请求带 reference_video 与 mock 地址',
    videoItems.length === 1 &&
      videoItems[0].role === 'reference_video' &&
      String(videoItems[0].video_url?.url || '').startsWith(mockOrigin),
    JSON.stringify(videoItems),
  )
  check(
    'dryRun 不带首帧/尾帧/camera_fixed',
    !content.some((c) => c.role === 'first_frame' || c.role === 'last_frame') &&
      !('camera_fixed' in (dry20.request || {})),
    JSON.stringify(dry20.request),
  )
  check(
    'dryRun 提示词自动补 @视频1',
    /@视频1/.test(String(dry20.request?.content?.[0]?.text || '')),
    String(dry20.request?.content?.[0]?.text || '').slice(0, 120),
  )

  const dryWebm = await postJson('/api/seedance', {
    dryRun: true,
    refVideos: ['/videos/schedule-test.webm'],
    prompt: 'x',
    seconds: 3,
    modelKey: 'ark-video-2-0',
  })
  const webmVideo = (dryWebm.request?.content ?? []).find((c) => c.type === 'video_url')
  check(
    'webm 自动转 mp4 后上传',
    dryWebm.ok === true && String(webmVideo?.video_url?.url || '').startsWith(mockOrigin),
    JSON.stringify(dryWebm).slice(0, 240),
  )

  // 1.0 老通路回归：首帧 + 尾帧、多参考图都不能被视频参考分支影响
  const dryFirst = await postJson('/api/seedance', {
    dryRun: true,
    image: 'data:image/png;base64,AA',
    lastFrame: 'data:image/png;base64,BB',
    prompt: 'x',
    seconds: 3,
    modelKey: 'ark-video',
    cameraFixed: true,
  })
  const firstRoles = (dryFirst.request?.content ?? []).map((c) => c.role)
  check(
    '1.0 首帧 + 尾帧未回归',
    dryFirst.ok === true &&
      dryFirst.mode === 'first' &&
      firstRoles.includes('first_frame') &&
      firstRoles.includes('last_frame') &&
      dryFirst.request?.camera_fixed === true,
    JSON.stringify({ mode: dryFirst.mode, firstRoles, camera_fixed: dryFirst.request?.camera_fixed }),
  )

  const dryRef = await postJson('/api/seedance', {
    dryRun: true,
    refImages: ['data:image/png;base64,AA', 'data:image/png;base64,BB'],
    prompt: 'x',
    seconds: 3,
  })
  const refRoles = (dryRef.request?.content ?? []).map((c) => c.role)
  check(
    '1.0 多参考图未回归',
    dryRef.ok === true &&
      dryRef.mode === 'ref' &&
      refRoles.filter((r) => r === 'reference_image').length === 2 &&
      String(dryRef.model).includes('lite-i2v'),
    JSON.stringify({ mode: dryRef.mode, refRoles, model: dryRef.model }),
  )

  const bad10 = await postJson('/api/seedance', {
    dryRun: true,
    refVideos: ['/videos/schedule-test.mp4'],
    prompt: 'x',
    seconds: 3,
    modelKey: 'ark-video',
  })
  check(
    '1.0 被明确拒绝',
    bad10.ok === false && bad10.kind === 'video-ref-unsupported' && /2\.0/.test(bad10.message),
    JSON.stringify(bad10),
  )
  const badMissing = await postJson('/api/seedance', {
    dryRun: true,
    refVideos: ['/videos/nope.mp4'],
    prompt: 'x',
    seconds: 3,
    modelKey: 'ark-video-2-0',
  })
  check(
    '缺调度视频被拒绝',
    badMissing.ok === false && /不存在/.test(badMissing.message),
    JSON.stringify(badMissing),
  )

  const mockProvider = {
    id: 'mock-openai',
    label: 'Mock OpenAI',
    kind: 'openai',
    baseUrl: 'https://example.com/v1',
    apiKey: 'x',
    caps: ['video'],
  }
  const mockModel = {
    key: 'mock-openai-video',
    label: 'Mock 视频',
    cap: 'video',
    provider: 'mock-openai',
    model: 'mock-v',
    supportsVideoRef: true,
  }
  await putSettings({
    providers: [...mockProviders, mockProvider],
    models: [...original.models, mockModel],
    defaults: original.defaults,
  })
  const badProvider = await postJson('/api/seedance', {
    dryRun: true,
    refVideos: ['/videos/schedule-test.mp4'],
    prompt: 'x',
    seconds: 3,
    modelKey: 'mock-openai-video',
  })
  check(
    '非方舟渠道被拒绝',
    badProvider.ok === false && /方舟协议渠道/.test(badProvider.message),
    JSON.stringify(badProvider),
  )
} finally {
  await putSettings({
    providers: original.providers,
    models: original.models,
    defaults: original.defaults,
  }).catch(() => {})
  await browser.close()
  await new Promise((resolve) => mock.close(resolve))
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
