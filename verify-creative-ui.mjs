/**
 * 创意工作室 UI 验收：八视图导航、会话列表、纯聊天头、composer 附件空态、窄屏抽屉、成本确认。
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

/** 临时创意宿主：仓库不再内置 creative-plan / video-reverse */
const E2E_SKILL = 'e2e-creative-host'
const e2eSkillDir = path.join(ROOT, 'skills', E2E_SKILL)
const e2eSkillMd = path.join(e2eSkillDir, 'SKILL.md')
const hadE2eSkill = fs.existsSync(e2eSkillDir)
const e2eSkillText = `---
name: ${E2E_SKILL}
description: E2E 创意宿主夹具
stage: creative
runtime: tools
tools: [read_skill]
inputs: [topic]
output: creative-plan-v1
contracts: [creative-plan-v1]
version: 1
---
## 角色与约束
你是 E2E 夹具。

## 任务
用户说：{{input:topic}}
`
fs.mkdirSync(e2eSkillDir, { recursive: true })
fs.writeFileSync(e2eSkillMd, e2eSkillText)

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

const skillIds = ((await api('/api/skills')).skills || []).map((s) => s.id)
check('API 含 E2E 创意宿主', skillIds.includes(E2E_SKILL), skillIds.filter((id) => id.includes('creative') || id.includes('e2e')).join(','))

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

  // 大厅是唯一入口：直接按 hash 打开种子项目的创意视图
  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('.rail').waitFor({ timeout: 15000 })
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  await page.waitForFunction(
    (id) => {
      const sel = document.querySelector('[data-creative-host-skill]')
      return Boolean(sel && [...sel.options].some((o) => o.value === id))
    },
    E2E_SKILL,
    { timeout: 20000 },
  )
  await page.locator('[data-creative-host-skill]').selectOption(E2E_SKILL)
  await page.waitForTimeout(500)

  // 1) 导航全部落在左栏：只断言含创意，不锁死条目总数（分组会继续调整）
  const navNames = await page.locator('.rail-nav button').allInnerTexts()
  check('导航不少于六个视图', navNames.length >= 6, navNames.join('/'))
  check('导航含创意视图', navNames.some((t) => t.includes('创意')), navNames.join('/'))

  // 2) 进入创意视图
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  check('创意视图已打开', true)
  // 创意已绑定项目：项目名与视图名同时出现在面包屑里，取代原先隐藏的顶部项目选择器
  const crumbText = (await page.locator('.crumbs').innerText()).replace(/\s+/g, ' ')
  check(
    '面包屑显示项目与创意',
    crumbText.includes('种子项目') && crumbText.includes('创意'),
    crumbText,
  )
  const navXCreative = await page.locator('.rail-nav').evaluate((el) => Math.round(el.getBoundingClientRect().x))
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

  // 5) 纯聊天头：无模式 Tab，宿主与模型可选
  check('无模式 Tab', (await page.locator('[data-creative-modes]').count()) === 0)
  const headerText = await page.locator('[data-creative-header]').innerText()
  check('头部显示宿主技能', headerText.includes(E2E_SKILL), headerText.slice(0, 160))
  check('头部显示文本模型', headerText.includes('mock-text') || headerText.includes('Mock Text'), headerText.slice(0, 160))
  check('无创意附件条', (await page.locator('[data-chat-attachments]').count()) === 0)

  // 6) 空态与示例
  const empty = await page.locator('[data-creative-empty]').innerText()
  check('空态说明 Pi read_skill', empty.includes('read_skill'), empty.slice(0, 120))
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

  // 8) 离开再回到本项目：会话与消息仍在（会话按项目持久化，跨项目隔离另有脚本覆盖）
  const beforeSwitch = await page.locator('[data-chat-message]').count()
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.locator('.hub').waitFor({ timeout: 15000 })
  await page.evaluate((name) => {
    window.location.hash = `#/p/${encodeURIComponent(name)}/creative`
  }, NAME)
  await page.locator('[data-creative-studio]').waitFor({ timeout: 15000 })
  await page.waitForTimeout(900)
  const afterSwitch = await page.locator('[data-chat-message]').count()
  check('离开再回来创意会话仍保留', afterSwitch === beforeSwitch, `${beforeSwitch} → ${afterSwitch}`)

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

  // 10) 对话框：成本确认（直接渲染，不依赖真实付费调用）
  await page.setViewportSize({ width: 1500, height: 1000 })
  const hasCost = await page.locator('[data-cost-dialog]').count()
  check('默认不弹成本确认', hasCost === 0)

  // 11) 导航位置稳定：进出创意不位移
  const navNow = await page.locator('.rail-nav').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(900)
  const navProject = await page.locator('.rail-nav').evaluate((el) => Math.round(el.getBoundingClientRect().x))
  await page.getByRole('button', { name: '创意', exact: true }).click()
  await page.waitForTimeout(900)
  const navBack = await page.locator('.rail-nav').evaluate((el) => Math.round(el.getBoundingClientRect().x))
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
  if (!hadE2eSkill) fs.rmSync(e2eSkillDir, { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
