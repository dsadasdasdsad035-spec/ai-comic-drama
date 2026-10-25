/**
 * 反推链路验收：真实切分/抽帧 + mock 文本模型驱动工具循环。
 * 覆盖 read_* 只读、媒体工具、submit_reverse_pack 契约校验、产物卡片与导出。
 * 跑法：node verify-creative-reverse.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5346
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-reverse-'))
const PROJECTS = path.join(TMP, 'projects')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

function which(bin) {
  try {
    execFileSync('which', [bin], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}
if (!which('ffmpeg')) {
  console.error('缺少 ffmpeg')
  process.exit(1)
}

fs.mkdirSync(PROJECTS, { recursive: true })
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 3 段黑白硬切，保证能切出 3 镜
const sample = path.join(TMP, 'sample.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.2:r=25',
  '-f', 'lavfi', '-i', 'color=c=white:s=320x240:d=1.2:r=25',
  '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1.2:r=25',
  '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
  '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample,
])

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

// mock 文本模型
const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-text'),
  { id: 'mock-text', label: 'Mock Text', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'mock-text'),
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock-text', model: 'mock-text' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text' }
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text', vision: 'mock-vision' }
settings.creative = { ...(settings.creative || {}), models: { ...(settings.creative?.models || {}), vision: 'mock-vision' } }
settings.models = [
  ...settings.models,
  { key: 'mock-vision', label: 'Mock Vision', cap: 'vision', provider: 'mock-text', model: 'mock-vision' },
]
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

// 预置会话与源视频
const session = (await post('/api/creative/sessions', { mode: 'reverse', title: '反推验收' })).session
const ingested = await post('/api/creative/ingest', {
  sessionId: session.id,
  adapter: 'upload',
  name: 'sample.mp4',
  data: `data:video/mp4;base64,${fs.readFileSync(sample).toString('base64')}`,
})
const source = ingested.source
check('源视频已摄取', Boolean(source?.id), ingested.message)

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 工具循环脚本：split → frames → submit → done
  const toolCalls = []
  let turn = 0
  await page.route('**/api/text', async (route) => {
    turn++
    const body = route.request().postDataJSON()
    const prompt = String(body.prompt || '')
    const hasToolResult = /\[工具结果/.test(prompt) || /read_video_shots|split_scenes/.test(prompt)
    let payload
    if (turn === 1) {
      toolCalls.push('split_scenes')
      payload = { content: '先切分镜头。', tool_calls: [{ name: 'split_scenes', args: { sourceId: source.id } }] }
    } else if (turn === 2) {
      toolCalls.push('extract_frames')
      payload = { content: '给每镜抽证据帧。', tool_calls: [{ name: 'extract_frames', args: { sourceId: source.id } }] }
    } else if (turn === 3) {
      const summary = await api(`/api/creative/sessions/${session.id}`)
      const shots = summary?.session?.shots?.[source.id] || []
      toolCalls.push('read_video_shots')
      payload = {
        content: '读取镜头与证据。',
        tool_calls: [{ name: 'read_video_shots', args: { sourceId: source.id } }],
      }
      if (!shots.length) {
        payload = { content: '切分没有结果。' }
      }
    } else if (turn === 4) {
      toolCalls.push('read_frame_detail')
      payload = {
        content: '看第一镜的画面。',
        tool_calls: [{ name: 'read_frame_detail', args: { sourceId: source.id, index: 1 } }],
      }
    } else if (turn === 5) {
      const summary = await api(`/api/creative/sessions/${session.id}`)
      const shots = summary?.session?.shots?.[source.id] || []
      const pack = {
        source: {
          platform: source.platform || 'local',
          url: source.url || '',
          duration: source.duration,
          width: source.width,
          height: source.height,
        },
        global_style: 'black and white, high contrast, minimal',
        shots: shots.map((s, i) => ({
          index: i + 1,
          start: s.start,
          end: s.end,
          size: 'close-up',
          camera: 'eye level',
          subject: `黑白画面 ${i + 1}`,
          action: '画面保持静止',
          environment: '纯色背景',
          lighting: '均匀光',
          color: '黑白',
          audio: '无语音证据',
          keyframe_prompt: `a solid frame, close-up, high contrast black and white, shot ${i + 1}`,
          video_prompt: 'static shot, no camera movement, 24fps',
          evidence_frames: s.frames,
          confidence: 0.9,
        })),
        negative_prompt: 'text, watermark',
        notes: '样例为纯色画面',
      }
      toolCalls.push('submit_reverse_pack')
      payload = { content: '反推完成。', tool_calls: [{ name: 'submit_reverse_pack', args: pack }] }
    } else {
      payload = { content: '反推完成，已保存提示词包。' }
    }
    void hasToolResult
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: payload,
        text: payload.content,
        modelLabel: 'Mock Text',
        finishReason: 'stop',
      }),
    })
  })

  let visionCalls = 0
  await page.route('**/api/vision', async (route) => {
    visionCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        json: { size: 'close-up', camera: 'eye level', subject: '纯色画面', action: '静止', environment: '无', lighting: '均匀光', color: '黑白', text: '', uncertain: '无' },
        text: '{}',
        modelLabel: 'Mock Vision',
      }),
    })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })

  // 选中预置会话
  await page.locator(`[data-creative-session="${session.id}"] button`).first().click()
  await page.waitForTimeout(800)
  const headerText = await page.locator('[data-creative-header]').innerText()
  check('恢复预置会话', headerText.includes('反推验收'), headerText.slice(0, 80))
  check('源视频卡已渲染', (await page.locator('[data-creative-card="source"]').count()) === 1)
  // 产物在对话右侧的独立栏，不在消息上方横带
  const railPlacement = await page.evaluate(() => {
    const rail = document.querySelector('[data-creative-artifacts]')
    const conv = document.querySelector('.creative-conversation')
    const card = document.querySelector('[data-creative-artifacts] [data-creative-card="source"]')
    if (!rail || !conv || !card) return null
    const rr = rail.getBoundingClientRect()
    const cr = conv.getBoundingClientRect()
    return { railLeftOfConv: rr.left >= cr.right - 1, railW: Math.round(rr.width), inRail: true }
  })
  check('产物显示在对话右侧而非上方横带', Boolean(railPlacement?.inRail && railPlacement.railLeftOfConv), JSON.stringify(railPlacement))

  // 跑一轮反推（mock 模型驱动工具）
  const input = page.getByLabel('创意聊天输入')
  await input.fill('反推提示词')
  await page.getByRole('button', { name: '发送', exact: true }).click()

  // 视觉分析前必须弹成本确认；不确认不能继续
  await page.locator('[data-cost-dialog]').waitFor({ timeout: 45000 })
  check('视觉分析前弹出成本确认', true)
  const costText = await page.locator('[data-cost-dialog]').innerText()
  check('成本卡显示视觉模型与次数', costText.includes('Mock Vision') && costText.includes('调用次数'), costText.slice(0, 120))
  check('确认前不发起视觉调用', visionCalls === 0, String(visionCalls))
  await page.locator('[data-cost-confirm]').click()
  await page.waitForFunction(() => true, null, { timeout: 1000 }).catch(() => {})
  await page.waitForTimeout(800)
  check('确认后才发起视觉调用', visionCalls >= 1, String(visionCalls))

  await page.locator('[data-creative-card="reverse-pack"]').waitFor({ timeout: 60000 })

  check(
    '工具调用顺序正确',
    toolCalls.join(',') === 'split_scenes,extract_frames,read_video_shots,read_frame_detail,submit_reverse_pack',
    toolCalls.join(','),
  )
  const shotsText = await page.locator('[data-creative-card="shots"]').innerText()
  check('模型自行切分后有镜头卡', shotsText.includes('#01'), shotsText.slice(0, 80))
  const summaryAfter = await api(`/api/creative/sessions/${session.id}`)
  const shots = summaryAfter?.session?.shots?.[source.id] || []
  check('服务端切出 3 镜', shots.length === 3, String(shots.length))
  check('模型自行抽到证据帧', shots.every((x) => x.frames.length >= 1), JSON.stringify(shots.map((x) => x.frames.length)))
  const packText = await page.locator('[data-creative-card="reverse-pack"]').innerText()
  check('提示词包显示镜数', packText.includes('3 镜'), packText.slice(0, 80))
  check('提示词包带模型标签', packText.includes('Mock Text') || packText.includes('mock'), packText.slice(0, 120))

  // 展开一镜看证据
  await page.locator('[data-pack-shot="1"] button').click()
  await page.waitForTimeout(300)
  const imgCount = await page.locator('[data-pack-shot="1"] img').count()
  check('证据帧可见', imgCount >= 1, String(imgCount))

  // 服务端产物与契约
  const artifacts = await api(`/api/creative/sessions/${session.id}/artifacts`)
  check('产物已落库', (artifacts.artifacts || []).length === 1, String((artifacts.artifacts || []).length))
  const art = (artifacts.artifacts || [])[0]
  check('产物镜头数正确', art?.payload?.shots?.length === 3, String(art?.payload?.shots?.length))
  check('产物保留证据帧', (art?.payload?.shots?.[0]?.evidence_frames || []).length >= 1)

  // 非法契约被服务端拒绝
  const badPack = await post('/api/creative/artifacts', {
    sessionId: session.id,
    payload: { shots: [{ start: 2, end: 1, size: 'x', keyframe_prompt: 'a', video_prompt: 'b' }] },
  })
  check('非法时间范围被服务端拒绝', badPack.ok === false && /reverse-v1/.test(String(badPack.message)), String(badPack.message).slice(0, 100))

  // 导出
  const exp = await post('/api/creative/export', { artifactId: art.id })
  check('导出成功', exp.ok === true && String(exp.text || '').includes('## 镜头 1'))

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 200).join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
