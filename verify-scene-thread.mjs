/**
 * 3D 聊天线程恢复：关闭工作台后保留消息/工具摘要，运行中的旧轮标记取消。
 * 跑法：node verify-scene-thread.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5326
const APP = `http://127.0.0.1:${PORT}`
const NAME = `scene-thread-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-thread-'))
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
const api = async (p, init) => (await fetch(`${APP}${p}`, init)).json()

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

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, title: '测试', scenes: [{ no: 1, slug: '山顶', place: '山顶', time: '日' }] }],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: '山顶',
        seconds: 4,
        size: '全景',
        move: '环绕',
        cast: ['甲', '乙'],
        dialogue: [],
        keyframe_prompt: '山、两人、双剑',
        video_prompt: 'camera orbits',
      },
    ],
  }),
})

const seedMessages = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: '历史问题：这个镜头怎么调' }], status: 'complete' },
  {
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'text', text: '历史回答：先看上下文' },
      {
        type: 'tool-call',
        toolCallId: 't1',
        toolName: 'get_shot_context',
        status: 'done',
        result: { ok: true, summary: '已读取' },
      },
    ],
    status: 'complete',
  },
  {
    id: 'a2',
    role: 'assistant',
    parts: [{ type: 'text', text: '半截运行' }],
    status: 'running',
  },
]
const key = { project: NAME, surface: 'scene3d', episode: 0, shotId: 'E01-S01' }
await api('/api/chat-thread', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...key,
    messages: seedMessages,
    activeSkills: [{ id: 'scene3d', mode: 'host', version: 1, source: 'builtin' }],
  }),
})

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  const openShot = async (reload) => {
    if (reload) {
      await page.goto(APP, { waitUntil: 'domcontentloaded' })
      await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
      await page.locator('.topbar-project select').selectOption(NAME)
      await page.getByRole('button', { name: '镜头表', exact: true }).click()
      await page.waitForTimeout(600)
      await page.getByRole('button', { name: '生成到画布' }).click()
      await page.waitForTimeout(800)
      await page.getByRole('button', { name: '画布', exact: true }).click()
      await page.waitForTimeout(600)
    }
    const id = await page.evaluate((name) => {
      const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
      return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
    }, NAME)
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-id="${id}"]`)
      const o = { bubbles: true, button: 0, view: window }
      for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
    }, id)
    await page.waitForTimeout(250)
    await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
    await page.waitForTimeout(250)
    await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
    await page.locator('[data-chat-root]').waitFor({ timeout: 15000 })
    await page.waitForFunction(
      () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
      null,
      { timeout: 15000 },
    )
  }

  await openShot(true)
  const panel = await page.locator('[data-chat-root]').innerText()
  check('线程恢复用户消息', panel.includes('历史问题：这个镜头怎么调'), panel.slice(0, 200))
  check('线程恢复助手消息', panel.includes('历史回答：先看上下文'))
  check('线程恢复工具卡摘要', panel.includes('已读取镜头上下文'))
  check('显示 3D 技能来源/版本', (await page.locator('[data-scene-skill]').textContent())?.includes('scene3d'))

  await page.waitForTimeout(900)
  const afterLoad = await api(`/api/chat-thread?${new URLSearchParams({
    project: NAME,
    surface: 'scene3d',
    episode: '0',
    shotId: 'E01-S01',
  })}`)
  const restoredRunning = (afterLoad.thread?.messages || []).find((m) => m.id === 'a2')
  check('运行中的旧轮标记取消', restoredRunning?.status === 'cancelled', restoredRunning?.status)

  // 关闭工作台再打开：消息仍在
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.waitForTimeout(500)
  await openShot(false)
  await page.getByText('历史问题：这个镜头怎么调').first().waitFor({ timeout: 10000 }).catch(() => {})
  const panel2 = await page.locator('[data-chat-root]').innerText()
  check('关闭重开后消息仍在', panel2.includes('历史问题：这个镜头怎么调'))
  check('关闭重开后工具卡仍在', panel2.includes('已读取镜头上下文'))

  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
