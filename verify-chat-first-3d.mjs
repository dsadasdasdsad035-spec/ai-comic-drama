/**
 * 聊天优先的 3D 工作台验收：首开 0 参考、输入框预填镜头文本、不自动生成；
 * 勾选参考后聊天只使用已选素材；移除 chip 同步取消左侧勾选。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-chat-first-3d.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `chat-first-3d-${Date.now()}`
const evidence = 'openspec/changes/chat-first-3d-workbench/evidence'
fs.mkdirSync(evidence, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()

const CODE = fs.readFileSync(path.join(process.cwd(), 'fixtures/agent-duel-scene.py'), 'utf8').trim()

const health = await api('/api/blender/health')
if (!health.ok) {
  console.log(`⏭ 跳过：本机 Blender 不可用（${health.message}）`)
  process.exit(0)
}

const img = await api('/api/save-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  }),
})
check('测试图片落盘', img.ok && typeof img.url === 'string', JSON.stringify(img))

await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    characters: [
      { name: '陈默', role: '主角', look_cn: '短发', look_en: 'short hair', palette: '冷灰', keywords: [], image: img.url },
    ],
    designs: [
      { id: 'scene-1', kind: 'scene', name: '井道', refs: ['S01'], summaryCn: '潮湿井道', promptEn: 'wet shaft', keywords: [], image: img.url },
      { id: 'prop-1', kind: 'prop', name: '铁箱', refs: ['S01'], summaryCn: '锈铁箱', promptEn: 'rusty box', keywords: [], image: img.url },
    ],
    assets: [{ kind: 'image', title: '手动参考', url: img.url }],
    episodes: [
      { no: 1, title: '测试', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] },
      { no: 2, title: '第二集', scenes: [{ no: 1, slug: '天台', place: '楼顶', time: '日', characters: ['陈默'] }] },
    ],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        scene_no: 1,
        scene_slug: '井道',
        seconds: 3,
        size: '中景',
        move: '推',
        cast: ['陈默'],
        dialogue: '陈默：别动',
        keyframe_prompt: '陈默站在井道门口，冷光',
        video_prompt: '镜头缓慢推近',
        keyframe: img.url,
      },
    ],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'first3d-mock'),
  { id: 'first3d-mock', label: 'First3D Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'vision'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'first3d-code' && m.key !== 'first3d-vision'),
  { key: 'first3d-code', label: 'First3D Code', cap: 'text', provider: 'first3d-mock', model: 'first3d-code' },
  { key: 'first3d-vision', label: 'First3D Vision', cap: 'vision', provider: 'first3d-mock', model: 'first3d-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'first3d-code', vision: 'first3d-vision' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'first3d-code', vision: 'first3d-vision' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const textPosts = []
const calls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CODE } },
  { name: 'run_render', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2, 3, 4] } },
  { name: 'review_frames', args: { requirements: ['主体可见'] } },
  { name: 'finish', args: { summary: '聊天首开创建完成' } },
]
let callIndex = 0
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) {
    errors.push('console: ' + m.text())
  }
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  }
  return route.continue()
})
await page.route('**/api/text', (route) => {
  textPosts.push(JSON.parse(route.request().postData() || '{}'))
  const call = calls[callIndex++]
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { content: call ? '' : '已完成', tool_calls: call ? [call] : [] },
      text: '',
      model: 'first3d-code',
      modelKey: 'first3d-code',
      modelLabel: 'First3D Code',
    }),
  })
})
await page.route('**/api/vision', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { summary: '参考可见', items: [{ label: '主体可见', ok: true }] },
      text: '',
      model: 'first3d-vision',
      modelKey: 'first3d-vision',
      modelLabel: 'First3D Vision',
    }),
  }),
)

await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(600)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const nodeId = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, NAME)
check('镜头进入画布', Boolean(nodeId), String(nodeId))
await page.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId)
await page.waitForTimeout(300)
await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.locator('.cw-shell').waitFor({ timeout: 15000 })
await page.waitForTimeout(800)

// 首开：0 项参考、空预览、不调用代码模型。
check('工作台打开', await page.locator('.cw-shell').isVisible())
check('左侧参考内容可见', await page.locator('.ctxp').isVisible())
check('首开无已选参考', (await page.locator('.ctxp-chip').count()) === 0, String(await page.locator('.ctxp-chip').count()))
check('首开参考计数为 0', (await page.locator('.ctxp-head').innerText()).includes('0 项'), await page.locator('.ctxp-head').innerText())
check('首开空预览', await page.locator('.cw-empty-preview').isVisible())
check('首开不调用代码模型', textPosts.length === 0, String(textPosts.length))

// 输入框默认空：镜头文本不再自动预填。
const input = page.locator('[data-chat-input]')
await input.waitFor({ timeout: 10000 })
await page.waitForTimeout(400)
check('输入框默认为空', (await input.inputValue()) === '', await input.inputValue())
check('首开不自动发送', (await page.locator('[data-chat-message="user"]').count()) === 0)
check('首开仍无模型调用', textPosts.length === 0, String(textPosts.length))
await page.getByRole('tab', { name: /场景/ }).click()
await page.waitForTimeout(200)
const sceneLabels1 = await page.locator('.ctxp-item-text b').allTextContents()
check('场景默认按当前集过滤', sceneLabels1.some((t) => t.includes('E01 · SC01')) && !sceneLabels1.some((t) => t.includes('E02 · SC01')), JSON.stringify(sceneLabels1))
await page.locator('.ctxp-scope select').selectOption('2')
await page.waitForTimeout(200)
const sceneLabels2 = await page.locator('.ctxp-item-text b').allTextContents()
check('切换集数只显示该集场次', sceneLabels2.some((t) => t.includes('E02 · SC01')) && !sceneLabels2.some((t) => t.includes('E01 · SC01')), JSON.stringify(sceneLabels2))
await page.locator('.ctxp-scope select').selectOption('1')
await page.getByRole('tab', { name: /角色/ }).click()
await page.waitForTimeout(200)
await page.getByRole('button', { name: '推荐参考' }).click()
await page.waitForTimeout(200)
const rec = await page.locator('.ctxp-recommend').innerText().catch(() => '')
check('推荐参考先预览', rec.includes('确认后才会加入') && rec.includes('陈默'), rec.slice(0, 200))
await page.locator('.ctxp-recommend').getByRole('button', { name: '取消' }).click()
await page.waitForTimeout(200)
check('取消推荐不改变附件', (await page.locator('.ctxp-chip').count()) === 0, String(await page.locator('.ctxp-chip').count()))
await page.getByRole('button', { name: '推荐参考' }).click()
await page.getByRole('button', { name: '加入这些参考' }).click()
await page.waitForTimeout(300)
check('确认推荐后附件增加', (await page.locator('.ctxp-chip').count()) > 0, String(await page.locator('.ctxp-chip').count()))
await page.locator('.ctxp-head-actions').getByRole('button', { name: '清空' }).click()
await page.waitForTimeout(300)
check('清空推荐后回到空状态', (await page.locator('.ctxp-chip').count()) === 0, String(await page.locator('.ctxp-chip').count()))
await page.locator('.cw-shell').screenshot({ path: `${evidence}/empty-first-open.png` })

// 勾选一个角色：左侧和聊天参考条同步。
await page.getByRole('tab', { name: /角色/ }).click()
await page.locator('.ctxp-item', { hasText: '陈默' }).first().click()
await page.waitForTimeout(200)
check('预览不直接加入上下文', (await page.locator('.ctxp-chip').count()) === 0, String(await page.locator('.ctxp-chip').count()))
await page.getByRole('button', { name: '加入上下文' }).click()
await page.waitForTimeout(250)
check('加入后左侧 1 项', (await page.locator('.ctxp-chip').count()) === 1, String(await page.locator('.ctxp-chip').count()))
check('附件栏出现角色', (await page.locator('[data-chat-context-tray]').innerText()).includes('陈默'), await page.locator('[data-chat-context-tray]').innerText())

// 移除 chip：只取消左侧勾选，不静默加入其他素材。
await page.getByRole('button', { name: '移除 陈默' }).click()
await page.waitForTimeout(250)
check('移除附件后左侧取消勾选', (await page.locator('.ctxp-chip').count()) === 0, String(await page.locator('.ctxp-chip').count()))
check('移除附件后附件栏为空', (await page.locator('[data-chat-context-tray]').innerText()).includes('还没有附件'), await page.locator('[data-chat-context-tray]').innerText())

// 重新加入并发送预填文本，确认 agent 只收到已选素材。
await page.locator('.ctxp-item', { hasText: '陈默' }).first().click()
await page.getByRole('button', { name: '加入上下文' }).click()
await page.waitForTimeout(250)
check('重新加入角色', (await page.locator('.ctxp-chip').count()) === 1, String(await page.locator('.ctxp-chip').count()))
await input.fill('把机位推近')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForTimeout(600)
const userMessage = await page.locator('[data-chat-message="user"]').first().innerText()
check('用户消息可发送', userMessage.includes('把机位推近'), userMessage)
check('发送后输入框清空', (await input.inputValue()) === '', await input.inputValue())
await page.waitForTimeout(300)
check('发送后输入框为空', (await input.inputValue()) === '', await input.inputValue())
await page.waitForFunction(
  () => document.querySelector('[data-chat-root]')?.getAttribute('data-running') === 'false',
  null,
  { timeout: 240000 },
)
const agentPrompt = textPosts.map((x) => String(x.prompt || '')).join('\n')
check('agent 上下文含已选角色', /key=character:/.test(agentPrompt) && agentPrompt.includes('陈默'), agentPrompt.slice(0, 800))
check('agent 上下文不含未选场景', !agentPrompt.includes('key=design:scene-1'))
check('agent 上下文不含未选素材图', !/key=image:/.test(agentPrompt), agentPrompt.slice(0, 800))
check('agent 上下文不含未选台词', !agentPrompt.includes('陈默：别动'))
check('模型调用 6 次', textPosts.length === 6, String(textPosts.length))
const panel = await page.locator('[data-chat-root]').innerText()
check('聊天出现完成摘要', panel.includes('聊天首开创建完成') || panel.includes('视频验收'), panel.slice(-600))
await page.locator('.cw-shell').screenshot({ path: `${evidence}/chat-first-complete.png` })
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
