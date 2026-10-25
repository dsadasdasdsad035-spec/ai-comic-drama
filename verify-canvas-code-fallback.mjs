/**
 * 画布一键出片回归：没有保存 shot3DContext 时仍用 catalog.defaults 生成代码并渲染。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-canvas-code-fallback.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `canvas-code-fallback-${Date.now()}`
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
    episodes: [{ no: 1, title: '测试', scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜', characters: ['陈默'] }] }],
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
        keyframe: img.url,
        shot_3d_context: {
          version: 1,
          characterIds: [],
          designIds: [],
          assetUrls: [],
          imageUrls: [],
          videoUrls: [],
          sceneKeys: [],
          text: { prompt: true, videoPrompt: false, dialogue: [], cast: false, marks: false, sizeMove: false },
          updatedAt: new Date().toISOString(),
        },
      },
      {
        id: 'E01-S02',
        episode: 1,
        no: 'S02',
        scene_no: 1,
        scene_slug: '井道',
        seconds: 3,
        size: '中景',
        move: '推',
        cast: [],
        dialogue: '',
        keyframe_prompt: '第二镜没有参考附件',
        keyframe: img.url,
      },
    ],
  }),
})

const current = await api('/api/settings')
const settings = current.settings || {}
settings.providers = [
  ...(settings.providers || []).filter((p) => p.id !== 'canvas-code-mock'),
  { id: 'canvas-code-mock', label: 'Canvas Code Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text', 'vision'], apiKey: 'mock' },
]
settings.models = [
  ...(settings.models || []).filter((m) => m.key !== 'canvas-code' && m.key !== 'canvas-vision'),
  { key: 'canvas-code', label: 'Canvas Code', cap: 'text', provider: 'canvas-code-mock', model: 'canvas-code' },
  { key: 'canvas-vision', label: 'Canvas Vision', cap: 'vision', provider: 'canvas-code-mock', model: 'canvas-vision' },
]
settings.defaults = { ...(settings.defaults || {}), text: 'canvas-code', vision: 'canvas-vision' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'canvas-code', vision: 'canvas-vision' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
const textPosts = []
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
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      json: { reply: '画布生成', code: CODE, motionNote: '画布运镜' },
      text: '',
      model: 'canvas-code',
      modelKey: 'canvas-code',
      modelLabel: 'Canvas Code',
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
      model: 'canvas-vision',
      modelKey: 'canvas-vision',
      modelLabel: 'Canvas Vision',
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
check('画布右键菜单有 3D 出片', (await page.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).count()) === 1)
await page.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()

await page.waitForFunction(
  (name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    const node = (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')
    return Boolean(node?.data?.sceneCode?.code && node?.data?.scheduleVideo)
  },
  NAME,
  { timeout: 180000 },
)
const data = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.data
}, NAME)
check('画布生成代码', Boolean(data?.sceneCode?.code), String(data?.sceneCode?.code?.slice(0, 16)))
check('画布渲染视频', Boolean(data?.scheduleVideo), String(data?.scheduleVideo))
check('画布调用代码模型', textPosts.length >= 1, String(textPosts.length))
check(
  '画布使用已保存的附件',
  data?.shot3DContext?.text?.prompt === true && Array.isArray(data?.shot3DContext?.characterIds),
  JSON.stringify({ characters: data?.shot3DContext?.characterIds, prompt: data?.shot3DContext?.text?.prompt }),
)
// 第二镜没有 shot3DContext：画布不得自动带入默认参考
const node2 = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S02')?.id
}, NAME)
check('第二镜进入画布', Boolean(node2), String(node2))
await page.locator(`[data-id="${node2}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
await page.waitForTimeout(250)
await page.locator('.ctx-action', { hasText: '生成调度视频（3D）' }).click()
await page.waitForTimeout(1500)
const toast = await page.locator('.toast').innerText().catch(() => '')
check('画布空上下文提示添加附件', toast.includes('还没有参考附件'), toast)

await page.screenshot({ path: 'openspec/changes/chat-first-3d-workbench/evidence/canvas-code-fallback.png' })
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
