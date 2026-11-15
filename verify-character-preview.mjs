/**
 * 角色卡预览页签：页签存在、iframe 渲染角色名、打开期间不触发生成。
 * 跑法：node verify-character-preview.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { selectProject } from './verify-lib.mjs'

const ROOT = process.cwd()
const PORT = 5366
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'char-preview-'))
const EVIDENCE = path.join(ROOT, 'openspec/changes/character-preview-3d/evidence')
fs.mkdirSync(EVIDENCE, { recursive: true })
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

/** 等角色被写回带齐八帧的转盘总图 */
async function waitOrbit(page, name, timeout = 40000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const ch = project.characters.find((item) => item.name === name)
    const cells = ch?.orbit_sheet?.cells
    if (cells?.length === 8 && cells.every((cell) => cell.cropUrl)) return ch
    await page.waitForTimeout(200)
  }
  return undefined
}

const emotions = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm']
const exprCells = emotions.map((emotion, i) => ({
  emotion,
  x: (i % 4) * 0.25,
  y: Math.floor(i / 4) * 0.5,
  w: 0.25,
  h: 0.5,
  cropUrl: `/project-assets/card/crop-${emotion}.png`,
  cropFingerprint: `f-${emotion}`,
}))
const lookEn = 'short black hair, black coat'
const lookCn = '短发，黑外套'
const expressionSheet = {
  image: '/project-assets/card/sheet.png',
  columns: 4,
  rows: 2,
  cells: exprCells,
  source: 'generated',
  fingerprint: `${lookEn}|黑|短发`,
  stale: false,
}
const project = {
  name: 'preview-e2e',
  aspect: '16:9',
  style: '写实',
  assets: [],
  designs: [],
  episodes: [{ no: 1, title: 'E1' }],
  sceneLayouts: [],
  shots: [],
  characters: [
    {
      name: '预览角色',
      role: '主角',
      age: '28',
      look_cn: lookCn,
      look_en: lookEn,
      palette: '黑',
      keywords: ['短发'],
      image: '/project-assets/card/identity.png',
      expression_sheet: expressionSheet,
      voice_sample: {
        url: '/project-assets/card/voice.mp3',
        text: '这是一段试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'mock-v1',
        fingerprint: 'voice-fp',
      },
    },
    { name: '空角色', role: '待定', look_cn: '', look_en: 'blank look', palette: '灰', keywords: [] },
    {
      name: '大音色角色',
      role: '配角',
      look_cn: '长音色',
      look_en: 'long voice',
      palette: '灰',
      keywords: [],
      image: '/project-assets/card/identity.png',
      voice_sample: {
        url: '/project-assets/card/big.mp3',
        text: '一大段试音',
        seconds: 30,
        engine: 'volc-tts',
        voiceId: 'mock-v1',
        fingerprint: 'voice-big',
      },
    },
    {
      name: '静态角色',
      role: '路人',
      look_cn: '只有造型图',
      look_en: 'static only',
      palette: '灰',
      keywords: [],
      image: '/project-assets/card/identity.png',
    },
    {
      name: '失效试音角色',
      role: '路人',
      look_cn: '试音过期',
      look_en: 'stale voice',
      palette: '灰',
      keywords: [],
      image: '/project-assets/card/identity.png',
      voice_sample: {
        url: '/project-assets/card/voice.mp3',
        text: '过期试音',
        seconds: 4,
        engine: 'volc-tts',
        voiceId: 'mock-v1',
        fingerprint: 'old',
        stale: true,
      },
    },
  ],
  media: { missing: [] },
}
const settings = {
  providers: [
    { id: 'mock', label: 'Mock', kind: 'openai', baseUrl: 'https://mock.invalid', caps: ['image', 'view', 'text'] },
  ],
  models: [
    { key: 'mock-image', label: 'Mock Image', cap: 'image', caps: ['image'], provider: 'mock', model: 'mock-image' },
    { key: 'mock-view', label: 'Mock View', cap: 'view', caps: ['view'], provider: 'mock', model: 'mock-view' },
    { key: 'mock-audio', label: 'Mock TTS', cap: 'audio', caps: ['audio'], provider: 'mock', model: 'mock-tts' },
  ],
  defaults: { view: 'mock-view', image: 'mock-image', audio: 'mock-audio' },
  stageModels: {},
  pricing: { image: 0.22 },
  agentLimits: {},
  agentToolProtocol: 'auto',
  apiKey: '',
  rules: {},
  lipSync: { provider: 'off' },
}
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)
/** 小音色：真实可播的 WAV，用来验证"点击能播" */
const SMALL_WAV = (() => {
  const rate = 8000
  const samples = Math.floor(rate * 0.4)
  const dataSize = samples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
})()
/** 大音色：让导出必然超过 5MB 软上限，用来验体积确认 */
const BIG_MP3 = Buffer.alloc(6 * 1024 * 1024, 9)

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
      up = true
      break
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  child.kill()
  throw new Error('临时 dev server 启动失败')
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  // 播放断言需要确定性的自动播放策略：仍靠显式 play() 触发，不靠自动播放
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const notFound = []
page.on('response', (res) => {
  if (res.status() === 404) notFound.push(res.url())
})
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
})

/** 任何生成请求都算失败：预览页签只读 */
const generationHits = []
page.on('request', (req) => {
  const url = req.url()
  if (req.method() !== 'POST') return
  if (/\/api\/(seedream|seedance|voice|tts)/.test(url)) generationHits.push(`${req.method()} ${url}`)
})

await page.route('**/api/settings**', (route) =>
  route.request().method() === 'GET'
    ? route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, settings, db: 'mock' }),
      })
    : route.continue(),
)
await page.route('**/api/voices**', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      provider: 'mock',
      modelKey: 'mock-audio',
      voices: [{ id: 'mock-v1', label: 'Mock Voice', voiceId: 'mock-v1', provider: 'mock', source: 'preset' }],
      capabilities: {},
    }),
  }),
)
/** 生图与裁图落盘都要 mock；断言只看请求体，不关心真实出图 */
const seedreamCalls = []
await page.route('**/api/seedream', async (route) => {
  seedreamCalls.push(route.request().postDataJSON() || {})
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/project-assets/card/orbit.png'] }),
  })
})
const savedCrops = []
await page.route('**/api/save-image', async (route) => {
  const body = route.request().postDataJSON() || {}
  const url = `/project-assets/card/${body.prefix || 'crop'}.png`
  savedCrops.push({ prefix: body.prefix, url })
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url }) })
})
await page.route('**/api/project**', async (route) => {
  const req = route.request()
  const url = new globalThis.URL(req.url())
  if (req.method() === 'POST') {
    const body = req.postDataJSON() || {}
    if (Array.isArray(body.characters)) project.characters = body.characters
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ...project }),
    })
    return
  }
  if (url.searchParams.get('name')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, project }) })
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, root: '/mock', projects: [{ name: project.name, title: project.name, shots: 0 }] }),
  })
})
await page.route('**/project-assets/**', (route) => {
  const url = route.request().url()
  if (url.endsWith('.mp3')) {
    const big = url.includes('big.mp3')
    return route.fulfill({
      status: 200,
      contentType: big ? 'audio/mpeg' : 'audio/wav',
      body: big ? BIG_MP3 : SMALL_WAV,
    })
  }
  return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
})

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await selectProject(page, project.name)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.locator('[data-asset-character-tab]').click()
  await page.locator('.char-card').first().waitFor({ timeout: 15000 })

  const card = page.locator('.char-card', { hasText: '预览角色' })
  check('预览页签存在', (await card.locator('[data-char-tab="preview"]').count()) === 1)
  check('预览页签未选中', (await card.locator('[data-char-tab="preview"]').getAttribute('aria-selected')) === 'false')

  generationHits.length = 0
  await card.locator('[data-char-tab="preview"]').click()
  const frameEl = card.locator('.char-preview-frame')
  await frameEl.waitFor({ timeout: 15000 })

  const frame = card.frameLocator('.char-preview-frame')
  await frame.locator('[data-preview-root]').waitFor({ timeout: 15000 })
  const body = await frame.locator('body').innerText()
  check('iframe 渲染出角色名', body.includes('预览角色'), body.slice(0, 80))
  check('iframe 渲染出外观描述', body.includes(lookCn), body.slice(0, 120))
  check('iframe 渲染出表情区', (await frame.locator('[data-preview-emotions] img').count()) === 8)

  const sandbox = await frameEl.getAttribute('sandbox')
  check('沙箱不给 same-origin', sandbox === 'allow-scripts', String(sandbox))

  await page.waitForTimeout(600)
  check('打开预览不触发生成', generationHits.length === 0, generationHits.join(' / '))
  check('页面无异常', errors.length === 0, errors.slice(0, 3).join(' / '))
  check('预览不产生 404 资源', notFound.length === 0, notFound.slice(0, 5).join(' / '))

  await page.screenshot({ path: path.join(EVIDENCE, 'character-preview-tab.png') })

  // ---- 转盘总图生成 ----
  const genBtn = card.locator('[data-char-orbit-generate]')
  check('转盘按钮显示价格', (await genBtn.innerText()).includes('¥'), await genBtn.innerText())
  generationHits.length = 0
  seedreamCalls.length = 0
  savedCrops.length = 0
  await page.waitForTimeout(300)
  check('未点击前没有生图请求', seedreamCalls.length === 0, String(seedreamCalls.length))

  await genBtn.click()
  const orbitChar = await waitOrbit(page, '预览角色')
  check('转盘写回八帧', Boolean(orbitChar))
  check('只提交一次生图', seedreamCalls.length === 1, String(seedreamCalls.length))
  const genBody = seedreamCalls[0] || {}
  check('提示词含八角度描述', String(genBody.prompt || '').includes('4 columns by 2 rows'))
  check('提示词含角色锚点', String(genBody.prompt || '').includes(lookEn))
  check('三视图作为身份参考', genBody.refImage === '/project-assets/card/identity.png', String(genBody.refImage))
  check('不带其他角色参考图', (genBody.refImages || []).length === 0, JSON.stringify(genBody.refImages))
  check('走 view 能力', genBody.cap === 'view', String(genBody.cap))
  check('转盘记录身份指纹', /^[0-9a-f]{16}$/.test(String(orbitChar?.orbit_sheet?.fingerprint || '')))
  check(
    '八帧都带裁图与指纹',
    (orbitChar?.orbit_sheet?.cells || []).every((cell) => cell.cropUrl && cell.cropFingerprint),
  )
  check(
    '按角度命名裁图',
    savedCrops.filter((item) => String(item.prefix).startsWith('char-orbit-')).length === 8,
    JSON.stringify(savedCrops.slice(0, 2)),
  )
  await card.locator('[data-char-orbit-stale]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  check('生成后没有失效标记', (await card.locator('[data-char-orbit-stale]').count()) === 0)
  generationHits.length = 0

  // ---- 转盘拖动 ----
  const orbitFrame = card.frameLocator('.char-preview-frame')
  const stageLoc = orbitFrame.locator('[data-orbit]')
  await stageLoc.waitFor({ timeout: 20000 })
  check('生成后渲染出转盘', (await stageLoc.count()) === 1)
  check('八帧齐备', (await orbitFrame.locator('img.frame').count()) === 8)
  check('初始只显示一帧', (await orbitFrame.locator('img.frame.on').count()) === 1)
  const box = await stageLoc.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const angle = async () => Number(await stageLoc.getAttribute('data-orbit-angle'))
  const startAngle = await angle()
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 120, cy, { steps: 10 })
  await page.mouse.up()
  const draggedAngle = await angle()
  check('拖动改变角度', draggedAngle !== startAngle, `${startAngle} -> ${draggedAngle}`)
  await page.waitForTimeout(500)
  check('松手后停住', (await angle()) === draggedAngle)
  check('拖动后仍只显示一帧', (await orbitFrame.locator('img.frame.on').count()) === 1)

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 800, cy, { steps: 24 })
  await page.mouse.up()
  const wrappedAngle = await angle()
  check('越界回绕在 0–359', wrappedAngle >= 0 && wrappedAngle < 360, String(wrappedAngle))
  check('回绕后仍有可见帧', (await orbitFrame.locator('img.frame.on').count()) === 1)

  // ---- 试音播放 ----
  const audio = orbitFrame.locator('[data-preview-voice] audio')
  check('打开预览时未自动播放', (await audio.evaluate((el) => el.paused)) === true)
  await audio.evaluate((el) => el.play())
  await page.waitForTimeout(400)
  check('触发后可播放', (await audio.evaluate((el) => !el.paused || el.currentTime > 0)) === true)
  await audio.evaluate((el) => el.pause())

  // ---- 单文件导出 ----
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45000 }),
    card.locator('[data-char-export]').click(),
  ])
  check('导出文件名合法', download.suggestedFilename() === '预览角色-角色卡.html', download.suggestedFilename())
  const exportedPath = path.join(TMP, 'export.html')
  await download.saveAs(exportedPath)
  const exported = fs.readFileSync(exportedPath, 'utf8')
  check('导出不含站内原始路径', !exported.includes('/project-assets/'))
  check('导出内联了图片', exported.includes('data:image/'))
  check('导出内联了音频', exported.includes('data:audio/'))
  check('导出带 schemaVersion', exported.includes('data-preview-schema="1"'))
  check('导出带身份指纹', /data-preview-identity="[^"]+"/.test(exported))
  check('导出带生成时间', exported.includes('data-preview-generated=') && /生成于 \d{4}-\d{2}-\d{2}/.test(exported))
  check('导出不含其他角色', !exported.includes('空角色') && !exported.includes('大音色角色'))
  check(
    '导出不含本机绝对路径',
    !exported.includes(TMP) && !exported.includes(os.tmpdir()) && !exported.includes('/Users/'),
  )
  check('导出全程不触发生成', generationHits.length === 0, generationHits.join(' / '))

  // ---- 离线打开 ----
  const offline = await browser.newPage()
  const externalRequests = []
  const offlineErrors = []
  offline.on('request', (req) => {
    if (/^https?:/i.test(req.url())) externalRequests.push(req.url())
  })
  offline.on('pageerror', (e) => offlineErrors.push(e.message))
  await offline.goto(`file://${exportedPath}`, { waitUntil: 'load' })
  await offline.locator('[data-preview-root]').waitFor({ timeout: 15000 })
  const offlineText = await offline.locator('body').innerText()
  check('离线文件渲染角色', offlineText.includes('预览角色'), offlineText.slice(0, 60))
  const imgOk = await offline
    .locator('[data-preview-root] img')
    .first()
    .evaluate((el) => el.complete && el.naturalWidth > 0)
  check('离线图片可显示', imgOk)
  check('离线音频存在', (await offline.locator('[data-preview-voice] audio').count()) === 1)
  check('离线不请求外部资源', externalRequests.length === 0, externalRequests.slice(0, 3).join(' / '))
  check('离线无脚本异常', offlineErrors.length === 0, offlineErrors.slice(0, 2).join(' / '))
  await offline.screenshot({ path: path.join(EVIDENCE, 'character-preview-export.png') })
  await offline.close()

  // ---- 体积超限确认 ----
  const bigCard = page.locator('.char-card', { hasText: '大音色角色' })
  await bigCard.locator('[data-char-tab="preview"]').click()
  await bigCard.frameLocator('.char-preview-frame').locator('[data-preview-root]').waitFor({ timeout: 20000 })

  await page.evaluate(() => {
    window.__confirmCalls = 0
    window.confirm = () => {
      window.__confirmCalls += 1
      return false
    }
  })
  let cancelDownloaded = false
  const onCancelDownload = () => {
    cancelDownloaded = true
  }
  page.on('download', onCancelDownload)
  await bigCard.locator('[data-char-export]').click()
  await page.waitForTimeout(2500)
  page.off('download', onCancelDownload)
  check('超限时先弹体积确认', (await page.evaluate(() => window.__confirmCalls)) === 1)
  check('取消时不产生文件', cancelDownloaded === false)

  await page.evaluate(() => {
    window.confirm = () => true
  })
  const [bigDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 90000 }),
    bigCard.locator('[data-char-export]').click(),
  ])
  const bigPath = path.join(TMP, 'export-big.html')
  await bigDownload.saveAs(bigPath)
  check('确认后仍可导出', fs.statSync(bigPath).size > 5 * 1024 * 1024, String(fs.statSync(bigPath).size))

  // ---- 改锚点 → 转盘失效 → 重新生成 ----
  const oldFingerprint = orbitChar.orbit_sheet.fingerprint
  await card.locator('.char-head-acts').getByRole('button', { name: '编辑', exact: true }).click()
  await card.locator('[data-char-field="lookEn"]').fill(`${lookEn}, plus a scar over the left eyebrow`)
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await card.locator('[data-char-orbit-stale]').waitFor({ timeout: 20000 })
  check('改锚点后页签提示失效', (await card.locator('[data-char-orbit-stale]').count()) === 1)
  await card.frameLocator('.char-preview-frame').locator('[data-preview-stale="orbit"]').waitFor({ timeout: 20000 })
  check('预览内显示需重新生成', true)

  // 失败不覆盖旧转盘
  const beforeFail = project.characters.find((item) => item.name === '预览角色').orbit_sheet
  await page.route(
    '**/api/seedream',
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, message: 'mock 失败' }),
      }),
    { times: 1 },
  )
  await card.locator('[data-char-orbit-generate]').click()
  await page.waitForTimeout(1800)
  const afterFail = project.characters.find((item) => item.name === '预览角色').orbit_sheet
  check(
    '生成失败保留旧转盘',
    afterFail.fingerprint === beforeFail.fingerprint &&
      afterFail.cells.filter((cell) => cell.cropUrl).length === 8,
  )
  check('生成失败给出错误说明', (await card.locator('.gen-error').count()) >= 1)

  await card.locator('[data-char-orbit-generate]').click()
  let regenerated
  for (let i = 0; i < 120; i++) {
    const ch = project.characters.find((item) => item.name === '预览角色')
    const cells = ch?.orbit_sheet?.cells
    if (
      ch?.orbit_sheet?.fingerprint &&
      ch.orbit_sheet.fingerprint !== oldFingerprint &&
      cells?.length === 8 &&
      cells.every((cell) => cell.cropUrl)
    ) {
      regenerated = ch
      break
    }
    await page.waitForTimeout(200)
  }
  check('重新生成写入新指纹', Boolean(regenerated))
  await card.locator('[data-char-orbit-stale]').waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  check('重新生成后失效标记消失', (await card.locator('[data-char-orbit-stale]').count()) === 0)
  await card
    .frameLocator('.char-preview-frame')
    .locator('[data-preview-stale="orbit"]')
    .waitFor({ state: 'detached', timeout: 20000 })
    .catch(() => {})
  check(
    '预览内失效标记也消失',
    (await card.frameLocator('.char-preview-frame').locator('[data-preview-stale="orbit"]').count()) === 0,
  )

  // 空角色：没有图也不该炸，且不出现破损图位
  const empty = page.locator('.char-card', { hasText: '空角色' })
  await empty.locator('[data-char-tab="preview"]').click()
  await empty.frameLocator('.char-preview-frame').locator('[data-preview-root]').waitFor({ timeout: 15000 })
  const emptyBody = await empty.frameLocator('.char-preview-frame').locator('body').innerText()
  check('空角色预览显示降级说明', emptyBody.includes('还没有造型图'), emptyBody.slice(0, 80))
  check('空角色没有转盘', (await empty.frameLocator('.char-preview-frame').locator('[data-orbit]').count()) === 0)
  check('空角色没有播放器', (await empty.frameLocator('.char-preview-frame').locator('audio').count()) === 0)

  // ---- 降级链 ----
  const staticCard = page.locator('.char-card', { hasText: '静态角色' })
  await staticCard.locator('[data-char-tab="preview"]').click()
  const staticFrame = staticCard.frameLocator('.char-preview-frame')
  await staticFrame.locator('[data-preview-root]').waitFor({ timeout: 20000 })
  check('仅造型图时降级静态卡', (await staticFrame.locator('[data-orbit]').count()) === 0)
  check('静态卡显示造型图', (await staticFrame.locator('.stage.static img').count()) === 1)
  check('静态卡没有播放器', (await staticFrame.locator('audio').count()) === 0)

  const staleVoiceCard = page.locator('.char-card', { hasText: '失效试音角色' })
  await staleVoiceCard.locator('[data-char-tab="preview"]').click()
  const staleVoiceFrame = staleVoiceCard.frameLocator('.char-preview-frame')
  await staleVoiceFrame.locator('[data-preview-root]').waitFor({ timeout: 20000 })
  check('失效试音给出说明', (await staleVoiceFrame.locator('[data-preview-voice-stale]').count()) === 1)
  check('失效试音没有播放器', (await staleVoiceFrame.locator('audio').count()) === 0)
} finally {
  await browser.close()
  child.kill()
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
