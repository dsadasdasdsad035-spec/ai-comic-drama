/**
 * 创意会话「长度上限续写」UI 验收：截断后自动续写，提示可见、正文不丢，重开会话仍在。
 * 跑法：node verify-creative-notices-ui.mjs
 *
 * 说明：任务 5.2 原计划继续用 `verify-workbench-chat-ui.mjs`，但工作台 SkillChat
 * 已在 commit 0f21f45 随「收敛 Agent 聊天」移除，该脚本的 `[data-script-chat]`
 * 等选择器不再存在；对话壳现在只剩创意工作室与 3D，故把断言迁到创意 UI。
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5357
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-notices-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `notices-${Date.now()}`
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

const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: '续写验收' })
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

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // 首轮按 length 截断，续写轮自然收尾
  let textCalls = 0
  await page.route('**/api/text', async (route) => {
    textCalls++
    const reply =
      textCalls === 1
        ? { text: '雨夜街口，霓虹在积水里碎成两半。', finishReason: 'length' }
        : { text: '他抬脚跨过水洼，顺手压低了帽檐。', finishReason: 'stop' }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, toolCalls: [], modelLabel: 'Mock Text', ...reply }),
    })
  })

  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-creative-studio]').waitFor({ timeout: 20000 })
  const input = page.getByLabel('创意聊天输入')
  await input.waitFor({ timeout: 20000 })
  await input.fill('接着写雨夜下一段')
  const usersBefore = await page.locator('[data-chat-message="user"]').count()
  await page.getByRole('button', { name: '发送', exact: true }).click()

  const lastAssistant = page.locator('[data-chat-message="assistant"]').last()
  await lastAssistant.getByText('已自动从断点续写', { exact: false }).waitFor({ timeout: 30000 })
  check('截断后自动续写，提示落在对话里', true, `text 调用 ${textCalls} 次`)
  check('确实发生了第二次模型调用', textCalls >= 2, String(textCalls))
  const continuedText = await lastAssistant.innerText()
  check('截断前的正文保留', continuedText.includes('霓虹在积水里碎成两半'), continuedText.slice(0, 160))
  check('续写后的正文接在后面', continuedText.includes('跨过水洼'), continuedText.slice(0, 160))
  check(
    '提示不冒充用户输入',
    (await page.locator('[data-chat-message="user"]').count()) === usersBefore + 1,
    `${usersBefore} → ${await page.locator('[data-chat-message="user"]').count()}`,
  )
  fs.mkdirSync(path.join(ROOT, 'openspec/changes/creative-length-resilience/evidence'), { recursive: true })
  await page.screenshot({
    path: path.join(ROOT, 'openspec/changes/creative-length-resilience/evidence/creative-continuation-notice.png'),
  })

  // 离开创意再回来：线程从服务端恢复，提示仍在
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.locator('.hub').waitFor({ timeout: 20000 })
  await page.evaluate((name) => {
    window.location.hash = `#/p/${encodeURIComponent(name)}/creative`
  }, NAME)
  await page.locator('[data-creative-studio]').waitFor({ timeout: 20000 })
  await page
    .locator('[data-chat-message="assistant"]')
    .last()
    .getByText('已自动从断点续写', { exact: false })
    .waitFor({ timeout: 20000 })
  check('重开会话续写提示仍可见', true)

  check('页面无脚本错误', errors.length === 0, errors.slice(0, 200).join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
