/**
 * 场景三维预设户型冒烟测试。
 *
 * 分两层：
 *  1) 结构与资产层（纯函数，秒级）：每个预设都能构建、对象类型/计数稳定、
 *     所有 /cc0-props 引用都在本地 vendor 里、机位参数落在户型范围内。
 *     这一层不需要浏览器，改预设时最快的反馈。
 *  2) 真实渲染层（Playwright + Babylon）：点预设入口，等模型加载，
 *     断言场景里的网格数、机位数、以及「没有 404」——预设在 UI 里真的能落地。
 *
 * 第 1 层就是这几次改动里反复踩坑的地方（素材文件名带 -light、机位跑到墙外、
 * 隔断挡住镜头），所以断言写得比较细。
 *
 * 跑法：node verify-m3d-presets.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const ROOT = process.cwd()
const check = createCheck()

// ---------------------------------------------------------------- 第 1 层：结构与资产

const bundle = async (entry) => {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'error',
  })
  return await import(
    'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64')
  )
}

const presets = await bundle('src/material3d/material3dPresets.ts')

check('预设目录非空', presets.MATERIAL3D_PRESETS.length >= 2, String(presets.MATERIAL3D_PRESETS.length))

const seenIds = new Set()
for (const preset of presets.MATERIAL3D_PRESETS) {
  const tag = preset.id
  const scene = preset.build(new Date(0).toISOString())

  check(`[${tag}] id 唯一`, !seenIds.has(preset.id), preset.id)
  seenIds.add(preset.id)

  check(`[${tag}] 有标题与说明`, Boolean(preset.title?.trim()) && Boolean(preset.summary?.trim()))
  check(`[${tag}] 场景名与预设标题一致`, scene.name === preset.title, scene.name)

  // --- 对象构成 ---
  const archs = scene.objects.filter((o) => o.kind === 'arch')
  const gltfs = scene.objects.filter((o) => o.kind === 'gltf')
  check(`[${tag}] 对象数 ≥ 40`, scene.objects.length >= 40, String(scene.objects.length))
  check(`[${tag}] 有硬装面（墙/地/天花）`, archs.length >= 6, `arch=${archs.length}`)
  check(`[${tag}] 有家具/软装模型`, gltfs.length >= 20, `gltf=${gltfs.length}`)

  // 深色分配：每个 kind 都该出现
  const kinds = new Map()
  for (const a of archs) kinds.set(a.archKind, (kinds.get(a.archKind) || 0) + 1)
  for (const need of ['floor', 'wall', 'ceiling']) {
    check(`[${tag}] 含 ${need}`, (kinds.get(need) || 0) > 0, String(kinds.get(need) || 0))
  }

  // 天花必须默认不渲染，否则俯视机位看下去是一整块白板
  const ceilings = archs.filter((a) => a.archKind === 'ceiling')
  check(
    `[${tag}] 天花默认隐藏`,
    ceilings.length > 0 && ceilings.every((c) => c.visible === false),
    JSON.stringify(ceilings.map((c) => c.visible)),
  )

  // --- 尺寸合理性：任何硬装面不能是 0 或负 ---
  const badSize = archs.filter((a) => a.size.x <= 0 || a.size.y <= 0 || a.size.z <= 0)
  check(`[${tag}] 硬装面尺寸合法`, badSize.length === 0, JSON.stringify(badSize.slice(0, 2)))

  // --- 资产引用必须全部在本地 vendor 里（实测踩过 -light 后缀漏改） ---
  const missing = []
  for (const g of gltfs) {
    const rel = String(g.assetUrl).replace(/^\/cc0-props\//, '')
    const full = path.join(ROOT, 'vendor', 'cc0-props', rel)
    if (!fs.existsSync(full)) missing.push(rel)
  }
  check(`[${tag}] 模型文件全部存在`, missing.length === 0, missing.slice(0, 3).join(', '))

  // --- 机位：数量 + 落在户型范围内 ---
  check(`[${tag}] 机位 4~6 个`, scene.cameras.length >= 4 && scene.cameras.length <= 6, String(scene.cameras.length))

  const { width: W, depth: D } = preset.footprint
  const camOutside = []
  for (const c of scene.cameras) {
    // ArcRotateCamera: cam = target + r·(cos α·sin β, cos β, sin α·sin β)
    const x = c.target.x + c.radius * Math.cos(c.alpha) * Math.sin(c.beta)
    const y = c.target.y + c.radius * Math.cos(c.beta)
    const z = c.target.z + c.radius * Math.sin(c.alpha) * Math.sin(c.beta)
    // 俯视机位（beta < 0.6）本来就在房间上方的斜外侧，平面投影出界是正常的，
    // 只要求目标点落在户型内、高度为正；其余机位必须整机落在户型内。
    const topDown = c.beta < 0.6
    if (topDown) {
      const targetInPlan =
        c.target.x >= 0 && c.target.x <= W && c.target.z >= 0 && c.target.z <= D
      if (!targetInPlan || !(y > 0)) {
        camOutside.push(`${c.label}(target ${c.target.x},${c.target.z} y=${y.toFixed(1)})`)
      }
      continue
    }
    const inPlan = x >= -0.2 && x <= W + 0.2 && z >= -0.2 && z <= D + 0.2
    const saneHeight = y >= 0.4 && y <= 6
    if (!inPlan || !saneHeight) camOutside.push(`${c.label}(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`)
  }
  check(`[${tag}] 机位落在户型内`, camOutside.length === 0, camOutside.join(' / '))

  // --- 机位名称唯一，便于 UI 上点选 ---
  const camNames = scene.cameras.map((c) => c.label)
  check(`[${tag}] 机位名唯一`, new Set(camNames).size === camNames.length, camNames.join(','))

  // --- 环境：地面要关掉（预设自带地板，不然两层层叠起来） ---
  check(`[${tag}] 隐藏宿主地面`, scene.environment?.ground?.visible === false, String(scene.environment?.ground?.visible))

  // --- 家具不悬空：改用「台面/挂墙/吊顶」排除表，避免正则互相误伤。
  //     抱枕在沙发上、台灯在床头柜上、吸顶灯吊在天花上——它们有 y 是对的。 ---
  const ON_SURFACE_OR_WALL =
    /抱枕|台灯|多肉|挂画|装饰画|挂钟|白板|窗帘|全身镜|浴室镜|投影|公告板|毛巾架|绿植|龟背竹|虎尾兰|仙人掌|盆栽|花槽|吸顶灯|吊灯|区灯|间灯|室灯|咖啡机|微波炉|饮水机|烤面包机|电热水壶|桌面收纳/
  const floating = gltfs.filter(
    (g) => !ON_SURFACE_OR_WALL.test(g.label) && g.transform.position.y > 0.05,
  )
  check(
    `[${tag}] 大件家具均落地`,
    floating.length === 0,
    floating.map((f) => `${f.label}@y=${f.transform.position.y}`).slice(0, 3).join(', '),
  )
}

// 预设必须能通过 presetGltfAssets 枚举（UI 用它提示缺失）
for (const preset of presets.MATERIAL3D_PRESETS) {
  const assets = presets.presetGltfAssets(preset)
  check(`[${preset.id}] presetGltfAssets 可枚举`, assets.length > 0 && assets.every((a) => a.startsWith('/cc0-props/')), String(assets.length))
}

// ---------------------------------------------------------------- 第 2 层：真实渲染

const PORT = 5371
const PROJECTS = makeProjectsDir('m3d-presets-')
const PROJ = `m3d-preset-${Date.now()}`
seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '预设户型冒烟' })
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const assetFails = []
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/cc0-props/')) {
      assetFails.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')}`)
    }
  })

  await page.goto(`${app}/#/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((name) => {
    window.location.hash = `#/p/${encodeURIComponent(name)}/assets`
  }, PROJ)
  await page.locator('.rail').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(2000)

  await page.locator('[data-asset-studio3d-tab]').click()
  await page.waitForTimeout(2000)

  /**
   * 预设入口有两个形态：场景列表为空时是空状态大卡（data-m3d-preset-empty），
   * 已经有场景时是顶栏按钮（data-m3d-preset）。测试要同时覆盖。
   */
  const presetEntry = (id) => page.locator(`[data-m3d-preset="${id}"], [data-m3d-preset-empty="${id}"]`).first()

  const presetBtns = page.locator('[data-m3d-preset], [data-m3d-preset-empty]')
  check(
    'UI 列出全部预设',
    (await presetBtns.count()) >= presets.MATERIAL3D_PRESETS.length,
    String(await presetBtns.count()),
  )

  // 逐个点一遍：这是最容易坏的地方——素材 404、Babylon 同步失败、画布起不来
  for (const preset of presets.MATERIAL3D_PRESETS) {
    const btn = presetEntry(preset.id)
    if ((await btn.count()) === 0) {
      check(`[${preset.id}] 有入口`, false)
      continue
    }
    const beforeFails = assetFails.length
    await btn.click()
    // 等待模型加载：对象越多越慢，给足时间
    await page.waitForTimeout(preset.id.includes('office') ? 32000 : 28000)

    check(`[${preset.id}] 画布已挂载`, (await page.locator('canvas').count()) >= 1)

    const stats = await page.locator('.m3d-chip-stat').allInnerTexts()
    const objCount = Number((stats.find((s) => s.includes('对象')) || '').replace(/[^\d]/g, ''))
    const camCount = Number((stats.find((s) => s.includes('机位')) || '').replace(/[^\d]/g, ''))
    const expected = preset.build(new Date(0).toISOString())
    check(`[${preset.id}] 对象数等于预设`, objCount === expected.objects.length, `${objCount} vs ${expected.objects.length}`)
    check(`[${preset.id}] 机位数等于预设`, camCount === expected.cameras.length, `${camCount} vs ${expected.cameras.length}`)
    check(`[${preset.id}] 无素材 404`, assetFails.length === beforeFails, assetFails.slice(beforeFails, beforeFails + 2).join(' / '))

    // 回列表准备下一个。第一次套用后页面已经进了场景视图，
    // 必须点左上角「← 场景列表」退回去，否则下一个预设按钮不存在。
    const back = page.locator('.m3d-back')
    if ((await back.count()) > 0) {
      await back.first().click()
      // 列表非空时预设入口在顶栏，等它出现
      await page
        .locator('[data-m3d-preset], [data-m3d-preset-empty]')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 })
        .catch(() => {})
      await page.waitForTimeout(800)
    }
  }

  // 已知的既有噪声：调试分页的 inspector 在无宿主时读 scene.getEngine()。
  // 只要没有其它异常就算过，避免把历史问题算在这次头上。
  const realErrors = pageErrors.filter((m) => !/getEngine/.test(m))
  check('无其它页面异常', realErrors.length === 0, realErrors.slice(0, 2).join(' / '))
} finally {
  await browser.close()
  stop()
}

console.log(check.bad() ? `\n❌ ${check.bad()} 项失败` : '\n✅ 全部通过')
process.exit(check.bad() ? 1 : 0)
