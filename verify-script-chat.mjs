/**
 * 剧本工作台技能聊天端到端：宿主技能、submit 草稿、只读技能、线程恢复。
 * 跑法：node verify-script-chat.mjs
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5324
const APP = `http://127.0.0.1:${PORT}`
const NAME = `script-chat-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'script-chat-'))
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

const SCRIPT = {
  logline: '一句话故事',
  episodes: [
    {
      no: 1,
      title: '试播',
      hook: '反转',
      scenes: [
        { no: 1, slug: '街口', place: '街口', time: '夜', beats: '追', characters: ['陈默'], intensity: 7, tone: '紧张' },
      ],
    },
  ],
}

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ source: '一个雨夜的追捕故事。', style: '近未来科幻写实' }),
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
settings.stageModels = { ...(settings.stageModels || {}), script: 'mock-text' }
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
  const calls = []
  let phase = 0
  await page.route('**/api/text', async (route) => {
    const body = route.request().postDataJSON()
    calls.push(body)
    let payload
    if (phase === 0) {
      phase = 1
      payload = { content: '提交剧本草稿', tool_calls: [{ name: 'submit_script', args: SCRIPT }] }
    } else if (phase === 1) {
      phase = 2
      payload = { content: '已完成剧本草稿' }
    } else {
      payload = { content: '角色建议：陈默需要一个辨识度配饰。' }
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, json: payload, text: payload.content, modelLabel: 'mock' }),
    })
  })

  const openScript = async () => {
    await page.goto(APP, { waitUntil: 'networkidle' })
    await page.locator('.topbar-project select').selectOption(NAME)
    await page.getByRole('button', { name: '剧本' }).click()
    await page.locator('[data-script-chat]').waitFor({ timeout: 10000 })
    await page.getByLabel('script 技能聊天输入').waitFor({ timeout: 10000 })
  }

  await openScript()
  check('聊天显示宿主技能', (await page.locator('[data-script-chat] .skill-chip.host').textContent())?.includes('script'))

  await page.getByRole('button', { name: '查看将发送' }).click()
  const inspectText = await page.locator('.skill-chat-inspect').textContent()
  check('发送前可见系统提示和任务', Boolean(inspectText?.includes('系统提示') && inspectText?.includes('本轮任务')), inspectText?.slice(0, 80))
  await page.getByRole('button', { name: '收起将发送' }).click()

  await page.getByLabel('script 技能聊天输入').fill('把第 1 集改成悬疑')
  await page.locator('[data-script-chat]').getByRole('button', { name: '发送', exact: true }).click()
  await page.locator('[data-chat-tool="submit_script"]').waitFor({ timeout: 15000 })
  check('提交工具卡出现', true)
  check('草稿进入剧本表格', (await page.locator('.sb-ep-title').first().inputValue()) === '试播')
  await page.getByText('已完成剧本草稿').first().waitFor({ timeout: 15000 })
  check('模型最终说明显示', true)

  const firstCall = calls[0]
  check('第一次模型调用使用技能 system', Boolean(firstCall?.system?.includes('你是短剧/漫剧的编剧与分集策划。')))
  check('技能正文不混入 user prompt', !String(firstCall?.prompt || '').includes('你是短剧/漫剧的编剧与分集策划。'))
  check('任务卡进入本轮 prompt', String(firstCall?.prompt || '').includes('【本轮技能任务】'))

  await page.locator('[data-script-chat] select[aria-label="加载只读技能"]').selectOption('character')
  check('只读技能 chip 出现', (await page.locator('[data-script-chat] .skill-chip.readonly').textContent())?.includes('character'))

  await page.getByLabel('script 技能聊天输入').fill('帮我看角色')
  await page.locator('[data-script-chat]').getByRole('button', { name: '发送', exact: true }).click()
  await page.getByText('角色建议：陈默需要一个辨识度配饰。').first().waitFor({ timeout: 15000 })
  const thirdCall = calls[2]
  check('只读技能进入 system', String(thirdCall?.system || '').includes('【只读技能：character】'))
  check('只读技能没有写工具', !String(thirdCall?.system || '').includes('submit_characters'))
  check('宿主写工具仍在', String(thirdCall?.system || '').includes('submit_script'))

  // 保存草稿，避免刷新触发未保存提示
  await page.locator('.sb-actions').getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.toast', { hasText: '剧本已写回' }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(900)

  await openScript()
  check('刷新后线程恢复用户消息', (await page.getByText('把第 1 集改成悬疑').count()) > 0)
  check('刷新后线程恢复工具卡', (await page.locator('[data-chat-tool="submit_script"]').count()) > 0)
  check('刷新后恢复只读技能', (await page.locator('[data-script-chat] .skill-chip.readonly').textContent())?.includes('character'))
  check('页面无脚本错误', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
