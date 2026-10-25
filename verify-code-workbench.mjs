/**
 * 代码工作台 UI 回归（Blender 版）：布局、代理片预览、代码页签、保存、聊天改写、撤销、窄屏。
 * 需要 dev server 与本机 Blender：
 *   APP_URL=http://127.0.0.1:5274 node verify-code-workbench.mjs
 */
import { chromium } from 'playwright-core'
import crypto from 'node:crypto'

const URL = process.env.APP_URL || 'http://127.0.0.1:5274'
const NAME = `verify-code-wb-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')

const health = await api('/api/blender/health')
if (!health.ok) {
  console.log(`⏭ 跳过：本机 Blender 不可用（${health.message}）`)
  process.exit(0)
}
console.log(`Blender ${health.version} · ${health.path}`)

const CODE = `import bpy
from mathutils import Vector

_state = {}

def _look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def build(ctx):
    bpy.ops.mesh.primitive_cube_add(size=1.2, location=(0, 0, 0.6))
    box = bpy.context.active_object
    mat = bpy.data.materials.new('Box')
    mat.use_nodes = True
    box.data.materials.append(mat)
    key = bpy.data.objects.new('Key', bpy.data.lights.new('Key', type='AREA'))
    key.data.energy = 700
    key.data.size = 4
    ctx.scene.collection.objects.link(key)
    key.location = (4, -5, 6)
    _look_at(key, (0, 0, 1))
    ctx.camera.location = (0, -7, 2.4)
    _look_at(ctx.camera, (0, 0, 1))
    _state['box'] = box

def pose(t, mode):
    box = _state.get('box')
    if box:
        box.rotation_euler[2] = t * 0.8

def dispose():
    pass
`
const CHAT_CODE = CODE.replace("box.rotation_euler[2] = t * 0.8", "box.rotation_euler[2] = t * 1.4") + '\n# chat\n'
const agentCalls = [
  { name: 'get_shot_context', args: {} },
  { name: 'set_scene_code', args: { code: CHAT_CODE } },
  { name: 'run_render', args: {} },
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
    version: 2,
    abiVersion: 2,
    runtime: 'blender',
    engineVersion: health.version,
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
  ...(settings.models || []).filter((m) => !['code', 'code2', 'vision'].includes(m.key)),
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
  const payload = {
    ok: true,
    json: { content: call ? '' : '已完成', tool_calls: call ? [call] : [] },
    text: '',
    model: 'mock-code-2',
    modelKey: 'code2',
    modelLabel: 'Mock Code 2',
  }
  if (process.env.SSE_MOCK === '1') {
    // 走真实 SSE 路径：meta → progress → done（done 里带 JSON action）
    const sse = [
      { type: 'meta', model: 'mock-code-2', modelKey: 'code2', modelLabel: 'Mock Code 2' },
      { type: 'progress', chars: 120 },
      { type: 'done', text: '', json: payload.json, model: 'mock-code-2', modelKey: 'code2', modelLabel: 'Mock Code 2' },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join('')
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse })
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(payload),
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
check('右侧聊天/代码页签存在', await page.locator('.cw-side-tabs button').count() === 2)
check('旧 SVG 平面已移除', (await page.locator('.se-plan').count()) === 0)

// 代理片：3 秒 15fps，约 45 帧
for (let i = 0; i < 240; i++) {
  const t = await page.locator('.cw-preview-status').textContent().catch(() => '')
  if (t?.includes('可预览') || t?.includes('渲染失败')) break
  await page.waitForTimeout(500)
}
const statusText = await page.locator('.cw-preview-status').textContent()
check('代理片就绪', statusText?.includes('可预览'), statusText)
check('预览是 video 而不是 iframe', (await page.locator('.cw-preview video').count()) === 1)
check('页面不再有预览 iframe', (await page.locator('.cw-preview iframe').count()) === 0)
const videoSrc = await page.locator('.cw-preview video').getAttribute('src')
check('代理片指向本地 mp4', Boolean(videoSrc && videoSrc.endsWith('.mp4')), String(videoSrc))

await page.getByRole('tab', { name: /图片/ }).click()
await page.waitForTimeout(200)
check('图片分类有可选项', (await page.locator('.ctxp-item').count()) > 0)
await page.locator('.ctxp-item').first().click()
await page.getByRole('button', { name: '加入上下文' }).click()
await page.getByRole('tab', { name: /角色/ }).click()
await page.locator('.ctxp-item', { hasText: '陈默' }).first().click()
await page.getByRole('button', { name: '加入上下文' }).click()
await page.getByRole('tab', { name: /文本/ }).click()
check('文本页签显示逐句台词', (await page.locator('.ctxp-line').count()) >= 1)
check('已选 chip 出现', (await page.locator('.ctxp-chip').count()) >= 2, String(await page.locator('.ctxp-chip').count()))
check('附件栏显示本次上下文', (await page.locator('[data-chat-context-tray]').innerText()).includes('本次上下文'), await page.locator('[data-chat-context-tray]').innerText().catch(() => ''))
await page.getByRole('button', { name: '查看将发送' }).click()
const inspector = page.locator('[data-chat-context-inspector]')
const inspectorText = await inspector.innerText().catch(() => '')
check('检查器显示两条通道', inspectorText.includes('视觉模型收到') && inspectorText.includes('代码模型收到'), inspectorText.slice(0, 200))
check('检查器显示系统提示', inspectorText.includes('系统提示'), inspectorText.slice(0, 200))
await inspector.getByRole('button', { name: '关闭' }).click()

await page.getByRole('button', { name: '代码', exact: true }).click()
const codeBox = page.locator('.cw-code')
check('代码页签显示代码', (await codeBox.inputValue()).includes('def build'))
await codeBox.fill(CODE + '\n# manual edit\n')
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(6000)
await page.getByRole('button', { name: '保存', exact: true }).first().click()
await page.waitForTimeout(2000)
let saved = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.data
}, NAME)
check('保存手改代码', String(saved?.sceneCode?.code || '').includes('# manual edit'), String(saved?.sceneCode?.source))
check('保存为 Blender v2 代码', saved?.sceneCode?.runtime === 'blender' && saved?.sceneCode?.abiVersion === 2, JSON.stringify({ r: saved?.sceneCode?.runtime, a: saved?.sceneCode?.abiVersion, e: saved?.sceneCode?.engineVersion }))

await page.getByRole('button', { name: '聊天', exact: true }).click()
const modelSelect = page.locator('label[data-stage-model-select="sceneCode"] select')
check('聊天侧栏有代码模型选择', (await modelSelect.count()) === 1)
const modelOptions = await modelSelect.locator('option').allTextContents()
check('代码模型可选多个', modelOptions.some((x) => x.includes('Mock Code 2')), JSON.stringify(modelOptions))
await modelSelect.selectOption('code2')
await page.waitForTimeout(200)
for (let i = 0; i < 40; i++) {
  if (await page.locator('[data-chat-root]').count()) break
  await page.waitForTimeout(300)
}
check('assistant-ui agent 面板加载', (await page.locator('[data-chat-root]').count()) === 1)
const agentInput = page.locator('[data-chat-input]')
await agentInput.waitFor({ timeout: 10000 })
await agentInput.fill('把机位推近')
await page.getByRole('button', { name: '发送', exact: true }).click()
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(500)
  const txt = await page.locator('[data-chat-root]').innerText().catch(() => '')
  if (txt.includes('已按聊天修改') && (txt.includes('MP4 帧验收') || txt.includes('视频未保存') || txt.includes('验收未通过'))) break
}
const chatText = await page.locator('[data-chat-root]').innerText().catch(() => '')
check('聊天返回并应用', chatText.includes('已按聊天修改'), chatText.slice(0, 600))
check('agent 工具卡出现', chatText.includes('渲染试运行通过') || chatText.includes('渲染'), chatText.slice(0, 600))
check('出现每轮上下文审计卡', (await page.locator('[data-chat-context-turn]').count()) > 0, String(await page.locator('[data-chat-context-turn]').count()))
if (errors.length) console.log('page errors:', errors.slice(0, 5))
// 验收通过后 applyEditorRender 先写项目再 patch 节点，localStorage 由 React 渲染后落盘。
await page.waitForTimeout(2000)
await page.getByRole('button', { name: '代码', exact: true }).click()
check('聊天生成完整代码', (await page.locator('.cw-code').inputValue()).includes('# chat'))
check('聊天请求使用手选代码模型', textPosts.length === 6 && textPosts.every((x) => x.modelKey === 'code2'), JSON.stringify(textPosts.map((x) => x.modelKey)))
const agentPrompt = textPosts.map((x) => `${x.system || ''}\n${x.prompt || ''}`).join('\n')
check('聊天提示不含 base64', !/data:image\//i.test(agentPrompt))
check('聊天提示含已选素材', /key=character:/.test(agentPrompt) && /key=image:/.test(agentPrompt), agentPrompt.slice(0, 400))

let applied = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  const d = (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.data
  return { video: d?.scheduleVideo, runtime: d?.sceneCodeMeta?.runtime, frames: d?.sceneCodeMeta?.frames }
}, NAME)
check('Agent 定稿视频已写入镜头', Boolean(applied.video && applied.video.endsWith('.mp4')), JSON.stringify(applied))
check('Agent 元数据是 Blender v2', applied.runtime === 'blender' && applied.frames > 0, JSON.stringify(applied))

const undoBtn = page.getByRole('button', { name: '撤销', exact: true })
if (await undoBtn.isEnabled()) {
  await undoBtn.click()
  await page.waitForTimeout(1600)
}
await page.getByRole('button', { name: '代码', exact: true }).click()
check('撤销恢复上一版代码', !(await page.locator('.cw-code').inputValue()).includes('# chat'))

await page.setViewportSize({ width: 900, height: 820 })
await page.waitForTimeout(500)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
check('900px 无横向溢出', !overflow)
check('窄屏预览仍存在', (await page.locator('.cw-preview').count()) === 1)
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(300)

await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1500)
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(500)
if (await page.locator('.cw-close-ask').count()) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForTimeout(300)
}
await page.locator(`[data-id="${nodeId}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
await page.waitForTimeout(1500)
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
