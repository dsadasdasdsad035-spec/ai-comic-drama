/**
 * 自动生成与 legacy 转换：空镜头自动出代码；旧结构化镜头只读并可显式转换。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-auto-legacy.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `verify-code-auto-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()

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
const scene = {
  id: 'E01-S02',
  episode: 1,
  sceneNo: 1,
  sceneSlug: '井道',
  w: 10,
  h: 8,
  walls: [{ id: 'w1', x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 }],
  props: [],
  zones: [],
  source: 'legacy',
}
const blocking = {
  keys: [{ t: 0, actors: [], camera: { x: 0.5, y: 0.9, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } }],
  source: 'legacy',
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
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
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
        keyframe_prompt: '空镜头，待生成',
      },
      {
        id: 'E01-S02',
        episode: 1,
        no: 'S02',
        scene_no: 1,
        scene_slug: '井道',
        seconds: 3,
        size: '中景',
        move: '固定',
        cast: ['陈默'],
        dialogue: '陈默：走',
        keyframe_prompt: '旧镜头',
        shot_scene: scene,
        shot_blocking: blocking,
      },
    ],
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
]
settings.defaults = { ...(settings.defaults || {}), text: 'code' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'code' }

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
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
  textPosts.push(JSON.parse(route.request().postData() || '{}'))
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, json: { reply: '自动生成', code: CODE, motionNote: '自动运镜' }, text: '', model: 'mock-code', modelKey: 'code', modelLabel: 'Mock Code' }),
  })
})

await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(900)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(700)

const nodeId = async (shotId) =>
  page.evaluate(({ name, shotId }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === shotId)?.id
  }, { name: NAME, shotId })
const nodeData = async (id) =>
  page.evaluate(({ name, id }) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return (s.nodes || []).find((x) => x.id === id)?.data
  }, { name: NAME, id })
const openEditor = async (id) => {
  await page.evaluate((nid) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    const opt = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
  }, id)
  await page.waitForTimeout(250)
  await page.locator(`[data-id="${id}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(250)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.waitForTimeout(900)
}

const s1 = await nodeId('E01-S01')
const s2 = await nodeId('E01-S02')
check('两个镜头进入画布', Boolean(s1 && s2))
await openEditor(s1)
for (let i = 0; i < 50; i++) {
  const t = await page.locator('.cw-preview-status').textContent().catch(() => '')
  if (t?.includes('代码运行中')) break
  await page.waitForTimeout(300)
}
check('空镜头自动生成代码', (await page.locator('.cw-preview-status').textContent())?.includes('代码运行中'))
check('自动生成调用代码模型', textPosts.length === 1, String(textPosts.length))
await page.getByRole('button', { name: '代码', exact: true }).click()
check('自动生成写出代码页签', (await page.locator('.cw-code').inputValue()).includes('function init'))
await page.locator('.cw-head').getByRole('button', { name: '保存', exact: true }).click()
await page.waitForTimeout(1000)
let d1 = await nodeData(s1)
check('自动生成保存为 sceneCode', Boolean(d1?.sceneCode?.code), String(d1?.sceneCode?.code?.slice(0, 20)))
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(500)
if (await page.locator('.cw-close-ask').count()) {
  await page.getByRole('button', { name: '放弃修改', exact: true }).click()
  await page.waitForTimeout(300)
}

const beforePosts = textPosts.length
await openEditor(s2)
check('旧结构化镜头显示只读横幅', await page.locator('.cw-legacy-bar').isVisible())
check('旧结构化预览存在', await page.locator('.cw-legacy').isVisible())
check('打开 legacy 不自动调用模型', textPosts.length === beforePosts, `${beforePosts} -> ${textPosts.length}`)
await page.locator('.cw-legacy-bar').getByRole('button', { name: '生成代码版本' }).click()
for (let i = 0; i < 50; i++) {
  const t = await page.locator('.cw-preview-status').textContent().catch(() => '')
  if (t?.includes('代码运行中')) break
  await page.waitForTimeout(300)
}
await page.waitForTimeout(700)
const d2 = await nodeData(s2)
check('legacy 转换写入 sceneCode', Boolean(d2?.sceneCode?.code), String(d2?.sceneCode?.source))
check('legacy 转换保留旧结构化', Boolean(d2?.shotScene && d2?.shotBlocking))
check('legacy 转换标记来源', d2?.sceneCode?.source === 'legacy-converted', String(d2?.sceneCode?.source))
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
