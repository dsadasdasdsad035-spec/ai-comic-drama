/**
 * 视觉验收截图：桌面/窄屏/日间/错误/聊天/legacy。
 * 需要 dev server：APP_URL=http://127.0.0.1:5280 node verify-code-visual.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const OUT = path.join(process.cwd(), 'openspec/changes/code-first-3d-chat/evidence/visual')
fs.mkdirSync(OUT, { recursive: true })
const NAME = `visual-code-${Date.now()}`
const LEGACY = `${NAME}-legacy`
const api = async (p, init) => (await fetch(`${URL}${p}`, init)).json()
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const CODE = `let S;
function init(ctx) {
  S = ctx;
  const asset = Array.from(ctx.assets.values())[0];
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.6),
    new THREE.MeshBasicMaterial({ map: asset ? asset.texture : null, color: asset ? 0xffffff : 0x2a9d8f })
  );
  mesh.position.set(0, 1.35, 0);
  S.scene.add(mesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  S.scene.add(floor);
  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  ctx.camera.position.set(0, 1.6, 5.2);
  ctx.camera.lookAt(0, 1.2, 0);
}
function renderAt(t) { if (S) S.camera.position.x = Math.sin(t * 0.45) * 0.22; }
function dispose() {}
`
const CHAT_CODE = CODE.replace('S.camera.position.x = Math.sin(t * 0.45) * 0.22;', 'S.camera.position.x = Math.sin(t * 0.55) * 0.35;') + '\n// chat rewrite'

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const setup = await browser.newPage({ viewport: { width: 600, height: 400 } })
await setup.goto(URL, { waitUntil: 'domcontentloaded' })
const img = await setup.evaluate(async () => {
  const c = document.createElement('canvas')
  c.width = 960
  c.height = 600
  const x = c.getContext('2d')
  const g = x.createLinearGradient(0, 0, 960, 600)
  g.addColorStop(0, '#123a52')
  g.addColorStop(0.55, '#2a6d73')
  g.addColorStop(1, '#a66a3f')
  x.fillStyle = g
  x.fillRect(0, 0, 960, 600)
  x.strokeStyle = 'rgba(255,255,255,.35)'
  x.lineWidth = 6
  for (let i = 0; i < 9; i++) {
    x.beginPath()
    x.moveTo(0, 80 + i * 55)
    x.lineTo(960, 40 + i * 62)
    x.stroke()
  }
  x.fillStyle = '#f4fbff'
  x.font = 'bold 54px sans-serif'
  x.fillText('SCENE PLATE', 54, 92)
  dataUrl = c.toDataURL('image/png')
  const r = await (await fetch('/api/save-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) })).json()
  return r
})
await setup.close()
check('视觉测试图片落盘', img.ok, JSON.stringify(img))

const context = {
  version: 1,
  characterIds: [],
  designIds: [],
  assetUrls: [],
  imageUrls: [img.url],
  videoUrls: [],
  sceneKeys: ['E01-SC01'],
  text: { prompt: true, videoPrompt: true, dialogue: 'all', cast: true, marks: false, sizeMove: true },
  updatedAt: new Date().toISOString(),
}
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '井道', seconds: 3, size: '中景', move: '推',
      cast: ['陈默'], dialogue: '陈默：别动', keyframe_prompt: '井道里的发光面板', keyframe: img.url,
      scene_code: { version: 1, abiVersion: 1, code: CODE, codeHash: sha(CODE), source: 'ai', motionNote: '镜头缓慢推近', updatedAt: new Date().toISOString() },
      shot_3d_context: context,
    }],
  }),
})
const legacyScene = { id: 'E01-S01', episode: 1, sceneNo: 1, sceneSlug: '井道', w: 10, h: 8, walls: [{ id: 'w1', x1: 0, z1: 0, x2: 10, z2: 0, height: 2.8, thickness: 0.18 }], props: [], zones: [], source: 'legacy' }
const legacyBlocking = { keys: [{ t: 0, actors: [{ name: '陈默', x: 0.45, y: 0.5, face: 0 }], camera: { x: 0.5, y: 0.92, lookX: 0.5, lookY: 0.5, height: 1.6, fov: 45 } }], source: 'legacy' }
await api(`/api/project?name=${encodeURIComponent(LEGACY)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: LEGACY, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(LEGACY)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道', place: '地下', time: '夜' }] }],
    shots: [{
      id: 'E01-S01', episode: 1, no: 'S01', scene_no: 1, scene_slug: '井道', seconds: 3, size: '中景', move: '固定',
      cast: ['陈默'], dialogue: '陈默：别动', keyframe_prompt: '旧结构化镜头', shot_scene: legacyScene, shot_blocking: legacyBlocking,
    }],
  }),
})

const settingsRaw = await api('/api/settings')
const settings = settingsRaw.settings || {}
settings.providers = [...(settings.providers || []).filter((p) => p.id !== 'mock-code'), { id: 'mock-code', label: 'Mock Code', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['text'], apiKey: 'mock' }]
settings.models = [...(settings.models || []).filter((m) => m.key !== 'code'), { key: 'code', label: 'Mock Code', cap: 'text', provider: 'mock-code', model: 'mock-code' }]
settings.defaults = { ...(settings.defaults || {}), text: 'code' }
settings.stageModels = { ...(settings.stageModels || {}), sceneCode: 'code' }

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.route('**/api/settings', (route) => route.request().method() === 'GET'
  ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
  : route.continue())
await page.route('**/api/text', (route) => route.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, json: { reply: '已按聊天改用更明显的推镜', code: CHAT_CODE, motionNote: '更明显的推近' }, text: '', model: 'mock-code', modelKey: 'code', modelLabel: 'Mock Code' }),
}))
await page.goto(URL, { waitUntil: 'networkidle' })
await page.locator('.topbar-project select').selectOption(NAME)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(650)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1100)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(650)
const nodeId = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, NAME)
const open = async (nid) => {
  await page.evaluate((id) => {
    const el = document.querySelector(`[data-id="${id}"]`)
    const opt = { bubbles: true, button: 0, view: window }
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
  }, nid)
  await page.waitForTimeout(200)
  await page.locator(`[data-id="${nid}"]`).dispatchEvent('contextmenu', { clientX: 700, clientY: 420, button: 2 })
  await page.waitForTimeout(220)
  await page.locator('.ctx-action', { hasText: '编辑 3D 调度' }).click()
  await page.waitForTimeout(1000)
}
await open(nodeId)
for (let i = 0; i < 40; i++) {
  if ((await page.locator('.cw-preview-status').textContent().catch(() => ''))?.includes('代码运行中')) break
  await page.waitForTimeout(300)
}
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-desktop.png') })
check('桌面截图', fs.existsSync(path.join(OUT, 'workbench-desktop.png')))

await page.evaluate(() => document.querySelector('[data-theme-mode="day"]')?.click())
await page.waitForTimeout(450)
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-day.png') })
await page.evaluate(() => document.querySelector('[data-theme-mode="night"]')?.click())
await page.waitForTimeout(250)

await page.setViewportSize({ width: 900, height: 820 })
await page.waitForTimeout(350)
if (await page.locator('.cw-ctx-toggle').isVisible()) await page.locator('.cw-ctx-toggle').click()
await page.waitForTimeout(250)
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-900.png') })
check('窄屏无横向溢出', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(300)

await page.getByRole('button', { name: '代码', exact: true }).click()
await page.locator('.cw-code').fill('function init( {')
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(900)
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-error.png') })
check('错误截图', fs.existsSync(path.join(OUT, 'workbench-error.png')))
await page.locator('.cw-code').fill(CODE)
await page.getByRole('button', { name: '运行', exact: true }).click()
await page.waitForTimeout(1800)

await page.getByRole('button', { name: '聊天', exact: true }).click()
await page.locator('.cw-composer textarea').fill('推镜再明显一点')
await page.getByRole('button', { name: '发送', exact: true }).click()
await page.waitForTimeout(2200)
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-chat.png') })
check('聊天截图', fs.existsSync(path.join(OUT, 'workbench-chat.png')))
await page.locator('.cw-head').getByRole('button', { name: '关闭', exact: true }).click()
await page.waitForTimeout(300)
if (await page.locator('.cw-close-ask').count()) await page.getByRole('button', { name: '放弃修改', exact: true }).click()

await page.locator('.topbar-project select').selectOption(LEGACY)
await page.waitForTimeout(800)
await page.getByRole('button', { name: '镜头表', exact: true }).click()
await page.waitForTimeout(650)
await page.getByRole('button', { name: '生成到画布' }).click()
await page.waitForTimeout(1000)
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(600)
const legacyNode = await page.evaluate((name) => {
  const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId === 'E01-S01')?.id
}, LEGACY)
await open(legacyNode)
await page.waitForTimeout(800)
await page.locator('.cw-shell').screenshot({ path: path.join(OUT, 'workbench-legacy.png') })
check('legacy 截图', fs.existsSync(path.join(OUT, 'workbench-legacy.png')))
check('页面无未捕获异常', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
