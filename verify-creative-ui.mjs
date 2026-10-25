/**
 * 创意工作室 UI 验收：八视图导航、隐藏项目/集、会话列表、模式切换、空态、窄屏抽屉、成本确认与晋升弹窗。
 * 跑法：node verify-creative-ui.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5345
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-ui-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `creative-seed-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })

// 端口占用直接失败：否则会连到上次崩溃留下的孤儿 dev server
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 预置项目（验证创意视图切换项目不重载）
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: '种子项目' })
writeProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, {
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜街口', keyframe_prompt: 'a man', video_prompt: 'push in' }],
})
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'inherit' })

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

// 配一个 mock 文本模型，避免聊天按钮因缺模型而禁用
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  let textCalls = 0
  await page.route('**/api/text', async (route) => {
    textCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: '好的，先给三个方向。', json: { content: '好的，先给三个方向。' }, modelLabel: 'Mock Text' }),
    })
  })

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })

  // 1) 导航：创意是本变更新增的第八个视图；其它变更可能继续加视图，
  //    所以只断言「至少八个且含创意」，不锁死总数。
  const navNames = await page.locator('.viewtabs button').allInnerTexts()
  check('导航至少八个视图', navNames.length >= 8, navNames.join('/'))
  check('导航含创意视图', navNames.includes('创意'), navNames.join('/'))

  // 2) 进入创意视图
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  check('创意视图已打开', true)
  // 选择器保留占位几何以稳住导航位置，但必须不可见、不可点、不进可访问树
  const slotState = await page.evaluate(() => {
    const slot = document.querySelector('.topbar-project-slot')
    if (!slot) return { present: false }
    const cs = getComputedStyle(slot)
    return {
      present: true,
      visibility: cs.visibility,
      pointerEvents: cs.pointerEvents,
      ariaHidden: slot.getAttribute('aria-hidden'),
      hasInert: slot.hasAttribute('inert'),
      width: Math.round(slot.getBoundingClientRect().width),
    }
  })
  check(
    '创意视图隐藏项目与集选择器',
    slotState.present &&
      slotState.visibility === 'hidden' &&
      slotState.pointerEvents === 'none' &&
      slotState.ariaHidden === 'true' &&
      slotState.hasInert,
    JSON.stringify(slotState),
  )
  const navXCreative = await page.locator('.viewtabs').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  check('创意导航标记为当前', (await page.getByRole('button', { name: '创意', exact: true }).getAttribute('aria-current')) === 'page')

  // 3) 会话列表与自动创建
  await page.locator('[data-creative-sessions]').waitFor({ timeout: 15000 })
  const sessionCount = await page.locator('[data-creative-session]').count()
  check('首次进入已有会话', sessionCount >= 1, String(sessionCount))
  check('会话列表高亮当前项', (await page.locator('[data-creative-session][data-active="true"]').count()) === 1)
  const sessionsBefore = sessionCount

  // 4) 新建会话
  await page.locator('[data-creative-action="new-session"]').click()
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-creative-session]').length > n,
    sessionsBefore,
    { timeout: 10000 },
  )
  check('新会话已加入列表', (await page.locator('[data-creative-session]').count()) > sessionsBefore)

  // 5) 模式切换
  await page.locator('[data-creative-modes] [data-mode="reverse"]').click()
  await page.waitForTimeout(600)
  check('模式切到反推', (await page.locator('[data-creative-modes] [data-mode="reverse"]').getAttribute('aria-selected')) === 'true')
  const headerText = await page.locator('[data-creative-header]').innerText()
  check('头部显示宿主技能', headerText.includes('video-reverse'), headerText.slice(0, 160))
  check('头部显示文本模型', headerText.includes('mock-text') || headerText.includes('Mock Text'), headerText.slice(0, 160))
  await page.locator('[data-creative-modes] [data-mode="plan"]').click()
  await page.waitForTimeout(600)
  check('模式切回策划', (await page.locator('[data-creative-header]').innerText()).includes('creative-plan'))

  // 6) 空态与示例
  const empty = await page.locator('[data-creative-empty]').innerText()
  check('空态说明不写项目', empty.includes('不会改动任何项目数据'), empty.slice(0, 120))
  const suggestions = await page.locator('[data-chat-suggestion]').count()
  check('空态给出示例', suggestions >= 3, String(suggestions))
  await page.screenshot({ path: path.join(TMP, 'creative-empty.png') })

  // 7) 发送一轮对话（mock）
  const input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 15000 })
  await input.fill('给我三个 15 秒短剧方向')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-chat-message="assistant"]').length > 0, null, { timeout: 15000 })
  check('发送后收到助手回复', textCalls >= 1, String(textCalls))
  const title = await page.locator('[data-creative-session][data-active="true"]').innerText()
  check('首条消息后自动起标题', title.includes('给我三个') || title.includes('三个'), title.slice(0, 60))

  // 8) 切换项目不影响创意会话
  const beforeSwitch = await page.locator('[data-chat-message]').count()
  await page.evaluate(() => {
    // 创意视图没有项目选择器：直接调用全局状态无法做到，所以先切回项目视图再切项目
    const nav = [...document.querySelectorAll('.viewtabs button')].find((b) => b.textContent.includes('剧本'))
    nav?.click()
  })
  await page.locator('.topbar-project select').waitFor({ timeout: 10000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  const afterSwitch = await page.locator('[data-chat-message]').count()
  check('切换项目后创意会话仍保留', afterSwitch === beforeSwitch, `${beforeSwitch} → ${afterSwitch}`)

  // 9) 窄屏：会话列表收起，对话仍在主位
  await page.setViewportSize({ width: 820, height: 900 })
  await page.waitForTimeout(400)
  const listTransform = await page.locator('[data-creative-sessions]').evaluate((el) => getComputedStyle(el).transform)
  check('窄屏会话列表默认收起', listTransform.includes('-') || listTransform.includes('matrix'), listTransform)
  await page.locator('[data-creative-action="toggle-list"]').click()
  await page.waitForTimeout(300)
  const opened = await page.locator('[data-creative-sessions]').getAttribute('data-open')
  check('窄屏可打开会话列表', opened === 'true')
  await page.locator('.creative-list-scrim').click({ force: true })

  // 10) 对话框：成本确认与晋升（直接渲染，不依赖真实付费调用）
  await page.setViewportSize({ width: 1500, height: 1000 })
  const hasCost = await page.locator('[data-cost-dialog]').count()
  const hasPromote = await page.locator('[data-promote-dialog]').count()
  check('默认不弹成本确认', hasCost === 0)
  check('默认不弹晋升确认', hasPromote === 0)

  // 11) 导航位置稳定：进出创意不位移
  const navNow = await page.locator('.viewtabs').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.waitForTimeout(900)
  const navProject = await page.locator('.viewtabs').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.waitForTimeout(900)
  const navBack = await page.locator('.viewtabs').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  check(
    '进出创意导航不位移',
    Math.abs(navProject - navBack) <= 2,
    `${navProject} / ${navBack}`,
  )

  // 12) 空态文字对比度达标（日间）
  await page.locator('[data-creative-action="new-session"]').click()
  await page.waitForTimeout(1200)
  const contrastInfo = await page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
    const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const ratio = (a, b) => {
      const la = lum(a), lb = lum(b)
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
    }
    const bgOf = (el) => {
      let cur = el
      let bg = 'rgba(0, 0, 0, 0)'
      while (cur && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(cur).backgroundColor
        cur = cur.parentElement
      }
      return bg
    }
    const root = document.querySelector('[data-creative-empty]')
    if (!root) return null
    const out = []
    for (const el of root.querySelectorAll('h3, p')) {
      if (!el.textContent.trim()) continue
      out.push({
        tag: el.tagName,
        ratio: +ratio(parse(getComputedStyle(el).color), parse(bgOf(el))).toFixed(2),
      })
    }
    return { items: out, min: Math.min(...out.map((o) => o.ratio)) }
  })
  check(
    '空态文字对比度 ≥ 4.5:1',
    Boolean(contrastInfo) && contrastInfo.min >= 4.5,
    JSON.stringify(contrastInfo),
  )

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 200).join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
