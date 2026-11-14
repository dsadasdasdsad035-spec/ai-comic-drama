/**
 * 画布已下线「拆镜助手」：本脚本仅确认入口与挂载点不存在。
 * 跑法：node verify-workbench-chats.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5325
const APP = `http://127.0.0.1:${PORT}`
const NAME = `wb-chat-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-chat-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

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

const SEED = {
  title: '雨夜',
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜街口', keyframe_prompt: 'a', video_prompt: 'b' }],
}
await fetch(`${APP}/api/project`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: NAME, title: SEED.title, shots: SEED.shots }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(NAME)
  await page.locator('[data-canvas-shots]').waitFor({ timeout: 15000 })

  check('画布无「拆镜助手」按钮', (await page.getByRole('button', { name: '拆镜助手', exact: true }).count()) === 0)
  check('画布无分镜聊天挂载点', (await page.locator('[data-shots-chat]').count()) === 0)
  check('画布仍显示导入入口', (await page.getByRole('button', { name: '导入', exact: true }).count()) === 1)
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
