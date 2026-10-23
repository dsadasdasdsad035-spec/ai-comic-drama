/**
 * 代码工作台 UI 回归：布局、预览、代码页签、保存、聊天改写、撤销、窄屏。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-workbench.mjs
 */
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-code-wb-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const CODE = `let S;
function init(ctx) {
  S = ctx;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a9d8f })
  );
  S.scene.add(box);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.2, 4);
  ctx.camera.lookAt(0, 0, 0);
}
function renderAt(t) { if (S) S.scene.rotation.y = t; }
function dispose() {}
`
const CHAT_CODE = CODE.replace('S.scene.rotation.y = t;', 'S.scene.rotation.y = t * 1.4;') + '\n// chat'
const agentCalls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CHAT_CODE } },
  { name: 'run_sandbox', args: {} },
  { name: 'capture_frames', args: { times: [0, 1, 2] } },
  { name: 'review_frames', args: { requirements: ['场景可见', '构图符合描述'] } },
  { name: 'finish', args: { summary: '已按聊天修改' } },
]
let agentCallIndex = 0

const img = await api('/api/save-image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=' }),
})
check('测试图片落盘', img.ok && typeof img.url === 'string', JSON.stringify(img))
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
const shot = {
  id: 'E01-S01',
  episode: 1,
  no: 'S01',
  scene_no: 1,
  scene_slug: '井道',
  seconds: 3,
  size: '中景',
  move: '推',
  desc: '陈默站在门口',
  cast: ['陈默'],
  dialogue: '陈默：别动',
  keyframe_prompt: '陈默站在井道门口，冷光',
  video_prompt: '镜头缓慢推近',
  keyframe: img.url,
  scene_code: {
    version: 1,
    abiVersion: 1,
    code: CODE,
    codeHash: sha(CODE),
    source: 'manual',
    motionNote: '缓慢推近',
    updatedAt: new Date().toISOString(),
  },
  shot_3d_context: {
    version: 1,
    characterIds: [],
    designIds: [],
    assetUrls: [],
    imageUrls: [],
    videoUrls: [],
    sceneKeys: ['E01-SC01'],
    text: { prompt: true, videoPrompt: true, dialogue: 'all', cast: true, marks: false, sizeMove: true },
    updatedAt: new Date().toISOString(),
  },
}
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    characters: [{ name: '陈默', role: '主角', look_cn: '短发', look_en: 'short hair', palette: '冷灰', keywords: [], image: img.url }],
    designs: [
      { id: 'scene-1', kind: 'scene', name: '井道', refs: ['S01'], summaryCn: '潮湿井道', promptEn: 'wet shaft', keywords: [], image: img.url },
      { id: 'prop-1', kind: 'prop', name: '铁箱', refs: ['S01'], summaryCn: '锈铁箱', promptEn: 'rusty box', keywords: [], image: img.url },
    ],
    assets: [{ kind: 'image', title: '手动参考', url: img.url }],
    episodes: [{ no: 1, title: '测试', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] }],
    shots: [shot],
  }),
})

const settingsRaw = await api('/api/settings')
const settings = settingsRaw.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'mock-code'),
  { id: 'mock-code', label: 'Mock Code', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'code'),
  { key: 'code', label: 'Mock Code', cap: 'text', provider: 'mock-code', model: 'mock-code' },
  { key: 'code2', label: 'Mock Code 2', cap: 'text', provider: 'mock-code', model: 'mock-code-2' },
  { key: 'vision', label: 'Mock Vision', cap: 'vision', provider: 'mock-code', model: 'mock-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'code', vision: 'vision' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'code', vision: 'vision' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const textPosts = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon|404|Failed to load resource|Expected static flag/i.test(m.text())) errors.push('console: ' + m.text())
})
await page.route('**/api/settings', (route) => {
  if (route.request().method() === 'GET') {
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  }
  return route.continue()
})
await page.route('**/api/text', (route) => {
  const body = JSON.parse(route.request().postData() || '{}')
  textPosts.push(body)
  const call = agentCalls[agentCallIndex++]
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { content: call ? '' : '已完成', tool_calls: call ? [call] : [] },
      text: '',
      model: 'mock-code-2',
      modelKey: 'code2',
      modelLabel: 'Mock Code 2',
    }),
  })
})
await page.route('**/api/vision', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { summary: '符合要求', items: ['场景可见', '构图符合描述'].map((label) => ({ label, ok: true })) },
      text: '', model: 'mock-vision', modelKey: 'vision', modelLabel: 'Mock Vision',
    }),
  }),
)

await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(900)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1100)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(700)

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
await page.waitForTimeout(300)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.waitForTimeout(1200)
check('工作台打开', await page.locator('.cw-shell').isVisible())
check('左侧参考内容可见', await page.locator('.ctxp').isVisible())
check('中间预览 iframe 存在', await page.locator('.cw-preview iframe').count() === 1)
check('右侧聊天/代码页签存在', await page.locator('.cw-side-tabs button').count() === 2)
check('旧 SVG 平面已移除', (await page.locator('.se-plan').count()) === 0)
for (let i = 0; i < 40; i++) {
  const t = await page.locator('.cw-preview-status').textContent().catch(() => '')
  if (t?.includes('代码运行中')) break
  await page.waitForTimeout(300)
}
check('代码预览运行', (await page.locator('.cw-preview-status').textContent())?.includes('代码运行中'))
const sandboxAttr = await page.locator('.cw-preview iframe').getAttribute('sandbox')
check('预览 iframe 沙箱属性', sandboxAttr === 'allow-scripts', String(sandboxAttr))

await page.getByRole('tab', { name: /图片/ }).click()
await page.waitForTimeout(200)
const imageItems = await page.locator('.ctxp-item').count()
check('图片分类有可选项', imageItems > 0, String(imageItems))
await page.locator('.ctxp-item').first().click()
await page.getByRole('tab', { name: /角色/ }).click()
await page.locator('.ctxp-item', { hasText: '陈默' }).first().click()
await page.getByRole('tab', { name: /文本/ }).click()
check('文本页签显示逐句台词', await page.locator('.ctxp-line').count() >= 1)
check('已选 chip 出现', await page.locator('.ctxp-chip').count() >= 2, String(await page.locator('.ctxp-chip').count()))

await page.getByRole('button', { name: '代码', exact: true }).click()
const codeBox = page.locator('.cw-code')
check('代码页签显示代码', (await codeBox.inputValue()).includes('function init'))
await codeBox.fill(CODE + '\n// manual edit')
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(2200)
await page.getByRole('button', { name: '保存', exact: true }).first().click()
await page.waitForTimeout(1200)
let saved = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.data
}, NAME)
check('保存手改代码', String(saved?.sceneCode?.code || '').includes('// manual edit'), String(saved?.sceneCode?.source))

await page.getByRole('button', { name: '聊天', exact: true }).click()
const modelSelect = page.locator('label[data-stage-model-select="sceneCode"] select')
check('聊天侧栏有代码模型选择', await modelSelect.count() === 1)
const modelOptions = await modelSelect.locator('option').allTextContents()
check('代码模型可选多个', modelOptions.some((x) => x.includes('Mock Code 2')), JSON.stringify(modelOptions))
await modelSelect.selectOption('code2')
await page.waitForTimeout(200)
for (let i = 0; i < 40; i++) {
  if (await page.locator('[data-chat-root]').count()) break
  await page.waitForTimeout(300)
}
check('assistant-ui agent 面板加载', await page.locator('[data-chat-root]').count() === 1)
const agentInput = page.locator('[data-chat-input]')
await agentInput.waitFor({ timeout: 10000 })
await agentInput.fill('把机位推近')
await page.getByRole('button', { name: '发送', exact: true }).click()
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(300)
  const txt = await page.locator('[data-chat-root]').innerText().catch(() => '')
  if (txt.includes('已按聊天修改') && txt.includes('验收通过')) break
}
const chatText = await page.locator('[data-chat-root]').innerText().catch(() => '')
check('聊天返回并应用', chatText.includes('已按聊天修改'), chatText.slice(0, 500))
check('agent 工具卡出现', chatText.includes('代码草稿') && chatText.includes('沙箱通过'), chatText.slice(0, 500))
if (errors.length) console.log('page errors:', errors.slice(0, 5))
await page.getByRole('button', { name: '代码', exact: true }).click()
check('聊天生成完整代码', (await page.locator('.cw-code').inputValue()).includes('// chat'))
check('聊天请求使用手选代码模型', textPosts.length === 6 && textPosts.every((x) => x.modelKey === 'code2'), JSON.stringify(textPosts.map((x) => x.modelKey)))
const agentPrompt = textPosts.map((x) => String(x.prompt || '')).join('\n')
check('聊天提示不含 base64', !/data:image\//i.test(agentPrompt))
check('聊天提示含已选素材', /key=character:/.test(agentPrompt) && /key=image:/.test(agentPrompt), agentPrompt.slice(0, 500))

const undoBtn = page.getByRole('button', { name: '撤销', exact: true })
if (await undoBtn.isEnabled()) {
  await undoBtn.click()
  await page.waitForTimeout(1600)
}
await page.getByRole('button', { name: '代码', exact: true }).click()
check('撤销恢复上一版代码', !(await page.locator('.cw-code').inputValue()).includes('// chat'))

await page.setViewportSize({ width: 900, height: 820 })
await page.waitForTimeout(500)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('900px 无横向溢出', !overflow)
check('窄屏预览仍存在', (await page.locator('.cw-preview').count()) === 1)
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(300)

// 保存选择后重开，验证按镜头持久化
await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1200)
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(500)
if (await page.locator('.cw-close-ask').count()) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForTimeout(300)
}
await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.waitForTimeout(1200)
check('重开后恢复已选参考内容', (await page.locator('.ctxp-chip').count()) >= 2, String(await page.locator('.ctxp-chip').count()))
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(300)
if (await page.locator('.cw-close-ask').count()) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForTimeout(200)
}
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
