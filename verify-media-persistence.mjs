/**
 * 项目媒体持久化集成验证（临时库 + mock 生图，不花真实额度）：
 * 1) 角色三视图 / 设定图生成后写入 projects/<项目>/assets，URL 可访问
 * 2) 生成后立刻刷新仍在（不依赖 1.2s 防抖）
 * 3) 上传图片落盘项目目录，刷新仍在
 * 4) 旧 /generated 引用幂等迁移；缺失引用只标记不改写
 * 5) 缺失角色图不参与出图；设定图缺失禁止发布
 * 6) /project-assets 路径穿越被拒绝
 * 跑法：node verify-media-persistence.mjs
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5305
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'media-persist-'))
const LEGACY_FILE = `media-legacy-${process.pid}.png`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}
const api = (p, init) =>
  fetch(`${APP}${p}`, init).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    return { status: r.status, ...j }
  })
const postProject = (name, body) =>
  api(`/api/project?name=${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const getProject = (name) => api(`/api/project?name=${name}`).then((r) => r.project)

// mock 生图：b64 返回，服务端走下载/落盘分支
const mock = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/plan/v3/images/generations') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }))
    return
  }
  res.statusCode = 404
  res.end('not found')
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const mockOrigin = `http://127.0.0.1:${mock.address().port}`

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)
let browser = null
let page = null
const cleanup = async () => {
  try {
    await browser?.close()
  } catch {
    /* ignore */
  }
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  try {
    mock.close()
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(path.join(ROOT, 'public', 'generated', LEGACY_FILE), { force: true })
}
process.on('exit', () => {
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(path.join(ROOT, 'public', 'generated', LEGACY_FILE), { force: true })
})

const waitServer = async () => {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 120))
  }
  return false
}

try {
  if (!(await waitServer())) throw new Error(`dev server 未启动（${PORT}）`)
  const projectAssets = (name) => path.join(TMP, name, 'assets')

  // ---- 0. 临时项目 + mock 渠道 ----
  await api(`/api/project?name=ui&create=1`, { method: 'POST', body: '{}' })
  await postProject('ui', {
    characters: [
      { name: '甲', role: '主角', look_cn: '', look_en: 'a test man in a grey coat', palette: '', keywords: [] },
    ],
    designs: [
      {
        id: 'd1',
        kind: 'scene',
        name: '测试巷子',
        refs: [],
        summaryCn: '一条巷子',
        promptEn: 'a narrow alley at night',
        keywords: [],
      },
    ],
  })
  fs.mkdirSync(projectAssets('ui'), { recursive: true })
  fs.writeFileSync(path.join(projectAssets('ui'), 'preview.png'), PNG)
  fs.writeFileSync(path.join(TMP, 'upload.png'), PNG)

  const settings = (await api('/api/settings')).settings
  const providers = settings.providers.map((p) =>
    p.id === 'ark-plan' ? { ...p, baseUrl: `${mockOrigin}/api/plan/v3`, apiKey: 'test-plan-key' } : p,
  )
  const savedSettings = await api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers }),
  })
  check('mock 渠道设置已保存', savedSettings.ok === true)

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1600)
  const selectProject = async (name) => {
    const sel = page.locator('select').first()
    const opts = await sel.locator('option').allTextContents()
    const idx = opts.findIndex((t) => t.trim().startsWith(name))
    if (idx >= 0) await sel.selectOption({ index: idx })
    await page.waitForTimeout(1200)
  }
  await selectProject('ui')

  // ---- 1. 角色生成：项目目录 + 立刻刷新 ----
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(400)
  const card = page.locator('.char-card').filter({ hasText: '甲' }).first()
  // 角色卡上空态 CTA 和底部主按钮同名，点主按钮避免 strict mode 冲突
  await card.locator('.char-primary button', { hasText: '生成三视图' }).first().click()
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.char-card .char-sheet img')
      return img && img.getAttribute('src')?.startsWith('/project-assets/ui/char-')
    },
    null,
    { timeout: 12000 },
  )
  const genSrc = await card.locator('.char-sheet img').getAttribute('src')
  const genFile = path.join(projectAssets('ui'), genSrc.split('/').pop())
  check('角色图写入项目目录', fs.existsSync(genFile), genSrc)
  check('角色图 URL 可访问', (await fetch(`${APP}${genSrc}`)).status === 200)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(500)
  const imgAfterGen = page.locator('.char-card').filter({ hasText: '甲' }).first().locator('.char-sheet img')
  const dims = (await imgAfterGen.count())
    ? await imgAfterGen.evaluate((el) => ({ w: el.naturalWidth, src: el.getAttribute('src') }))
    : { w: 0, src: '' }
  check('生成后立刻刷新仍在', dims.w > 0 && dims.src === genSrc, JSON.stringify(dims))

  // ---- 2. 上传：落盘 + 立刻刷新 ----
  const card2 = page.locator('.char-card').filter({ hasText: '甲' }).first()
  await card2.locator('input[type=file]').setInputFiles(path.join(TMP, 'upload.png'))
  await page.waitForFunction(
    (prev) => {
      const img = document.querySelector('.char-card .char-sheet img')
      const src = img?.getAttribute('src') || ''
      return src.startsWith('/project-assets/ui/char-') && src !== prev
    },
    genSrc,
    { timeout: 12000 },
  )
  const uploadSrc = await card2.locator('.char-sheet img').getAttribute('src')
  const uploadFile = path.join(projectAssets('ui'), uploadSrc.split('/').pop())
  check('上传图写入项目目录', fs.existsSync(uploadFile), uploadSrc)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '角色', exact: true }).click()
  await page.waitForTimeout(500)
  const uploadSrc2 = await page
    .locator('.char-card')
    .filter({ hasText: '甲' })
    .first()
    .locator('.char-sheet img')
    .getAttribute('src')
  check('上传后立刻刷新仍在', uploadSrc2 === uploadSrc, String(uploadSrc2))

  // ---- 3. 设定图：项目目录 + 立刻刷新 ----
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(700)
  const design = page.locator('.char-card').filter({ hasText: '测试巷子' }).first()
  await design.locator('button', { hasText: '生成设定图' }).click()
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.char-card img')
      return img && img.getAttribute('src')?.startsWith('/project-assets/ui/design-')
    },
    null,
    { timeout: 12000 },
  )
  const designSrc = await design.locator('img').getAttribute('src')
  check('设定图写入项目目录', fs.existsSync(path.join(projectAssets('ui'), designSrc.split('/').pop())), designSrc)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.waitForTimeout(700)
  const designSrc2 = await page
    .locator('.char-card')
    .filter({ hasText: '测试巷子' })
    .first()
    .locator('img')
    .getAttribute('src')
  check('设定图立刻刷新仍在', designSrc2 === designSrc, String(designSrc2))

  // ---- 4. 旧图迁移幂等 + 缺失标记 ----
  fs.writeFileSync(path.join(ROOT, 'public', 'generated', LEGACY_FILE), PNG)
  await api(`/api/project?name=legacy&create=1`, { method: 'POST', body: '{}' })
  await postProject('legacy', {
    characters: [
      {
        name: '旧角色',
        role: '',
        look_cn: '',
        look_en: 'legacy',
        palette: '',
        keywords: [],
        image: `/generated/${LEGACY_FILE}`,
        candidates: [`/generated/${LEGACY_FILE}`, '/generated/nope-media.png'],
      },
    ],
    designs: [],
  })
  const legacy1 = await getProject('legacy')
  const legacyImage = legacy1.characters[0].image
  check('旧引用改写成项目 URL', legacyImage === `/project-assets/legacy/${LEGACY_FILE}`, String(legacyImage))
  check('旧文件复制进项目目录', fs.existsSync(path.join(projectAssets('legacy'), LEGACY_FILE)))
  check('首次迁移计数正确', legacy1.media?.migrated === 1, JSON.stringify(legacy1.media))
  check('缺失引用被标记', (legacy1.media?.missing ?? []).includes('/generated/nope-media.png'), JSON.stringify(legacy1.media))
  const count1 = fs.readdirSync(projectAssets('legacy')).length
  const legacy2 = await getProject('legacy')
  const count2 = fs.readdirSync(projectAssets('legacy')).length
  check('重复打开不再迁移/复制', legacy2.media?.migrated === 0 && count1 === count2, JSON.stringify(legacy2.media))

  await postProject('legacy', {
    characters: [{ name: '旧角色', image: '/project-assets/legacy/nope.png' }],
    designs: [],
  })
  const legacy3 = await getProject('legacy')
  check('项目媒体缺失也被标记', (legacy3.media?.missing ?? []).includes('/project-assets/legacy/nope.png'), JSON.stringify(legacy3.media))

  // ---- 5. 缺失图不参与出图 + 设定图缺失禁止发布 ----
  await api(`/api/project?name=guard&create=1`, { method: 'POST', body: '{}' })
  await postProject('guard', {
    characters: [
      { name: '乙', role: '', look_cn: '', look_en: 'a woman', palette: '', keywords: [], image: '/project-assets/guard/gone.png' },
    ],
    designs: [],
    shots: [
      {
        id: 'E01-S01',
        episode: 1,
        no: 'S01',
        seconds: 3,
        size: '中景',
        move: '固定',
        keyframe_prompt: 'a test shot',
        dialogue: [],
        cast: ['乙'],
        refIds: ['char-乙'],
      },
    ],
  })
  const guardPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await guardPage.addInitScript(() => localStorage.setItem('storyboard-chars-on', '1'))
  let genCalls = 0
  await guardPage.route('**/api/seedream', async (route) => {
    genCalls++
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, urls: ['/project-assets/guard/x.png'], url: '/project-assets/guard/x.png' }),
    })
  })
  await guardPage.goto(APP, { waitUntil: 'networkidle' })
  await guardPage.waitForTimeout(1600)
  const sel = guardPage.locator('select').first()
  const opts = await sel.locator('option').allTextContents()
  await sel.selectOption({ index: opts.findIndex((t) => t.trim().startsWith('guard')) })
  await guardPage.waitForTimeout(1600)
  const nodeB = guardPage.locator('.char-node').filter({ hasText: '乙' }).first()
  check('画布角色节点回退名字占位', (await nodeB.locator('img').count()) === 0 && (await nodeB.locator('.char-placeholder').innerText()) === '乙')
  const shot = guardPage.locator('.react-flow__node').filter({ hasText: 'S01' }).first()
  await shot.locator('.shot-gen').click()
  await guardPage.waitForTimeout(600)
  check('缺失图不发出生图请求', genCalls === 0, String(genCalls))
  const badge = shot.locator('.gen-error-badge')
  check(
    '缺失图给出明确错误',
    (await badge.count()) === 1 && (await badge.getAttribute('title'))?.includes('三视图文件缺失'),
    String(await badge.getAttribute('title')),
  )

  // ---- 6. 路径穿越 ----
  const traverse = await fetch(`${APP}/project-assets/ui/..%2F..%2Fpackage.json`)
  const fakeName = await fetch(`${APP}/project-assets/bad%24name/x.png`)
  check('路径穿越被拒绝', traverse.status === 400, String(traverse.status))
  check('非法项目名被拒绝', fakeName.status === 400, String(fakeName.status))

  check('无 pageerror', errors.length === 0, errors[0] ?? '')
} catch (e) {
  console.error('❌ 验证中断：', e?.stack || e?.message || String(e))
  bad++
} finally {
  await cleanup()
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
