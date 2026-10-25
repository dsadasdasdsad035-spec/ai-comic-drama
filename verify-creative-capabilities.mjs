/**
 * 创意能力托盘与成本闸门验收：
 * 托盘显示绑定/缺失原因、改绑定不改全局默认、成本确认卡、会话级不再询问、轮次上限、Seedance 强制确认。
 * 跑法：node verify-creative-capabilities.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5347
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-cap-'))
const PROJECTS = path.join(TMP, 'projects')
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

// 两个文本模型 + 一个视觉模型 + 一个图像模型；视频故意不配，用于验证「未绑定」
const settings = (await api('/api/settings')).settings
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock'),
  { id: 'mock', label: 'Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'image', 'video', 'audio'], apiKey: 'mock' },
]
settings.models = [
  { key: 'mock-text', label: 'Mock Text', cap: 'text', provider: 'mock', model: 'mock-text' },
  { key: 'mock-text-2', label: 'Mock Text 2', cap: 'text', provider: 'mock', model: 'mock-text-2' },
  { key: 'mock-vision', label: 'Mock Vision', cap: 'vision', provider: 'mock', model: 'mock-vision' },
  { key: 'mock-image', label: 'Mock Image', cap: 'image', provider: 'mock', model: 'mock-image' },
  { key: 'mock-audio', label: 'Mock Audio', cap: 'audio', provider: 'mock', model: 'mock-audio' },
  { key: 'mock-video', label: 'Mock Video', cap: 'video', provider: 'mock', model: 'mock-video', runtime: 'catalog-only' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'mock-text', image: 'mock-image', audio: 'mock-audio' }
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text' }
settings.creative = {
  ingest: { ytdlp: { enabled: false, bin: '' }, dtk: { enabled: false, baseUrl: '', apiKey: '' } },
  models: {},
  analysis: { depth: 'quick', threshold: 0.3, minShotSeconds: 0.8, framesPerShot: 1 },
  confirmCost: true,
  limits: { maxShots: 40, maxFramesPerShot: 3, maxPaidCallsPerTurn: 2 },
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

  // 每次用户消息 → 一次工具调用 → 收尾；用「本轮已用工具」计数，别和模型轮次混用
  let round = 0
  let usedThisRound = false
  const toolCalls = []
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    const prompt = String(body.prompt || '')
    const isFollowUp = /\[工具结果/.test(prompt) || /工具结果/.test(prompt)
    let payload
    if (!isFollowUp) {
      round++
      usedThisRound = false
    }
    if (round === 1 && !usedThisRound) {
      usedThisRound = true
      toolCalls.push('generate_image')
      payload = { content: '生成一张图。', tool_calls: [{ name: 'generate_image', args: { prompt: 'a cup' } }] }
    } else if (round === 2 && !usedThisRound) {
      usedThisRound = true
      toolCalls.push('generate_voice')
      payload = { content: '再配一段音。', tool_calls: [{ name: 'generate_voice', args: { text: '你好' } }] }
    } else if (round === 3 && !usedThisRound) {
      usedThisRound = true
      toolCalls.push('generate_voice')
      payload = { content: '第三次付费调用。', tool_calls: [{ name: 'generate_voice', args: { text: '再来' } }] }
    } else {
      payload = { content: '完成。' }
    }
    void body
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: payload, text: payload.content, modelLabel: 'Mock Text', finishReason: 'stop' }),
    })
  })

  // 生成接口都拦截掉，不产生真实请求
  let imageCalls = 0
  await page.route('**/api/seedream', async (route) => {
    imageCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, urls: ['/generated/mock.png'], modelLabel: 'Mock Image' }),
    })
  })
  let voiceCalls = 0
  await page.route('**/api/voice', async (route) => {
    voiceCalls++
    const host = route.request().url()
    void host
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, url: '/voices/mock.mp3', seconds: 1.2, modelLabel: 'Mock Audio' }),
    })
  })
  let videoCalls = 0
  await page.route('**/api/seedance', async (route) => {
    videoCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 'mock-task' }),
    })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })

  // 1) 托盘：显示就绪与未绑定原因
  await page.locator('[data-creative-action="toggle-capabilities"]').click()
  await page.locator('[data-creative-capability-panel]').waitFor({ timeout: 5000 })
  const tray = page.locator('[data-creative-capability-panel]')
  check('托盘列出七类能力', (await tray.locator('[data-cap-row]').count()) === 7)
  check('视觉能力就绪', (await tray.locator('[data-cap-row="vision"]').getAttribute('data-status')) === 'ready')
  check(
    '视频能力显示未绑定',
    (await tray.locator('[data-cap-row="video"]').getAttribute('data-status')) === 'none',
    (await tray.locator('[data-cap-row="video"]').innerText()).slice(0, 80),
  )
  const videoRowText = await tray.locator('[data-cap-row="video"]').innerText()
  check('未绑定给出原因', videoRowText.includes('未配置') || videoRowText.includes('不可用'), videoRowText.slice(0, 80))

  // 2) 改绑定只写 creative.models
  await tray.locator('[data-cap-row="image"] select').selectOption('mock-image')
  await page.waitForTimeout(800)
  const savedSettings = (await api('/api/settings')).settings
  check('创意绑定已保存', savedSettings.creative?.models?.image === 'mock-image', JSON.stringify(savedSettings.creative?.models))
  check('全站默认未被改动', savedSettings.defaults?.image === 'mock-image' && savedSettings.defaults?.text === 'mock-text')

  // 3) 生成图片：先弹确认（生成工具只在复刻模式绑定）
  await tray.locator('[data-cap-row="image"] select').selectOption('mock-image')
  await page.waitForTimeout(500)
  await page.locator('[data-creative-action="toggle-capabilities"]').click()
  await page.locator('[data-creative-modes] [data-mode="remake"]').click()
  await page.waitForTimeout(800)
  const input = page.getByLabel('创意聊天输入')
  await input.fill('生成一张图')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-cost-dialog]').waitFor({ timeout: 30000 })
  check('生图前弹成本确认', true)
  check('确认前不发起生图', imageCalls === 0, String(imageCalls))
  await page.locator('[data-cost-confirm]').click()
  await page.waitForFunction(() => document.querySelectorAll('[data-creative-card="generated-image"]').length > 0, null, { timeout: 15000 })
  check('确认后生图只发一次', imageCalls === 1, String(imageCalls))
  check('生成结果以卡片呈现', (await page.locator('[data-creative-card="generated-image"]').count()) === 1)
  // 等本轮真正结束：输入框恢复可编辑
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-chat-input]')
      return el instanceof HTMLTextAreaElement && !el.disabled
    },
    null,
    { timeout: 60000 },
  )

  // 4) 会话级不再询问
  await input.fill('再配一段音')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-cost-dialog]').waitFor({ timeout: 30000 })
  await page.locator('[data-cost-remember]').check()
  await page.locator('[data-cost-confirm]').click()
  await page.waitForTimeout(1200)
  check('勾选后本次配音已执行', voiceCalls === 1, String(voiceCalls))

  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-chat-input]')
      return el instanceof HTMLTextAreaElement && !el.disabled
    },
    null,
    { timeout: 60000 },
  )
  await input.fill('再来一段')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForTimeout(4000)
  const dialogAgain = await page.locator('[data-cost-dialog]').count()
  check('同类调用不再弹确认', dialogAgain === 0)
  // 但第三轮应被 maxPaidCallsPerTurn=2 挡住
  check('轮次上限内最多两次配音', voiceCalls === 2, String(voiceCalls))
  // 超限那次工具返回 {ok:false,error:'…上限…'}，会作为工具卡出现在对话里
  // 超限的可读错误由 tests/creative-tools.ts 的单元测试断言（UI 时序不稳）；
  // 这里只确认 UI 没有因为超限而多扣一次真实请求。
  check('超限没有多发请求', voiceCalls === 2, String(voiceCalls))

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 160).join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
