/**
 * assistant-ui + LangGraph 聊天 UI 验收：脚本化模型、真实 Blender 渲染抓帧、mock vision。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-agent-chat-ui.mjs
 */
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `agent-ui-${Date.now()}`
const evidence = 'openspec/changes/chat-ui-tailwind-shadcn/evidence'
fs.mkdirSync(evidence, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const CODE = fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.py'), 'utf8').trim()

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '山顶', place: '山顶', time: '日' }] }],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '山顶', seconds: 4, size: '全景', move: '环绕',
      cast: [], dialogue: '', keyframe_prompt: '山、男女双剑对打、环绕镜头',
      scene_code: { version: 1, abiVersion: 1, code: CODE, codeHash: sha(CODE), source: 'manual', updatedAt: new Date().toISOString() },
      shot_3d_context: { version: 1, characterIds: [], designIds: [], assetUrls: [], imageUrls: [], videoUrls: [], sceneKeys: ['E01-SC01'], text: { prompt: true, videoPrompt: false, dialogue: [], cast: false, marks: false, sizeMove: true } },
    }],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'agent-mock'),
  { id: 'agent-mock', label: 'Agent Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'agent-code' && m.key !== 'agent-vision'),
  { key: 'agent-code', label: 'Agent Code', cap: 'text', provider: 'agent-mock', model: 'agent-code' },
  { key: 'agent-vision', label: 'Agent Vision', cap: 'vision', provider: 'agent-mock', model: 'agent-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'agent-code', vision: 'agent-vision' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'agent-code', vision: 'agent-vision' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const textCalls = []
let toolIndex = 0
const calls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
  { name: 'review_frames', args: { requirements: ['山体', '两个人物', '男女可区分', '两把剑', '对打姿态', '镜头环绕', '正对两人'] } },
  { name: 'finish', args: { summary: '山、男女双剑对打和环绕镜头已完成' } },
]
const secondCalls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2] } },
  { name: 'review_frames', args: { requirements: ['山体', '人物'] } },
  { name: 'finish', args: { summary: '切页签后完成' } },
]
const baselineCalls = [
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2] } },
  { name: 'review_frames', args: { requirements: ['山体', '人物'] } },
  { name: 'finish', args: { summary: '当前基线运行完成' } },
]
let phase = 'first'
let secondIndex = 0
let baselineIndex = 0
let delaySecond = false
page.on('pageerror', (e) => { errors.push(e.message); console.log('PAGEERROR', e.message) })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('BROWSER', m.type(), m.text().slice(0, 500))
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  return route.continue()
})
await page.route('**/api/text', async (route) => {
  textCalls.push(JSON.parse(route.request().postData() || '{}'))
  let c
  let content = '已完成'
  if (phase === 'baseline') {
    c = baselineCalls[baselineIndex++]
    content = baselineIndex === 1 ? '运行当前已有代码' : ''
  } else if (phase === 'second') {
    c = secondCalls[secondIndex++]
    content = secondIndex === 1 ? '切换后继续执行' : ''
    if (delaySecond) {
      delaySecond = false
      await new Promise((r) => setTimeout(r, 1800))
    }
  } else {
    const before = toolIndex
    c = calls[toolIndex++]
    content = before === 0 ? '先读取当前镜头\n```js\nconst a = 1\nconst b = 2\n```' : before === 1 ? '准备提交场景代码' : ''
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { content: c ? content : '已完成', tool_calls: c ? [c] : [] },
      text: '', model: 'agent-code', modelKey: 'agent-code', modelLabel: 'Agent Code',
    }),
  })
})
await page.route('**/api/vision', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: {
        summary: '关键帧符合要求',
        items: ['山体', '两个人物', '男女可区分', '两把剑', '对打姿态', '镜头环绕', '正对两人'].map((label) => ({ label, ok: true })),
      },
      text: '', model: 'agent-vision', modelKey: 'agent-vision', modelLabel: 'Agent Vision',
    }),
  }),
)

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
await page.evaluate((id) => { const el = document.querySelector(`[data-id="${id}"]`); const o = { bubbles: true, button: 0, view: window }; for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, o)) }, id)
await page.waitForTimeout(300)
await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
for (let i = 0; i < 40; i++) {
  if (await page.locator('[data-chat-root]').count()) break
  await page.waitForTimeout(300)
}
check('agent 聊天面板懒加载', await page.locator('[data-chat-root]').count() === 1)
const input = page.locator('[data-chat-input]')
await input.waitFor({ timeout: 10000 })
check('assistant-ui composer 存在', await input.count() === 1)
await input.fill('生成山、男女双剑对打，镜头环绕并始终正对两人')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForFunction(
  () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
  null,
  { timeout: 240000 },
)
const panel = await page.locator('[data-chat-root]').innerText()
check('工具卡按顺序出现', /读取镜头上下文|已读取镜头上下文/.test(panel) && panel.includes('代码草稿') && panel.includes('渲染'), panel.slice(0, 600))
check('finish 只显示代码阶段完成', panel.includes('代码阶段完成') && !panel.includes('场景完成'), panel.slice(-800))
check('MP4 视频卡出现', (await page.locator('[data-chat-video]').count()) === 1)
check('MP4 播放器出现', (await page.locator('[data-chat-video-player]').count()) === 1)
check('MP4 帧至少 5 张', (await page.locator('[data-chat-video-frames] img').count()) >= 5, String(await page.locator('[data-chat-video-frames] img').count()))
check('MP4 帧验收通过', (await page.locator('[data-chat-video-review]').getAttribute('data-status')) === 'passed')
check('MP4 已保存', (await page.locator('[data-chat-video]').getAttribute('data-status')) === 'passed' && panel.includes('已保存'))
check('模型轮次说明显示', panel.includes('第 1 轮') && panel.includes('先读取当前镜头'), panel.slice(0, 600))
check('模型说明在工具卡之前', panel.indexOf('先读取当前镜头') < panel.indexOf('已读取镜头上下文'), panel.slice(0, 600))
check('代码块默认折叠', await page.locator('[data-chat-code]').count() === 1 && await page.locator('[data-chat-code]').getAttribute('data-open') === 'false')
await page.locator('[data-chat-code]').screenshot({ path: `${evidence}/chat-code-collapsed.png` })
check('折叠时源码不可见', await page.locator('[data-chat-code] pre').count() === 0)
const codeToggle = page.locator('[data-chat-code-toggle]')
await codeToggle.click()
check('展开代码后可见', await page.locator('[data-chat-code]').getAttribute('data-open') === 'true' && await page.locator('[data-chat-code] pre').count() === 1)
await codeToggle.click()
check('再次点击可收起', await page.locator('[data-chat-code]').getAttribute('data-open') === 'false')
check('5 张关键帧缩略图', await page.locator('[data-chat-frames] img').count() === 5, String(await page.locator('[data-chat-frames] img').count()))
check('验收清单显示', panel.includes('验收通过') && panel.includes('山体') && panel.includes('两把剑'), panel.slice(-600))
check('完成摘要显示', panel.includes('山、男女双剑对打和环绕镜头已完成'), panel.slice(-200))
check('模型调用 6 次', textCalls.length === 6, String(textCalls.length))
check('没有旧聊天日志', (await page.locator('.cw-chat-log').count()) === 0)
await page.locator('[data-chat-input]').focus()
check('聊天输入可聚焦', await page.locator('[data-chat-input]').evaluate((el) => document.activeElement === el))
await page.locator('.cw-shell').screenshot({ path: `${evidence}/agent-chat.png` })

// 主题与窄屏：工具卡、缩略图、清单在日间/夜间和 900px 仍可读。
await page.evaluate(() => document.querySelector('[data-theme-mode="day"]')?.click())
await page.waitForTimeout(350)
check('日间主题生效', await page.evaluate(() => document.documentElement.dataset.theme === 'day'))
await page.locator('.cw-shell').screenshot({ path: `${evidence}/agent-chat-day.png` })
await page.evaluate(() => document.querySelector('[data-theme-mode="night"]')?.click())
await page.waitForTimeout(350)
check('夜间主题生效', await page.evaluate(() => document.documentElement.dataset.theme === 'night'))
await page.locator('.cw-shell').screenshot({ path: `${evidence}/agent-chat-night.png` })
await page.setViewportSize({ width: 900, height: 820 })
await page.waitForTimeout(500)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('900px 无横向溢出', !overflow)
await page.locator('.cw-shell').screenshot({ path: `${evidence}/agent-chat-900.png` })
await page.setViewportSize({ width: 760, height: 820 })
await page.waitForTimeout(500)
const overflow760 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('760px 无横向溢出', !overflow760)
await page.locator('.cw-shell').screenshot({ path: `${evidence}/agent-chat-760.png` })
// 页签切换：聊天保持挂载，内容与滚动位置不丢。
const historyBefore = await page.locator('[data-chat-root]').innerText()
await page.setViewportSize({ width: 1600, height: 720 })
await page.waitForTimeout(300)
const viewport = page.locator('[data-chat-viewport]')
const scrollMetrics = await viewport.evaluate((el) => ({ client: el.clientHeight, height: el.scrollHeight }))
check('聊天视口可滚动', scrollMetrics.height > scrollMetrics.client, JSON.stringify(scrollMetrics))
await viewport.evaluate((el) => { el.scrollTop = 60 })
const scrollBefore = await viewport.evaluate((el) => el.scrollTop)
await page.getByRole('button', { name: '代码', exact: true }).click()
await page.waitForTimeout(250)
check('切到代码页签聊天仍挂载', await page.locator('[data-chat-root]').count() === 1)
check('隐藏的聊天页签不可见', !(await page.locator('[data-chat-root]').isVisible()))
check('代码页签可见', await page.locator('.cw-code').isVisible())
await page.getByRole('button', { name: '聊天', exact: true }).click()
await page.waitForTimeout(250)
const historyAfter = await page.locator('[data-chat-root]').innerText()
check('切回聊天内容不变', historyAfter === historyBefore, `${historyBefore.length} -> ${historyAfter.length}`)
check('切回聊天帧仍在', await page.locator('[data-chat-frames] img').count() === 5)
const scrollAfter = await page.locator('[data-chat-viewport]').evaluate((el) => el.scrollTop)
check('切回聊天滚动位置不变', scrollAfter === scrollBefore, `${scrollBefore} -> ${scrollAfter}`)
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(300)

// 运行中切换：延迟首个模型响应，确认切到代码页签后 agent 继续完成。
phase = 'second'
delaySecond = true
await page.locator('[data-chat-input]').fill('运行中切换测试')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForFunction(() => document.querySelectorAll('[data-chat-message="user"]').length >= 2)
await page.getByRole('button', { name: '代码', exact: true }).click()
await page.waitForTimeout(300)
check('运行中切页签仍运行', await page.locator('[data-chat-root]').getAttribute('data-running') === 'true')
await page.waitForFunction(() => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false', null, { timeout: 90000 })
const backgroundText = await page.locator('[data-chat-root]').innerText()
check('后台运行完成', backgroundText.includes('切页签后完成') && backgroundText.includes('切换后继续执行'), backgroundText.slice(-800))
await page.getByRole('button', { name: '聊天', exact: true }).click()
await page.waitForTimeout(200)
check('切回看到后台完成摘要', (await page.locator('[data-chat-root]').innerText()).includes('切页签后完成'))

// 当前工作台已有代码：run_render 可直接运行，不要求先 set_scene_code。
phase = 'baseline'
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(300)
await page.locator('[data-chat-input]').fill('运行当前场景，不要重新生成代码')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForFunction(() => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false', null, { timeout: 60000 })
const baselinePanel = await page.locator('[data-chat-root]').innerText()
check('已有代码直接运行不报未提交', !baselinePanel.includes('还没有提交代码') && baselinePanel.includes('渲染试运行通过'), baselinePanel.slice(-1000))
check('已有代码可直接抓帧', await page.locator('[data-chat-frames] img').count() >= 3)
check('基线运行完成', baselinePanel.includes('当前基线运行完成'))

check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
