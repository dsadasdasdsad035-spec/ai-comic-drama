/**
 * Agent 聊天失败/取消 UI 回归：模型 500 保留旧代码；运行中取消；输入可重试。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-agent-chat-failure.mjs
 */
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `agent-fail-${Date.now()}`
const CODE = fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.py'), 'utf8').trim()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '山顶', place: '山顶', time: '日' }] }],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '山顶', seconds: 4, size: '全景', move: '环绕',
      cast: [], dialogue: '', keyframe_prompt: '山、男女双剑对打',
      scene_code: { version: 1, abiVersion: 1, code: CODE, codeHash: sha(CODE), source: 'manual', updatedAt: new Date().toISOString() },
      shot_3d_context: { version: 1, characterIds: [], designIds: [], assetUrls: [], imageUrls: [], videoUrls: [], sceneKeys: ['E01-SC01'], text: { prompt: true, videoPrompt: false, dialogue: [], cast: false, marks: false, sizeMove: true } },
    }],
  }),
})
const current = await api('/api/settings')
const settings = current.settings || {}
const mock = {
  ...settings,
  providers: [...(settings.providers || []).filter((p) => p.id !== 'agent-fail-mock'), { id: 'agent-fail-mock', label: 'Fail Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' }],
  models: [...(settings.models || []).filter((m) => m.key !== 'fail-code'), { key: 'fail-code', label: 'Fail Code', cap: 'text', provider: 'agent-fail-mock', model: 'fail-code' }],
  defaults: { ...(settings.defaults || {}), text: 'fail-code' },
  stageModels: { ...(settings.stageModels || {}), sceneCode: 'fail-code' },
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let mode = 'fail'
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings: mock, db: 'mock' }) })
  return route.continue()
})
await page.route('**/api/text', async (route) => {
  if (mode === 'fail') {
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'mock model down' }) })
  }
  if (mode === 'timeout') {
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: '运行超时（60 秒）；可在设置页「Agent 运行上限」调整' }) })
  }
  await new Promise((r) => setTimeout(r, 4000))
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json: { content: '', tool_calls: [{ name: 'get_shot_context', args: {} }] }, text: '', model: 'fail-code', modelKey: 'fail-code', modelLabel: 'Fail Code' }),
  })
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const id = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, NAME)
await page.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const o = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o))
}, id)
await page.waitForTimeout(300)
await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
for (let i = 0; i < 40; i++) {
  if (await page.locator('[data-chat-root]').count()) break
  await page.waitForTimeout(300)
}
const input = page.locator('[data-chat-input]')
await input.waitFor({ timeout: 10000 })
const codeBefore = CODE

// 模型失败：显示错误，旧代码不变，仍可再次发送。
await input.fill('生成失败测试')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForFunction(() => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false', null, { timeout: 30000 })
let panel = await page.locator('[data-chat-root]').innerText()
check('模型失败显示错误', panel.includes('失败：') && panel.includes('mock model down'), panel.slice(-500))
await page.getByRole('button', { name: '代码', exact: true }).click()
const codeAfterFail = await page.locator('.cw-code').inputValue()
check('失败不改写旧代码', codeAfterFail.trim() === codeBefore.trim(), String(codeAfterFail.slice(0, 60)))
await page.getByRole('button', { name: '聊天', exact: true }).click()

// 运行中取消：请求延迟 4s，点击取消后应返回已取消。
mode = 'delay'
await input.fill('生成后立即取消')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForTimeout(500)
const cancel = page.locator('[data-chat-actions]').getByRole('button', { name: '取消', exact: true })
check('运行中可取消', await cancel.isEnabled())
await cancel.click()
await page.waitForFunction(() => (document.querySelector('[data-chat-root]')?.innerText || '').includes('已取消'), null, { timeout: 15000 })
await page.waitForFunction(() => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false', null, { timeout: 15000 })
panel = await page.locator('[data-chat-root]').innerText()
check('取消状态显示', panel.includes('已取消'), panel.slice(-300))
await page.getByRole('button', { name: '代码', exact: true }).click()
check('取消不改写旧代码', (await page.locator('.cw-code').inputValue()).trim() === codeAfterFail.trim())
await page.getByRole('button', { name: '聊天', exact: true }).click()
check('输入仍可重试', await page.locator('[data-chat-input]').isVisible())

// 超时错误提示：不得显示成用户取消，输入仍可用。
mode = 'timeout'
await page.locator('[data-chat-input]').fill('超时提示测试')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForFunction(() => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false', null, { timeout: 30000 })
const timeoutPanel = await page.locator('[data-chat-root]').innerText()
const latestTimeout = timeoutPanel.slice(timeoutPanel.lastIndexOf('超时提示测试'))
check('超时错误显示', latestTimeout.includes('运行超时') && !latestTimeout.includes('已取消'), latestTimeout)
check('超时后输入仍可用', await page.locator('[data-chat-input]').isEditable())
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
