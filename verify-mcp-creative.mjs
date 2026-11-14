/**
 * MCP + 创意工作室 UI：设置页市场/已配置、创意顶栏 MCP 入口、工具数展示。
 * 跑法：node verify-mcp-creative.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5356
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-creative-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `mcp-ui-${Date.now()}`
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

const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: 'MCP 验收' })
writeProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, {
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜', keyframe_prompt: 'a', video_prompt: 'b' }],
})
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'inherit' })

const E2E_SKILL = 'e2e-creative-host'
const e2eSkillDir = path.join(ROOT, 'skills', E2E_SKILL)
const e2eSkillMd = path.join(e2eSkillDir, 'SKILL.md')
const hadE2eSkill = fs.existsSync(e2eSkillDir)
fs.mkdirSync(e2eSkillDir, { recursive: true })
fs.writeFileSync(
  e2eSkillMd,
  `---
name: ${E2E_SKILL}
description: E2E
stage: creative
runtime: tools
tools: [read_skill]
inputs: [topic]
output: creative-plan-v1
contracts: [creative-plan-v1]
version: 1
---
E2E MCP UI
`,
)

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

// 预置：市场安装 + 勾选创意（tools/list 走 mock，避免外网）
const installed = await api('/api/mcp/install', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ marketId: 'github' }),
})
const serverId = installed.server?.id || 'mcp-github'
await api(`/api/mcp/servers/${encodeURIComponent(serverId)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'http://127.0.0.1:9/', creativeChat: true }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.route('**/api/mcp/creative-tools', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        tools: [
          {
            serverId,
            name: 'echo',
            description: 'mock',
            externalName: `mcp.${serverId}.echo`,
          },
        ],
      }),
    })
  })

  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/settings`, { waitUntil: 'domcontentloaded' })
  await page.locator('.rail').waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'MCP', exact: true }).click()
  await page.locator('[data-settings-section="mcp"]').waitFor({ timeout: 10000 })
  check('设置页 MCP 分区可见', true)

  await page.locator('[data-mcp-settings]').waitFor({ timeout: 10000 })
  const mcpHint = await page.locator('[data-mcp-settings] .st-hint').first().innerText()
  check('MCP 说明含创意聊天', mcpHint.includes('创意聊天'), mcpHint.slice(0, 80))

  await page.getByRole('button', { name: 'MCP 市场', exact: true }).click()
  await page.waitForTimeout(400)
  const marketText = await page.locator('[data-mcp-settings]').innerText()
  check('市场展示 GitHub 卡片', marketText.includes('GitHub'), marketText.slice(0, 120))

  await page.getByRole('button', { name: /已配置/ }).click()
  await page.locator(`[data-mcp-server-card="${serverId}"]`).click()
  await page.locator(`[data-mcp-server="${serverId}"]`).waitFor({ timeout: 10000 })
  const creativeBox = page.locator(`[data-mcp-server="${serverId}"] input[type="checkbox"]`)
  check('已安装项勾选创意聊天', await creativeBox.isChecked())

  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/creative`, { waitUntil: 'domcontentloaded' })
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

  const mcpBtn = page.locator('[data-creative-action="mcp"]')
  await mcpBtn.waitFor({ timeout: 10000 })
  const mcpLabel = (await mcpBtn.innerText()).replace(/\s+/g, ' ')
  check('创意顶栏展示 MCP 工具数', mcpLabel.includes('MCP') && mcpLabel.includes('1'), mcpLabel)

  await mcpBtn.click()
  await page.locator('[data-settings-section="mcp"]').waitFor({ timeout: 10000 })
  check('创意顶栏跳转 MCP 设置', true)

  const empty = await page.locator('[data-creative-empty]').innerText().catch(() => '')
  if (empty) check('空态提及 MCP 配置', empty.includes('MCP'), empty.slice(0, 100))

  check('页面无未捕获异常', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  child.kill()
  if (!hadE2eSkill) fs.rmSync(e2eSkillDir, { recursive: true, force: true })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
