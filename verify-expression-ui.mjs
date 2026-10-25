/**
 * 旧逐情绪表情只读兼容：旧 expressions 仍读，但新 UI 不再出现逐情绪生成按钮。
 * 跑法：node verify-expression-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5343
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'expr-legacy-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/character-expression-sheet/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const project = {
  name: 'expr-legacy', aspect: '16:9', style: '写实', shots: [], assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{
    name: '林岚', role: '主角', look_cn: '短发', look_en: 'short black hair, black coat', palette: '黑', keywords: ['短发'],
    image: '/project-assets/expr-legacy/identity.png',
    expressions: {
      happy: { image: '/project-assets/expr-legacy/happy.png', fingerprint: 'short black hair, black coat|黑|短发' },
      angry: { image: '/project-assets/expr-legacy/angry.png', fingerprint: 'short black hair, black coat|黑|短发' },
    },
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
await page.route('**/api/settings**', (route) =>
  route.request().method() === 'GET'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings, db: 'mock' }) })
    : route.continue(),
)
await page.route('**/api/voices**', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, provider: 'none', voices: [], capabilities: {} }) }),
)
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...project }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 0 }] }) })
})
await page.route('**/project-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.locator('.char-card').first().waitFor({ timeout: 15000 })
  check('角色卡出现', (await page.locator('.char-name', { hasText: '林岚' }).count()) === 1)
  check('旧表情 chip 不再渲染', (await page.locator('.char-expr-chip').count()) === 0)
  await page.getByRole('tab', { name: '表情总图' }).click()
  check('显示旧图只读回退', (await page.locator('.char-card').innerText()).includes('旧表情单图'))
  check('没有逐情绪生成按钮', (await page.getByRole('button', { name: /^生成表情$/ }).count()) === 0)
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'expression-legacy-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
