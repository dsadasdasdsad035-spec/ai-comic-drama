/**
 * 视频参考预算：表情默认关；开启后只带说话角色一张，排在身份/场景之后；
 * 4 张不够先省略表情；当前画面 + 身份本身超 4 张时阻止。
 * 跑法：node verify-video-expression-budget.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const root = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-video-expression-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/videoPrompt.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/expressionSheet.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/characters.ts'))}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${bundle}`,
])
const lib = await import(bundle)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const makeChar = (name) => {
  const c = { id: name, name, image: `/identity-${name}.png`, lookEn: `${name} look`, palette: 'grey', keywords: [] }
  const identity = lib.identityFingerprint(c)
  const sheet = { image: `/sheet-${name}.png`, columns: 4, rows: 2, cells: lib.buildExpressionSheetCells(), source: 'generated', fingerprint: identity }
  for (const cell of sheet.cells) {
    cell.cropUrl = `/crop-${name}-${cell.emotion}.png`
    cell.cropFingerprint = lib.cropFingerprint(sheet, cell)
  }
  return { ...c, expressionSheet: sheet }
}
const A = makeChar('A')
const B = makeChar('B')
const sceneNode = {
  id: 'asset-scene', type: 'asset', position: { x: 0, y: 0 },
  data: { title: '街口', kind: 'scene', url: '/scene.png' },
}
const base = {
  no: 'S01', seconds: 4, size: '中景', move: '固定', dialogue: 'A：走。', prompt: 'p',
  marks: [], refImage: '/current.png', cast: ['A'], refIds: [], performance: [{ character: 'A', emotion: 'angry', intensity: 3, speaks: true }],
}
const schedule = { scene: { w: 10, h: 8 }, blocking: { keys: [] }, duration: 4, ready: true, status: '生效', reason: '' }
const build = (data, characters = [A], nodes = []) =>
  lib.buildShotVideoRequest({
    data, nodeId: 's1', nodes, characters, missingMedia: new Set(), schedule,
    model: { supportsVideoRef: false }, resolution: '480p',
  })

const off = build(base)
check('默认不发表情', off.refs.every((r) => r.source !== 'expression'))
check('关闭时不显示表情占用', off.refs.length === 2, off.refs.map((r) => r.source).join(','))
check('默认开关不进请求指纹以外', off.prompt.includes('当前画面构图'))

const on = build({ ...base, useExpressionRef: true })
check('开启后带说话角色单格', on.refs.some((r) => r.source === 'expression' && r.purpose === '表情参考'), on.refs.map((r) => r.label).join(','))
check('单格排身份之后', on.refs.map((r) => r.source).join(',') === 'current,character,expression', on.refs.map((r) => r.source).join(','))
check('单格不发送总图', on.refs.every((r) => !r.url.startsWith('/sheet-')))
check('开关改变指纹', on.fingerprint !== off.fingerprint)

const two = { ...base, cast: ['A', 'B'], refIds: ['char-A', 'char-B', 'asset-scene'], useExpressionRef: true, performance: [
  { character: 'A', emotion: 'angry', intensity: 3, speaks: true },
  { character: 'B', emotion: 'sad', intensity: 2, speaks: false },
] }
const twoReq = build(two, [A, B], [sceneNode])
check('预算满时先省略表情', twoReq.omitted.some((o) => o.label.includes('A') && o.reason.includes('表情')), JSON.stringify(twoReq.omitted))
check('场景保留', twoReq.refs.some((r) => r.source === 'asset'), twoReq.refs.map((r) => r.source).join(','))
check('身份不被表情挤掉', twoReq.refs.filter((r) => r.source === 'character').length === 2)

const room = { ...base, cast: ['A', 'B'], useExpressionRef: true, performance: [
  { character: 'A', emotion: 'angry', intensity: 3, speaks: true },
  { character: 'B', emotion: 'sad', intensity: 2, speaks: false },
] }
const roomReq = build(room, [A, B], [])
check('有富余时只带说话角色', roomReq.refs.filter((r) => r.source === 'expression').length === 1)
check('非说话角色表情不加入', roomReq.refs.every((r) => !r.url.includes('B-')))

const stale = { ...base, useExpressionRef: true, performance: [{ character: 'A', emotion: 'angry', intensity: 3, speaks: true }] }
const staleChar = { ...A, expressionSheet: { ...A.expressionSheet, stale: true } }
const staleReq = build(stale, [staleChar])
check('无有效格时回退文字', staleReq.refs.every((r) => r.source !== 'expression'))
check('无有效格给出提示', staleReq.warnings.some((w) => w.code === 'expression-unavailable'), JSON.stringify(staleReq.warnings))

const four = Array.from({ length: 4 }, (_, i) => makeChar(`C${i}`))
const many = { ...base, cast: four.map((c) => c.name), performance: [], useExpressionRef: false }
const manyReq = build(many, four)
check('画面+身份超 4 张阻止', manyReq.blocking.some((b) => b.code === 'reference-overflow-identity'), JSON.stringify(manyReq.blocking))
check('阻止时不静默截断身份', manyReq.blocking[0]?.message.includes('4 张'))

const PORT = 5356
const APP = `http://127.0.0.1:${PORT}`
const UI_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'video-expr-ui-'))
const EVIDENCE = path.join(root, 'openspec/changes/character-expression-sheet/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const uiChar = {
  name: 'A', role: '主角', look_cn: '短发', look_en: 'A look', palette: 'grey', keywords: [],
  image: '/generated/id.png',
  expression_sheet: {
    image: '/generated/sheet-A.png', columns: 4, rows: 2,
    cells: A.expressionSheet.cells.map((cell) => ({
      ...cell,
      cropUrl: `/generated/crop-A-${cell.emotion}.png`,
    })),
    source: 'generated', fingerprint: A.expressionSheet.fingerprint,
  },
}
for (const cell of uiChar.expression_sheet.cells) {
  cell.cropFingerprint = lib.cropFingerprint(uiChar.expression_sheet, cell)
}
const uiProject = {
  name: 'video-expr-e2e', aspect: '16:9', style: '写实', assets: [], designs: [], episodes: [{ no: 1, title: 'E1' }], sceneLayouts: [],
  characters: [uiChar],
  shots: [{
    id: 'E01-S01', episode: 1, no: 'S01', seconds: 4, size: '中景', move: '固定', desc: 'A 说话',
    dialogue: [{ speaker: 'A', text: '走。' }],
    performance: [{ character: 'A', emotion: 'angry', intensity: 3, speaks: true }],
    cast: ['A'], refIds: ['char-A'], keyframe: '/generated/current.png', keyframe_prompt: 'p', handEdited: [],
    use_expression_ref: false,
  }],
}
const uiSettings = {
  providers: [{ id: 'mock', label: 'Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['video', 'image', 'text', 'audio'] }],
  models: [{ key: 'mock-video', label: 'Mock Video', cap: 'video', caps: ['video'], provider: 'mock', model: 'mock-video' }],
  defaults: { video: 'mock-video' }, stageModels: {}, pricing: {}, agentLimits: {}, agentToolProtocol: 'auto', apiKey: '', rules: {}, lipSync: { provider: 'off' },
}
const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: root, env: { ...process.env, SB_PROJECTS_DIR: UI_TMP }, stdio: 'ignore',
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
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, settings: uiSettings, db: 'mock' }) })
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
    for (const s of body.shots || []) {
      const old = uiProject.shots.find((x) => x.id === s.id)
      if (old) Object.assign(old, s)
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ...uiProject }) })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project: uiProject }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: uiProject.name, title: uiProject.name, shots: 1 }] }) })
})
await page.route('**/generated/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(uiProject.name)
  await page.getByRole('button', { name: '镜头表', exact: true }).click()
  await page.getByRole('button', { name: '生成到画布' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  await page.locator('.react-flow__node').first().click()
  await page.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
  const toggle = page.locator('.expression-ref-toggle input[type=checkbox]')
  await toggle.waitFor({ timeout: 10000 })
  check('UI 默认关闭', !(await toggle.isChecked()))
  check('关闭时面板显示关', (await page.locator('.vp-summary').innerText()).includes('表情参考关'))
  await toggle.check()
  await page.waitForTimeout(1700)
  check('开启写回镜头', uiProject.shots[0].use_expression_ref === true, String(uiProject.shots[0].use_expression_ref))
  check('面板显示开', (await page.locator('.vp-summary').innerText()).includes('表情参考开'))
  check('面板列出单格槽位', (await page.locator('.vp-refs').innerText()).includes('表情参考'), (await page.locator('.vp-refs').innerText()).slice(0, 200))
  check('槽位为 3/4', (await page.locator('.vp-summary').innerText()).includes('参考图 3/4'), (await page.locator('.vp-summary').innerText()).slice(0, 120))

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.topbar-project select').waitFor({ timeout: 15000 })
  await page.locator('.topbar-project select').selectOption(uiProject.name)
  await page.getByRole('button', { name: '画布', exact: true }).click()
  await page.locator('.react-flow__node').first().waitFor({ timeout: 15000 })
  await page.locator('.react-flow__node').first().click()
  await page.locator('.si-tabs [role="tab"]', { hasText: '声音' }).click()
  const toggle2 = page.locator('.expression-ref-toggle input[type=checkbox]')
  await toggle2.waitFor({ timeout: 10000 })
  check('刷新后开关保持', await toggle2.isChecked())
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  await page.screenshot({ path: path.join(EVIDENCE, 'video-expression-budget.png') })
} finally {
  await browser.close()
  child.kill()
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
