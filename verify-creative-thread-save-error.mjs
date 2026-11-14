/**
 * 创意线程保存失败必须可见：给出原因与下一步，且不自动重试。
 * 跑法：node verify-creative-thread-save-error.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5352
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-save-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用`)
  process.exit(1)
} catch {
  /* 空闲 */
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
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
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  console.error('dev server 启动失败')
  process.exit(1)
}

// 临时库里放一个最小项目 + mock 文本模型（不碰真实 projects/）
await api(`/api/project?name=${encodeURIComponent('save-probe')}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: {
      title: 'save-probe',
      aspect: '16:9',
      episodes: [{ no: 1, title: 'E01', targetSeconds: 60 }],
      shots: [{ id: 'E01-S01', episode: 1, no: 'S01', desc: '起' }],
      characters: [],
      designs: [],
      sceneLayouts: [],
    },
  }),
})
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
settings.stageModels = { ...(settings.stageModels || {}), creative: 'mock-text' }
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(settings),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.on('console', (m) => { if (m.text().startsWith('SAVE-SITE')) console.log('   [page]', m.text()) })

  // 文本模型走假流，避免真实网络
  await page.route('**/api/text', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ type: 'meta', model: 'mock-text', modelKey: 'mock-text', modelLabel: 'Mock Text' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', text: '收到，这是模拟回复。' })}\n\n`,
      ].join(''),
    })
  })

  let saveMode = 'too-large'
  let saves = 0

  await page.route('**/api/creative/sessions/*/thread', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    saves++
    if (saveMode === 'too-large') {
      await route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          kind: 'thread-too-large',
          message: '线程超过 1024KB（当前 1200KB），请新建会话或清理旧轮次',
        }),
      })
      return
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, message: '创意线程写入失败' }),
    })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '创意', exact: true }).first().click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  const input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 15000 })

  const banner = page.locator('[data-creative-error]')
  // 同一轮有两个独立保存点（收尾一次 + 600ms 防抖一次），各自只发一次；
  // 等请求数静默下来后再观察，才是在验「失败后不自动重试」。
  const settle = async () => {
    let prev = -1
    while (prev !== saves) {
      prev = saves
      await page.waitForTimeout(700)
    }
    return saves
  }
  const send = async (text) => {
    await input.fill(text)
    await page.getByRole('button', { name: '发送', exact: true }).click()
  }

  console.log('\n=== 超限：可见提示 + 消息不被清空 ===')
  await send('第一轮：读一下技能全文')
  await banner.waitFor({ timeout: 20000 })
  const overflowText = (await banner.innerText()).trim()
  check('提示说明本轮未保存', overflowText.includes('本轮未保存'), overflowText)
  check('提示给出超限下一步（新建会话）', overflowText.includes('新建会话'), overflowText)
  const stillThere = (await page.locator('[data-chat-message]').allInnerTexts()).join('\n')
  check('当前消息未被清空', stillThere.includes('第一轮：读一下技能全文'), stillThere.slice(0, 60))

  // 不自动重试：静默后请求次数必须不再增长
  const settledOverflow = await settle()
  await page.waitForTimeout(2500)
  check('超限静默后不再自动重试', saves === settledOverflow, `${settledOverflow} → ${saves}`)
  check('超限至少保存过一次', settledOverflow >= 1, String(settledOverflow))

  console.log('\n=== 服务失败：另一套文案 ===')
  saveMode = 'fail'
  await send('第二轮：再追问一个细节')
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[data-creative-error]')
      return Boolean(el && el.textContent && el.textContent.trim() !== prev)
    },
    overflowText,
    { timeout: 20000 },
  )
  const failText = (await banner.innerText()).trim()
  check('两类文案不同', failText !== overflowText, failText)
  check('服务失败也说明本轮未保存', failText.includes('本轮未保存'), failText)
  check('服务失败给出下一步（确认服务/重试）', /确认本地服务|重试/.test(failText), failText)
  check('服务失败文案不误报超限', !failText.includes('新建会话'), failText)

  const settledFail = await settle()
  await page.waitForTimeout(2500)
  check('服务失败静默后同样不自动重试', saves === settledFail, `${settledFail} → ${saves}`)
} finally {
  await browser.close()
  child.kill()
}

console.log(bad ? `\n❌ 失败 ${bad} 项` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
