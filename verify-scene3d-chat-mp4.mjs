/**
 * 3D 聊天完整链路：口语需求 → agent 工具链 → finish → 聊天内 MP4 渲染与保存。
 *
 * - 默认 mock 文本/视觉模型，脚本化工具调用；Blender 渲染、MP4、抽帧为真实。
 * - 场景代码来自 fixtures/agent-duel-scene.py；镜头数据来自 fixtures/scene3d-chat-mp4-test.json。
 *
 * 跑法：
 *   APP_URL=http://127.0.0.1:5280 node verify-scene3d-chat-mp4.mjs
 *   AGENT_REAL=1 APP_URL=... node verify-scene3d-chat-mp4.mjs
 *   HEADED=1 APP_URL=... node verify-scene3d-chat-mp4.mjs   # 真实 Chrome 窗口（非 headless）
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const REAL = process.env.AGENT_REAL === '1'
const ROOT = process.cwd()
const FIXTURE_JSON = path.join(ROOT, 'fixtures/scene3d-chat-mp4-test.json')
const EVIDENCE = path.join(ROOT, 'fixtures/evidence-scene3d-chat-mp4')

const spec = JSON.parse(fs.readFileSync(FIXTURE_JSON, 'utf8'))
const FIXTURE_PATH = path.join(ROOT, spec.sceneCodeFixture || 'fixtures/agent-duel-scene.py')
const FIXTURE = fs.readFileSync(FIXTURE_PATH, 'utf8').trim()
const SECONDS = Number(spec.seconds) || 4
const EXPECTED_FRAMES = SECONDS > 6 ? 9 : 5
const USER_PROMPT = String(spec.userPrompt || '').trim()
const REQUIREMENTS = Array.isArray(spec.requirements) ? spec.requirements : ['主体可见']
const FINISH_SUMMARY = String(spec.mockAgentSummary || '预演完成')
const NAME = `scene3d-chat-mp4-${REAL ? 'real' : 'mock'}-${Date.now()}`

fs.mkdirSync(EVIDENCE, { recursive: true })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const health = await api('/api/blender/health').catch(() => ({ ok: false, message: '无法连接 dev server' }))
if (!health.ok) {
  console.log(`⏭ 跳过：${health.message || 'Blender 不可用'}。请先 npm run dev 并确认 ${URL}/api/blender/health`)
  process.exit(0)
}
console.log(`Blender ${health.version || '?'} · ${health.path || ''}`)

const shotSeed = {
  ...spec.shot,
  seconds: SECONDS,
  scene_code: {
    version: 1,
    abiVersion: 1,
    code: '# placeholder',
    codeHash: sha('# placeholder'),
    source: 'manual',
    updatedAt: new Date().toISOString(),
  },
}

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: spec.projectAspect || '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: spec.episodes || [],
    characters: [],
    shots: [shotSeed],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
const frameTimes = SECONDS > 6
  ? [0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12].filter((t) => t <= SECONDS)
  : [0, 1, 2, 3, 4].filter((t) => t <= SECONDS)

/** mock：full_host 友好顺序（短码用 set_scene_code；等价于 job+adopt） */
const mockToolCalls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: FIXTURE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: frameTimes } },
  { name: 'review_frames', args: { requirements: REQUIREMENTS } },
  { name: 'finish', args: { summary: FINISH_SUMMARY } },
]

const HEADED = process.env.HEADED === '1' || process.env.BROWSER_HEADED === '1'
const slowMo = Number(process.env.SLOW_MO) || (HEADED ? 60 : 0)
if (HEADED) console.log('有界面模式：将打开本机 Chrome 窗口执行验收')
const browser = await chromium.launch({
  headless: !HEADED,
  channel: 'chrome',
  ...(slowMo > 0 ? { slowMo } : {}),
  ...(process.env.DEVTOOLS === '1' ? { devtools: true } : {}),
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(45_000)
const errors = []
const textCalls = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) {
    errors.push('console: ' + m.text())
  }
})

if (!REAL) {
  const mockSettings = {
    ...settings,
    agentHostMode: 'full_host',
    providers: [
      ...(settings.providers || []).filter((p) => p.id !== 'scene3d-mp4-mock'),
      {
        id: 'scene3d-mp4-mock',
        label: 'Scene3D MP4 Mock',
        kind: 'openai',
        baseUrl: 'https://mock.invalid',
        caps: ['text', 'vision'],
        apiKey: 'mock',
      },
    ],
    models: [
      ...(settings.models || []).filter((m) => m.key !== 'scene3d-mp4-code' && m.key !== 'scene3d-mp4-vision'),
      {
        key: 'scene3d-mp4-code',
        label: 'Scene3D MP4 Code',
        cap: 'text',
        provider: 'scene3d-mp4-mock',
        model: 'MiniMax-M3',
      },
      {
        key: 'scene3d-mp4-vision',
        label: 'Scene3D MP4 Vision',
        cap: 'vision',
        provider: 'scene3d-mp4-mock',
        model: 'scene3d-mp4-vision',
      },
    ],
    defaults: { ...(settings.defaults || {}), text: 'scene3d-mp4-code', vision: 'scene3d-mp4-vision' },
    stageModels: {
      ...(settings.stageModels || {}),
      sceneCode: 'scene3d-mp4-code',
      vision: 'scene3d-mp4-vision',
    },
  }
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, settings: mockSettings, db: 'mock' }),
      })
    }
    return route.continue()
  })
  let callIndex = 0
  await page.route('**/api/text', (route) => {
    textCalls.push(JSON.parse(route.request().postData() || '{}'))
    const call = mockToolCalls[callIndex++]
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        finishReason: call ? 'tool_calls' : 'stop',
        toolCalls: call
          ? [{ id: `call_${call.name}_${callIndex}`, name: call.name, arguments: JSON.stringify(call.args) }]
          : [],
        text: callIndex === 1 ? '读取镜头并生成场景' : '',
        model: 'scene3d-mp4-code',
        modelKey: 'scene3d-mp4-code',
        modelLabel: 'Scene3D MP4 Code',
      }),
    })
  })
  await page.route('**/api/vision', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: {
          summary: '关键帧符合预演清单',
          items: REQUIREMENTS.map((label) => ({ label, ok: true })),
        },
        text: '',
        model: 'scene3d-mp4-vision',
        modelKey: 'scene3d-mp4-vision',
        modelLabel: 'Scene3D MP4 Vision',
      }),
    }),
  )
}

let panel = ''
let shot = null
let videoUrl = ''
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 20_000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.getByRole('button', { name: '3D 调度', exact: true }).click()
  await page.waitForTimeout(800)
  await page.locator('.s3d-card').first().getByRole('button', { name: '打开', exact: true }).click()
  await page.locator('.cw-shell').waitFor({ timeout: 20_000 })
  for (let i = 0; i < 50; i++) {
    if (await page.locator('[data-chat-scope="scene3d"]').count()) break
    await page.waitForTimeout(300)
  }
  check('3D 聊天面板已打开', (await page.locator('[data-chat-scope="scene3d"]').count()) === 1)

  const input = page.locator('[data-chat-scope="scene3d"] [data-chat-input]')
  await input.waitFor({ timeout: 15_000 })
  await input.fill(USER_PROMPT)
  await page.locator('[data-chat-scope="scene3d"]').getByRole('button', { name: '发送', exact: true }).click()

  await page.waitForFunction(
    () => document.querySelector('[data-chat-scope="scene3d"]')?.getAttribute('data-running') === 'false',
    null,
    { timeout: REAL ? 600_000 : 300_000 },
  )

  panel = await page.locator('[data-chat-scope="scene3d"]').innerText()
  check('已读取镜头上下文', /读取镜头上下文|已读取镜头上下文/.test(panel), panel.slice(0, 400))
  check('代码阶段完成', panel.includes('代码阶段完成') || panel.includes(FINISH_SUMMARY), panel.slice(-1200))
  check('视频验收已启动', /MP4|视频验收/.test(panel), panel.slice(-1200))

  await page
    .waitForFunction(
      () => document.querySelector('[data-chat-video]')?.getAttribute('data-status') === 'passed',
      null,
      { timeout: 180_000 },
    )
    .catch(() => {})

  check('出现 MP4 卡片', (await page.locator('[data-chat-video]').count()) >= 1)
  const videoStatus = (await page.locator('[data-chat-video]').last().getAttribute('data-status')) || ''
  check('MP4 状态为通过', videoStatus === 'passed', videoStatus)

  const frameCount = await page.locator('[data-chat-video-frames] img').count()
  check(`MP4 抽帧数（期望约 ${EXPECTED_FRAMES}）`, frameCount >= EXPECTED_FRAMES - 1, String(frameCount))

  videoUrl = (await page.locator('[data-chat-video-player]').last().getAttribute('src')) || ''
  check('MP4 播放器有地址', videoUrl.startsWith('/videos/'), videoUrl)

  panel = await page.locator('[data-chat-scope="scene3d"]').innerText()
  check('聊天说明已保存', /已保存|MP4 帧验收.*通过/.test(panel), panel.slice(-900))

  const project = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
  shot = project?.project?.shots?.find((s) => s.id === spec.shotId) || null
  check('代码写入镜头', Boolean(shot?.scene_code?.code), String(shot?.scene_code?.codeHash || '').slice(0, 12))
  if (!REAL) {
    check('代码哈希与 fixture 一致', shot?.scene_code?.codeHash === sha(FIXTURE), String(shot?.scene_code?.codeHash || '').slice(0, 12))
    check('mock 工具调用次数', textCalls.length === mockToolCalls.length, String(textCalls.length))
  }
  check('项目 schedule_video 已写入', shot?.schedule_video === videoUrl, `${shot?.schedule_video || ''} vs ${videoUrl}`)

  const mp4Path = path.join(ROOT, 'public', videoUrl.replace(/^\//, ''))
  if (fs.existsSync(mp4Path)) {
    try {
      const probe = JSON.parse(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'format=duration:stream=width,height',
          '-of',
          'json',
          mp4Path,
        ]).toString(),
      )
      const duration = Number(probe?.format?.duration)
      const width = Number(probe?.streams?.[0]?.width)
      const height = Number(probe?.streams?.[0]?.height)
      check('MP4 时长接近镜头秒数', duration >= SECONDS - 0.35 && duration <= SECONDS + 0.5, String(duration))
      check('MP4 为横屏', width > height, `${width}x${height}`)
      fs.copyFileSync(mp4Path, path.join(EVIDENCE, 'output.mp4'))
    } catch (e) {
      check('ffprobe 可读', false, e?.message || String(e))
    }
  } else {
    check('MP4 文件落盘', false, mp4Path)
  }

  await page.locator('[data-chat-scope="scene3d"]').screenshot({ path: path.join(EVIDENCE, 'chat-panel.png') })
  fs.writeFileSync(
    path.join(EVIDENCE, 'result.json'),
    JSON.stringify(
      {
        project: NAME,
        mode: REAL ? 'real' : 'mock',
        prompt: USER_PROMPT,
        videoUrl,
        shot: {
          id: shot?.id,
          codeHash: shot?.scene_code?.codeHash,
          scheduleVideo: shot?.schedule_video,
          metaDuration: shot?.scene_code_meta?.duration,
        },
        requirements: REQUIREMENTS,
        panelTail: panel.slice(-2500),
        savedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  check('证据已写入', fs.existsSync(path.join(EVIDENCE, 'result.json')))
  if (HEADED) {
    const pause = Number(process.env.HEADED_PAUSE_MS) || 12_000
    console.log(`有界面模式：保留窗口 ${pause / 1000}s，便于目视 MP4 卡片…`)
    await page.waitForTimeout(pause)
  }
} catch (e) {
  console.error('验收异常：', e?.message || e)
  bad++
  if (HEADED) {
    const pause = Number(process.env.HEADED_PAUSE_MS) || 20_000
    console.log(`失败时保留浏览器 ${pause / 1000}s 便于排查…`)
    await page.waitForTimeout(pause).catch(() => {})
  }
} finally {
  await browser.close()
}

check('页面无未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(`\n项目名（可删）：${NAME}`)
console.log(`证据目录：${EVIDENCE}`)
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
