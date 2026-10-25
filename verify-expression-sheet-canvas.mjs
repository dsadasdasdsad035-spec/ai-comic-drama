/**
 * 表情总图画布卡：发布一张、重复发布更新同一张、改名同步、删角色清卡。
 * 跑法：node verify-expression-sheet-canvas.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5354
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'expr-sheet-canvas-'))
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
  cropUrl: `/project-assets/expr-canvas/crop-${emotion}.png`, cropFingerprint: `f-${emotion}`,
}))
const lookEn = 'short black hair, black coat'
const project = {
  name: 'expr-canvas', aspect: '16:9', style: '写实', assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [{
    name: '林岚', role: '主角', look_cn: '短发', look_en: lookEn, palette: '黑', keywords: ['短发'],
    image: '/project-assets/expr-canvas/identity.png',
    expression_sheet: {
      image: '/project-assets/expr-canvas/sheet.png', columns: 4, rows: 2, cells,
      source: 'generated', fingerprint: `${lookEn}|黑|短发`, stale: false,
    },
  }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定', desc: '测试', keyframe_prompt: 'test', cast: ['林岚'], dialogue: '', refIds: [], handEdited: [] }],
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
    const body = req.postDataJSON() || {}
    if (Array.isArray(body.characters)) project.characters = body.characters
    if (Array.isArray(body.assets)) project.assets = body.assets
    if (Array.isArray(body.shots)) {
      for (const s of body.shots) {
        const old = project.shots.find((x) => x.id === s.id)
        if (old) Object.assign(old, s)
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...project }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 1 }] }) })
})
await page.route('**/project-assets/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.locator('.char-card').first().waitFor({ timeout: 10000 })
  await page.locator('.char-primary button').click()
  await page.waitForTimeout(1700)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(700)
  check('画布出现一张表情卡', (await page.locator('.asset-node').count()) === 1, String(await page.locator('.asset-node').count()))
  check('卡标题含角色名', (await page.locator('.asset-title').innerText()).includes('林岚'), await page.locator('.asset-title').innerText())
  check('卡标签是表情', (await page.locator('.asset-badge').innerText()).includes('表情'), await page.locator('.asset-badge').innerText())
  check('资产落库带角色名', project.assets.some((a) => a.kind === 'expression-sheet' && a.characterName === '林岚'), JSON.stringify(project.assets))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(project.name)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.waitForTimeout(700)
  check('刷新后表情卡仍在', (await page.locator('.asset-node').count()) === 1, String(await page.locator('.asset-node').count()))

  const ids = await page.evaluate((name) => {
    const s = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(name)}`) || '{}')
    return {
      shotNode: (s.nodes || []).find((n) => n.data?.shotId === 'E01-S01')?.id,
      assetNode: (s.nodes || []).find((n) => n.data?.kind === 'expression-sheet')?.id,
    }
  }, project.name)
  await page.locator(`[data-id="${ids.assetNode}"]`).click({ button: 'right' })
  await page.locator(`.ctx-row[data-ref="${ids.shotNode}"] .ctx-main`).click({ force: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1700)
  check('连线写入镜头 refIds', project.shots[0].refIds?.includes(ids.assetNode), JSON.stringify(project.shots[0].refIds))

  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.locator('.char-primary button').click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  check('重复发布不增卡', (await page.locator('.asset-node').count()) === 1, String(await page.locator('.asset-node').count()))

  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.getByRole('button', { name: '编辑' }).click()
  await page.locator('.char-drawer input').first().fill('林岚改名')
  await page.getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  check('改名同步卡标题', (await page.locator('.asset-title').innerText()).includes('林岚改名'), await page.locator('.asset-title').innerText())
  await page.screenshot({ path: path.join(EVIDENCE, 'expression-sheet-canvas.png') })

  await page.getByRole('button', { name: '角色', exact: true }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  check('删角色清掉表情卡', (await page.locator('.asset-node').count()) === 0, String(await page.locator('.asset-node').count()))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
