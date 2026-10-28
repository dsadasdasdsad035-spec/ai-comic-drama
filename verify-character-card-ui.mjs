/**
 * 角色卡 UI：默认页签、状态/主操作映射、表情格 44px 与键盘预览、窄屏无横向滚动。
 * 跑法：node verify-character-card-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5355
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-card-ui-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/character-expression-sheet/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const emotions = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']
const cells = emotions.map((emotion, i) => ({
  emotion, x: (i % 4) * 0.25, y: Math.floor(i / 4) * 0.5, w: 0.25, h: 0.5,
  cropUrl: `/project-assets/card/crop-${emotion}.png`, cropFingerprint: `f-${emotion}`,
}))
const look = 'short black hair, black coat'
const sheet = {
  image: '/project-assets/card/sheet.png', columns: 4, rows: 2, cells,
  source: 'generated', fingerprint: `${look}|黑|短发`, stale: false,
}
const project = {
  name: 'card-e2e', aspect: '16:9', style: '写实', assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [], shots: [],
  characters: [
    { name: '空角色', role: '待定', look_cn: '', look_en: 'blank look', palette: '灰', keywords: [] },
    {
      name: '就绪角色', role: '主角', age: '28', look_cn: '短发', look_en: look, palette: '黑', keywords: ['短发'],
      image: '/project-assets/card/identity.png', expression_sheet: sheet,
    },
    {
      name: '缺图角色', role: '配角', look_cn: '寸头', look_en: 'buzz cut', palette: '灰', keywords: [],
      image: '/missing.png',
    },
  ],
  media: { missing: ['/missing.png'] },
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
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
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
    const body = req.postDataJSON() || {}
    if (Array.isArray(body.characters)) project.characters = body.characters
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
  check('三张卡出现', (await page.locator('.char-card').count()) === 3)

  const empty = page.locator('.char-card', { hasText: '空角色' })
  check('空角色状态', (await empty.locator('.char-status').innerText()).includes('待三视图'))
  check('默认页签是三视图', (await empty.locator('.char-tabs button').first().getAttribute('aria-selected')) === 'true')
  check('空角色主操作', (await empty.locator('.char-primary').innerText()).includes('生成三视图'))
  check('空状态内有 CTA', (await empty.locator('.char-empty-cta').innerText()).includes('生成三视图'))

  const ready = page.locator('.char-card', { hasText: '就绪角色' })
  check('就绪状态', (await ready.locator('.char-status').innerText()).includes('就绪'))
  check('就绪主操作发布', (await ready.locator('.char-primary').innerText()).includes('发布表情总图'))
  await ready.getByRole('tab', { name: '表情总图' }).click()
  const boxes = await ready.locator('.expr-cell').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]))
  check('8 个表情格', boxes.length === 8)
  check('格子至少 44×44', boxes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(boxes))
  const angry = ready.locator('.expr-cell[data-emotion="angry"]')
  await angry.focus()
  await page.keyboard.press('Enter')
  check('键盘预览不改数据', (await ready.locator('.char-expr-status').innerText()).includes('怒'))
  check('卡片无横向滚动', await ready.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))

  const missing = page.locator('.char-card', { hasText: '缺图角色' })
  check('缺图状态', (await missing.locator('.char-status').innerText()).includes('缺图'))
  check('缺图主操作', (await missing.locator('.char-primary').innerText()).includes('重生成三视图'))
  check('缺图说明', (await missing.innerText()).includes('文件缺失'))

  const primaryBox = await ready.locator('.char-primary').boundingBox()
  check('900px 高主操作首屏可见', Boolean(primaryBox && primaryBox.y + primaryBox.height <= 900), JSON.stringify(primaryBox))
  // ---- 参考图区 ----
  const readyCard = page.locator('.char-card', { hasText: '就绪角色' })
  // 参考图区在三视图页；前面测表情格时切过页签，这里切回来
  await readyCard.locator('.char-tabs button').first().click()
  await page.waitForTimeout(400)
  check('角色卡有参考图区', (await readyCard.locator('[data-char-refs]').count()) === 1)
  check('初始没有参考图时显示空提示', (await readyCard.locator('.char-refs-empty').count()) === 1)

  const PNG1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const savedRefs = []
  await page.route('**/api/save-image', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    const url = `/project-assets/card/uploaded-ref-${savedRefs.length + 1}.png`
    savedRefs.push({ prefix: body.prefix, url })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url }) })
  })

  await readyCard.locator('[data-char-refs] input[type=file]').setInputFiles({
    name: 'ref.png',
    mimeType: 'image/png',
    buffer: PNG1x1,
  })
  await page.waitForTimeout(1000)
  check('上传后参考图出现', (await readyCard.locator('.char-ref').count()) === 1, String(await readyCard.locator('.char-ref').count()))
  check('上传用 char-ref 前缀', savedRefs[0]?.prefix === 'char-ref', JSON.stringify(savedRefs[0]))
  check('参考图计数显示 1/4', /1\/4/.test(await readyCard.locator('.char-refs-count').innerText()), await readyCard.locator('.char-refs-count').innerText())
  check('有「设为三视图」按钮', (await readyCard.getByRole('button', { name: '设为三视图' }).count()) === 1)

  await readyCard.getByRole('button', { name: '设为三视图' }).click()
  await page.waitForTimeout(1000)
  const readyChar = project.characters.find((c) => c.name === '就绪角色')
  check('设为三视图后 image 更新', String(readyChar?.image || '').includes('uploaded-ref-1'), JSON.stringify(readyChar?.image))
  check('设为三视图后进入候选', (readyChar?.candidates || []).includes(readyChar?.image), JSON.stringify(readyChar?.candidates))
  check('参考图列表标「已在候选」', (await readyCard.locator('.char-ref-flag').count()) >= 1)

  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'character-card-ui.png') })
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
