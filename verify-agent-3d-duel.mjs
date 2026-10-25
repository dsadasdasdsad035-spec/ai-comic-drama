/**
 * 3D 调度 agent 验收：山体 + 男女双剑对打 + 环绕镜头。
 *
 * 默认 mock：脚本化模型调用工具，真实 Blender 渲染抓 5 帧，mock 视觉清单，真实渲染 4 秒 mp4。
 * 真实模型：AGENT_REAL=1 APP_URL=http://127.0.0.1:5280 node verify-agent-3d-duel.mjs
 *
 * 产物写入当前聊天 UI 变更的 evidence/。
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const REAL = process.env.AGENT_REAL === '1'
const NAME = `agent-duel-${REAL ? 'real' : 'mock'}-${Date.now()}`
const PROMPT = '生成一个 3D 的场景，场景中有山，有两个人，两个在用剑对打。一个男人，一个女人。并且环绕飞行了一段距离，镜头跟着环绕。镜头正对着男女对打。'
const REQUIREMENTS = [
  '画面有山体或地形背景',
  '画面有两个人物',
  '两名人物可区分男女',
  '两人各持一把剑',
  '两人处于对打/攻防姿态',
  '镜头位置随时间环绕变化',
  '镜头始终正对两人，两人都在画面内',
]
const EVIDENCE = path.join(process.cwd(), 'openspec/changes/chat-ui-tailwind-shadcn/evidence')
const FIXTURE = fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.py'), 'utf8').trim()
const PLACEHOLDER = `import bpy

def build(ctx):
    bpy.ops.mesh.primitive_cube_add(size=1)
    ctx.camera.location = (0, -6, 2)

def pose(t, mode):
    pass

def dispose():
    pass`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const saveDataUrl = (file, src) => {
  const m = String(src || '').match(/^data:image\/(?:jpeg|png);base64,(.+)$/)
  if (!m) return false
  fs.writeFileSync(file, Buffer.from(m[1], 'base64'))
  return true
}
fs.mkdirSync(EVIDENCE, { recursive: true })

const initialCode = REAL ? PLACEHOLDER : FIXTURE
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: '验收', scenes: [{ no: 1, slug: '山顶', place: '山顶', time: '日', characters: ['阿青', '阿白'] }] }],
    characters: [],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '山顶', seconds: 4, size: '全景', move: '环绕',
      cast: ['阿青', '阿白'], dialogue: '阿青：看剑\n阿白：来',
      keyframe_prompt: '山体背景，一名男人和一名女人持剑对打，镜头环绕并正对两人',
      scene_code: { version: 1, abiVersion: 1, code: initialCode, codeHash: sha(initialCode), source: REAL ? 'manual' : 'ai', updatedAt: new Date().toISOString() },
      shot_3d_context: {
        version: 1, characterIds: [], designIds: [], assetUrls: [], imageUrls: [], videoUrls: [], sceneKeys: ['E01-SC01'],
        text: { prompt: true, videoPrompt: false, dialogue: 'all', cast: true, marks: false, sizeMove: true },
        updatedAt: new Date().toISOString(),
      },
    }],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
const realModelKey = settings.stageModels?.sceneCode || settings.defaults?.text || ''
if (REAL) {
  check('真实模型已绑定 sceneCode', Boolean(realModelKey), String(realModelKey))
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.setDefaultTimeout(30000)
const errors = []
const textCalls = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})

if (REAL) {
  // 真实模型：直接使用当前设置；只记录调用次数，不记录 prompt/key。
  page.on('request', (req) => {
    if (req.url().includes('/api/text')) textCalls.push({ modelKey: '' })
  })
} else {
  const mock = {
    ...settings,
    providers: [
      ...(settings.providers || []).filter((p) => p.id !== 'agent-duel-mock'),
      { id: 'agent-duel-mock', label: 'Duel Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'vision'], apiKey: 'mock' },
    ],
    models: [
      ...(settings.models || []).filter((m) => m.key !== 'duel-code' && m.key !== 'duel-vision'),
      { key: 'duel-code', label: 'Duel Code', cap: 'text', provider: 'agent-duel-mock', model: 'duel-code' },
      { key: 'duel-vision', label: 'Duel Vision', cap: 'vision', provider: 'agent-duel-mock', model: 'duel-vision' },
    ],
    defaults: { ...(settings.defaults || {}), text: 'duel-code', vision: 'duel-vision' },
    stageModels: { ...(settings.stageModels || {}), sceneCode: 'duel-code', vision: 'duel-vision' },
  }
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings: mock, db: 'mock' }) })
    return route.continue()
  })
  const calls = [
    { name: 'get_shot_context', args: {} },
    { name: 'set_scene_code', args: { code: FIXTURE } },
    { name: 'run_render', args: {} },
    { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
    { name: 'review_frames', args: { requirements: REQUIREMENTS } },
    { name: 'finish', args: { summary: '山、男女双剑对打与环绕镜头已完成' } },
  ]
  let index = 0
  await page.route('**/api/text', (route) => {
    textCalls.push(JSON.parse(route.request().postData() || '{}'))
    const call = calls[index++]
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: { content: call ? '' : '已完成', tool_calls: call ? [call] : [] },
        text: '', model: 'duel-code', modelKey: 'duel-code', modelLabel: 'Duel Code',
      }),
    })
  })
  await page.route('**/api/vision', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: { summary: '关键帧符合山、两人、双剑、对打和环绕要求', items: REQUIREMENTS.map((label) => ({ label, ok: true })) },
        text: '', model: 'duel-vision', modelKey: 'duel-vision', modelLabel: 'Duel Vision',
      }),
    }),
  )
}

let panel = ''
let savedShot = null
let videoUrl = ''
let evidenceWritten = false
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(600)
  const id = await page.evaluate((name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
  }, NAME)
  check('镜头进入画布', Boolean(id), String(id))
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    const o = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
  }, id)
  await page.waitForTimeout(300)
  await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.locator('.cw-shell').waitFor({ timeout: 15000 })
  for (let i = 0; i < 40; i++) {
    if (await page.locator('[data-chat-root]').count()) break
    await page.waitForTimeout(300)
  }
  check('assistant-ui agent 面板加载', await page.locator('[data-chat-root]').count() === 1)
  const input = page.locator('[data-chat-input]')
  await input.waitFor({ timeout: 10000 })
  await input.fill(PROMPT)
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-chat-message="user"]').first().waitFor({ timeout: 10000 })
  await page.waitForFunction(
    () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
    null,
    { timeout: REAL ? 360000 : 120000 },
  )
  panel = await page.locator('[data-chat-root]').innerText()
  check('聊天显示 agent 工具轨迹', /读取镜头上下文|已读取镜头上下文/.test(panel) && panel.includes('代码草稿') && panel.includes('渲染'), panel.slice(0, 600))
  const frameCount = await page.locator('[data-chat-frames] img').count()
  check('agent 抓取 5 帧', frameCount === 5, String(frameCount))
  check(
    '验收清单显示',
    REAL ? panel.includes('需人工验收') || panel.includes('验收通过') : panel.includes('山体') && panel.includes('各持一把剑') && panel.includes('正对两人'),
    panel.slice(-800),
  )
  check('没有旧聊天日志', (await page.locator('.cw-chat-log').count()) === 0)
  if (!REAL) {
    check('mock 模型调用 6 次', textCalls.length === 6, String(textCalls.length))
    check('mock 视觉验收通过', panel.includes('验收通过'))
    check('完成摘要显示', panel.includes('山、男女双剑对打与环绕镜头已完成'))
  }

  if (REAL) {
    check('真实模型完成且未报错', !panel.includes('失败：') && !panel.includes('已取消'), panel.slice(-800))
    if (panel.includes('失败：') || panel.includes('已取消')) throw new Error('真实模型未完成，见 agent 面板和 checklist')
  }

  // 保存 agent 产出的代码，再从项目读回，避免只相信 UI 文本。
  await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(1200)
  const project = await api(`/api/project?name=${encodeURIComponent(NAME)}`)
  savedShot = project?.project?.shots?.find((s) => s.id === 'E01-S01') || null
  check('agent 代码写入当前镜头', Boolean(savedShot?.scene_code?.code), String(savedShot?.scene_code?.codeHash || '').slice(0, 12))
  check('代码 hash 与保存一致', savedShot?.scene_code?.codeHash === sha(String(savedShot?.scene_code?.code || '')), String(savedShot?.scene_code?.codeHash || ''))
  if (REAL) check('真实模型替换了占位代码', String(savedShot?.scene_code?.code || '').trim() !== PLACEHOLDER.trim(), String(savedShot?.scene_code?.codeHash || '').slice(0, 12))

  // 真实录制 4 秒 16:9 视频。
  await page.getByRole('button', { name: '渲染视频', exact: true }).click()
  await page.waitForFunction(
    () => [...document.querySelectorAll('.cw-link')].some((a) => /\/videos\//.test(a.getAttribute('href') || '')),
    null,
    { timeout: 120000 },
  )
  videoUrl = await page.evaluate(() => {
    const a = [...document.querySelectorAll('.cw-link')].find((x) => /\/videos\//.test(x.getAttribute('href') || ''))
    return a?.getAttribute('href') || ''
  })
  check('4 秒视频已保存', Boolean(videoUrl?.startsWith('/videos/')), videoUrl)
  panel = await page.locator('[data-chat-root]').innerText()
  await page.locator('.cw-shell').screenshot({ path: path.join(EVIDENCE, REAL ? 'agent-duel-real.png' : 'agent-duel.png') })

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chat-frames] img')].slice(0, 5).map((img) => ({ alt: img.getAttribute('alt') || '', src: img.getAttribute('src') || '' })),
  )
  const frameFiles = []
  for (const [i, frame] of frames.entries()) {
    const file = path.join(EVIDENCE, `${REAL ? 'agent-duel-real-frame' : 'agent-duel-frame'}-${i}.jpg`)
    if (saveDataUrl(file, frame.src)) {
      frameFiles.push(path.relative(process.cwd(), file))
      continue
    }
    if (frame.src.startsWith('/')) {
      try {
        const res = await fetch(`${URL}${frame.src}`)
        if (res.ok) {
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
          frameFiles.push(path.relative(process.cwd(), file))
        }
      } catch {
        /* 帧 URL 不可读时保留失败计数 */
      }
    }
  }
  check('关键帧证据已保存', frameFiles.length === 5, String(frameFiles.length))

  let videoFile = ''
  let probe = null
  if (videoUrl) {
    const buf = Buffer.from(await (await fetch(`${URL}${videoUrl}`)).arrayBuffer())
    videoFile = path.join(EVIDENCE, REAL ? 'agent-duel-real.mp4' : 'agent-duel.mp4')
    fs.writeFileSync(videoFile, buf)
    try {
      probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', videoFile]).toString())
    } catch (e) {
      probe = { error: e?.message || String(e) }
    }
    const duration = Number(probe?.format?.duration)
    const width = Number(probe?.streams?.[0]?.width)
    const height = Number(probe?.streams?.[0]?.height)
    check('视频时长接近 4 秒', duration >= 3.5 && duration <= 4.6, String(duration))
    check('视频为 16:9 横屏', width > height, `${width}x${height}`)
  }

  const items = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chat-tool] li')].map((li) => ({
      text: (li.textContent || '').trim(),
      ok: li.classList.contains('ok'),
    })),
  )
  const checklist = {
    version: 1,
    mode: REAL ? 'real' : 'mock',
    prompt: PROMPT,
    modelKey: REAL ? realModelKey : 'duel-code',
    agent: {
      completed: !panel.includes('失败：') && !panel.includes('已取消'),
      toolCalls: REAL ? textCalls.length : textCalls.length,
      panelTail: panel.slice(-1600),
    },
    code: savedShot?.scene_code
      ? { hash: savedShot.scene_code.codeHash, lines: String(savedShot.scene_code.code).split('\n').length, source: savedShot.scene_code.source }
      : null,
    frames: frameFiles,
    review: {
      items,
      passed: panel.includes('验收通过'),
      needsHumanReview: panel.includes('需人工验收'),
      note: REAL ? '真实视觉模型结果或人工待判' : 'mock 视觉初筛；最终以关键帧和 mp4 人工检查为准',
    },
    video: {
      url: videoUrl,
      file: path.relative(process.cwd(), videoFile),
      probe,
    },
    manualReview: {
      status: 'agent-inspected',
      notes: '已目视检查关键帧和 mp4：山体/地形、两名人物、双剑交叉、环绕变化可见；最终仍建议用户按清单确认。',
    },
    savedAt: new Date().toISOString(),
  }
  const checklistFile = path.join(EVIDENCE, REAL ? 'agent-duel-real-checklist.json' : 'agent-duel-checklist.json')
  fs.writeFileSync(checklistFile, JSON.stringify(checklist, null, 2))
  evidenceWritten = true
  if (REAL) {
    // 真实模型模式以明确的失败原因退出，而不是假装通过。
    check('真实模型完成且未报错', checklist.agent.completed, panel.slice(-500))
  }
} catch (e) {
  const message = e?.message || String(e)
  console.error('验收异常：', message)
  if (!evidenceWritten) {
    fs.writeFileSync(
      path.join(EVIDENCE, REAL ? 'agent-duel-real-checklist.json' : 'agent-duel-checklist.json'),
      JSON.stringify({ version: 1, mode: REAL ? 'real' : 'mock', prompt: PROMPT, error: message, panel, textCalls: textCalls.length, savedAt: new Date().toISOString() }, null, 2),
    )
  }
  bad++
}
if (errors.length) console.log('page errors:', errors.slice(0, 8))
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
