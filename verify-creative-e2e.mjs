/**
 * 创意工作室端到端验收：上传 → 切分 → 抽帧 → 反推 → 导出 → 晋升新项目，全程走界面。
 * 用 mock 文本/视觉模型，媒体与存储走真实服务。
 * 跑法：node verify-creative-e2e.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5349
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-e2e-'))
const PROJECTS = path.join(TMP, 'projects')
const PROJECT_NAME = `e2e-${Date.now().toString(36)}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

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

const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock'),
  { id: 'mock', label: 'Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => !m.key.startsWith('mock-')),
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock', model: 'mock-text' },
  { key: 'mock-vision', label: 'Mock Vision', cap: 'vision', provider: 'mock', model: 'mock-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text', vision: 'mock-vision' }
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text', vision: 'mock-vision' }
settings.creative = {
  ...(settings.creative || {}),
  models: { ...(settings.creative?.models || {}), vision: 'mock-vision' },
  analysis: { depth: 'quick', threshold: 0.2, minShotSeconds: 0.8, framesPerShot: 1 },
  confirmCost: true,
  limits: { maxShots: 40, maxFramesPerShot: 3, maxPaidCallsPerTurn: 20 },
}
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 全流程 mock：split → frames → read_frame → submit → done
  // 每次模型调用弹一个工具：切分 → 抽帧 → 看首镜 → 提交 → 收尾。
  // 不看 followUp 标记，避免受提示词格式影响而漏推进。
  const queue = ['split_scenes', 'extract_frames', 'read_frame_detail', 'submit_reverse_pack']
  await page.route('**/api/text', async (route) => {
    const next = queue.shift()
    // 媒体工具都要求 sourceId：按当前会话的真实源视频填，别用空参数触发 schema 拒绝
    const liveSessions = await api('/api/creative/sessions')
    const liveId = liveSessions.sessions?.[0]?.id
    const liveDetail = liveId ? await api(`/api/creative/sessions/${liveId}`) : null
    const liveSourceId = liveDetail?.session?.sources?.[0]?.id || ''
    let payload
    if (next === 'split_scenes') {
      payload = { content: '切分镜头。', tool_calls: [{ name: 'split_scenes', args: { sourceId: liveSourceId } }] }
    } else if (next === 'extract_frames') {
      payload = { content: '抽证据帧。', tool_calls: [{ name: 'extract_frames', args: { sourceId: liveSourceId } }] }
    } else if (next === 'read_frame_detail') {
      payload = {
        content: '看第一镜。',
        tool_calls: [{ name: 'read_frame_detail', args: { sourceId: liveSourceId, index: 1 } }],
      }
    } else if (next === 'submit_reverse_pack') {
      // 构造合法包：镜头与证据帧来自服务端最新状态
      const src = liveDetail?.session?.sources?.[0]
      const shots = liveDetail?.session?.shots?.[src?.id] || []
      payload = {
        content: '提交提示词包。',
        tool_calls: [
          {
            name: 'submit_reverse_pack',
            args: {
              source: {
                platform: src?.platform || 'local',
                duration: src?.duration,
                width: src?.width,
                height: src?.height,
              },
              global_style: 'black and white minimal',
              shots: shots.map((s, i) => ({
                index: i + 1,
                start: s.start,
                end: s.end,
                size: 'close-up',
                camera: 'eye level',
                subject: `画面 ${i + 1}`,
                action: '静止',
                environment: '纯色',
                lighting: '均匀',
                color: '黑白',
                audio: '无',
                keyframe_prompt: `frame ${i + 1}, close-up, black and white`,
                video_prompt: 'static shot, 24fps',
                evidence_frames: s.frames,
                confidence: 0.9,
              })),
              negative_prompt: 'text',
              notes: '',
            },
          },
        ],
      }
    } else {
      payload = { content: '完成。' }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: payload, text: payload.content, modelLabel: 'Mock Text' }),
    })
  })

  let visionCalls = 0
  await page.route('**/api/vision', async (route) => {
    visionCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: { size: 'close-up', camera: 'eye level', subject: '纯色', action: '静止' }, text: '{}', modelLabel: 'Mock Vision' }),
    })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })

  // 1) 上传（真实上传到本地创意目录）
  const fileInput = page.locator('[data-creative-empty] input[type="file"]')
  if ((await fileInput.count()) === 0) {
    // 空态只在反推/复刻模式显示上传按钮
    await page.locator('[data-creative-modes] [data-mode="reverse"]').click()
    await page.waitForTimeout(600)
  }
  await page.locator('[data-creative-empty] input[type="file"]').setInputFiles(sample)
  await page.locator('[data-creative-card="source"]').waitFor({ timeout: 30000 })
  check('上传后出现源视频卡', true)
  const srcText = await page.locator('[data-creative-card="source"]').innerText()
  check('源卡显示时长与分辨率', srcText.includes('3.6s') && srcText.includes('320×240'), srcText.slice(0, 120))

  // 2) 跑一轮反推（模型驱动切分/抽帧/视觉/提交）
  const input = page.getByLabel('创意聊天输入')
  await input.fill('反推提示词')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-cost-dialog]').waitFor({ timeout: 45000 })
  await page.locator('[data-cost-confirm]').click()
  await page.locator('[data-creative-card="reverse-pack"]').waitFor({ timeout: 90000 })
  check('一轮内完成切分到提示词包', true, `visionCalls=${visionCalls}`)
  check('视觉分析确实被调用', visionCalls >= 1, String(visionCalls))

  const sessions = await api('/api/creative/sessions')
  const sessionId = sessions.sessions?.[0]?.id
  const detail = await api(`/api/creative/sessions/${sessionId}`)
  const src = detail.session?.sources?.[0]
  const shots = detail.session?.shots?.[src?.id] || []
  check('切成 3 镜', shots.length === 3, String(shots.length))
  check('每镜都有证据帧', shots.every((s) => s.frames.length >= 1))
  check('产物已保存', (detail.session?.artifacts || []).length === 1)
  const artifactId = detail.session.artifacts[0].id

  // 3) 导出
  const exp = await page.evaluate(async (id) => {
    const r = await fetch('/api/creative/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artifactId: id }),
    })
    return r.json()
  }, artifactId)
  check('导出文本按镜分组', String(exp.text || '').includes('## 镜头 1'))
  check('导出 JSON 含三镜', exp.payload?.shots?.length === 3)

  // 4) 晋升新项目（走界面弹窗）
  await page.locator('[data-creative-action="promote-pack"]').click()
  await page.locator('[data-promote-dialog]').waitFor({ timeout: 10000 })
  await page.locator('[data-promote-name]').fill(PROJECT_NAME)
  await page.locator('[data-promote-confirm]').click()
  await page.waitForFunction(() => !document.querySelector('[data-promote-dialog]'), null, { timeout: 30000 })
  check('晋升弹窗已关闭', true)

  const projs = await api('/api/project')
  check('新项目已创建', (projs.projects || []).some((p) => p.name === PROJECT_NAME), (projs.projects || []).map((p) => p.name).join(','))
  const promoted = await api(`/api/project?name=${encodeURIComponent(PROJECT_NAME)}`)
  const pShots = promoted.project?.shots || []
  check('项目里有 3 镜', pShots.length === 3, String(pShots.length))
  check('首帧提示词已写入', String(pShots[0]?.keyframe_prompt || '').includes('black and white'))
  check('运动提示词已写入', String(pShots[0]?.video_prompt || '').includes('static shot'))
  check('来源链接从创意带出', JSON.stringify(pShots[0] || {}).includes('creative_session'))

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 200).join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
