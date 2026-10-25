/**
 * 表情总图 UI：一张 4×2 图、一次生成、身份图参考、8 格裁剪、成本、无旧逐情绪按钮、
 * 编辑抽屉保存/取消与失效。跑法：node verify-expression-sheet-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5353
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'expr-sheet-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/character-expression-sheet/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
let seedreamBody = null
let saveCalls = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const project = {
  name: 'expr-sheet-e2e', aspect: '16:9', style: '写实', shots: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{
    name: '林岚', role: '主角', age: '28', look_cn: '短发黑外套', look_en: 'short black hair, black coat',
    palette: '黑', keywords: ['短发'], image: '/project-assets/expr-sheet-e2e/identity.png',
  }],
}
const settings = {
  providers: [{ id: 'mock', label: 'Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['image', 'view', 'text'] }],
  models: [{ key: 'mock-view', label: 'Mock View', cap: 'view', caps: ['view'], provider: 'mock', model: 'mock-view' }],
  defaults: { view: 'mock-view' }, stageModels: {}, pricing: { image: 0.22 }, agentLimits: {}, agentToolProtocol: 'auto', apiKey: '', rules: {}, lipSync: { provider: 'off' },
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore',
})
let up = false
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`${APP}/api/health`)).ok) { up = true; break } } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) { child.kill(); throw new Error('临时 dev server 启动失败') }

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.route('**/api/settings**', async (route) => {
  if (route.request().method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
    return
  }
  await route.continue()
})
await page.route('**/api/voices**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'none', voices: [], capabilities: {} }) }),
)
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    const body = req.postDataJSON() || {}
    if (Array.isArray(body.characters)) project.characters = body.characters
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, characters: project.characters, shots: [] }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 0 }] }) })
})
await page.route('**/project-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
await page.route('**/api/save-image', async (route) => {
  saveCalls++
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: `/project-assets/${project.name}/crop-${saveCalls}.png` }) })
})
await page.route('**/api/seedream', async (route) => {
  seedreamBody = route.request().postDataJSON()
  const url = `/project-assets/${project.name}/sheet-${Date.now()}.png`
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, urls: [url], url, size: '2048x1152', elapsed: 1 }) })
})

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.locator('.char-card').first().waitFor({ timeout: 15000 })
  check('角色卡出现', (await page.locator('.char-card').count()) === 1)
  check('旧逐情绪按钮消失', (await page.locator('.char-expr-chip').count()) === 0)

  await page.locator('.char-primary button').click()
  await page.waitForTimeout(2200)
  check('只请求一张', seedreamBody?.n === 1, JSON.stringify({ n: seedreamBody?.n }))
  check('有身份图参考', seedreamBody?.refImage === project.characters[0].image, seedreamBody?.refImage)
  check('4×2 总图提示词', /4 columns by 2 rows|4×2/i.test(String(seedreamBody?.prompt || '')), String(seedreamBody?.prompt || '').slice(0, 120))
  check('八格全部裁剪', saveCalls === 8, `saveCalls=${saveCalls}`)
  check('写回 expression_sheet', Boolean(project.characters[0].expression_sheet?.image), JSON.stringify(project.characters[0].expression_sheet))
  check('写回八格', project.characters[0].expression_sheet?.cells?.length === 8)

  await page.getByRole('tab', { name: '表情总图' }).click()
  check('八格按钮出现', (await page.locator('.expr-cell').count()) === 8)
  await page.locator('.expr-cell[data-emotion="angry"]').click()
  check('点击只预览', (await page.locator('.char-expr-status').innerText()).includes('怒'))
  check('镜头数据未出现 performance 改动', !project.shots.some((s) => s.performance))
  check('显示成本口径', (await page.locator('.char-card').innerText()).includes('1 张'))

  await page.getByRole('button', { name: '编辑' }).click()
  const look = page.locator('.char-drawer textarea').nth(1)
  await look.fill('short black hair, black coat, cancelled')
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(300)
  check('取消不写回', project.characters[0].look_en === 'short black hair, black coat', project.characters[0].look_en)

  await page.getByRole('button', { name: '编辑' }).click()
  const look2 = page.locator('.char-drawer textarea').nth(1)
  await look2.fill('short black hair, black coat, new scar')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(800)
  check('保存写回 lookEn', String(project.characters[0].look_en).includes('new scar'), project.characters[0].look_en)
  check('身份变化标 stale', project.characters[0].expression_sheet?.stale === true, JSON.stringify(project.characters[0].expression_sheet?.stale))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'expression-sheet-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
