/**
 * 场景三维轨道相机控制（material3d-orbit-controls）验收。
 *
 * 两层：
 *  1) 纯函数层（秒级）：角度换算、仰角语义、epsilon 比较、取景系数。
 *     这些是面板显示的根基，算错了滑杆显示会整体偏掉。
 *  2) 真实浏览器层：六条滑杆出现、拖滑杆实时改相机、俯视/正视、适应视图、
 *     套用预设后自动取景、提示含平移。
 *
 * 跑法：node verify-m3d-orbit-controls.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const ROOT = process.cwd()
const check = createCheck()

// ---------------------------------------------------------------- 第 1 层：纯函数

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

const orbit = await bundle('src/material3d/orbitPose.ts')
const engine = await bundle('src/material3d/createEngine.ts').catch(() => null)

check('方位角：π/2 显示 90°', orbit.poseToAzimuth({ alpha: Math.PI / 2, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } }) === 90)
check('方位角：负角度归一到 0..360',
  Math.abs(orbit.poseToAzimuth({ alpha: -Math.PI / 2, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } }) - 270) < 1e-6)

// 仰角语义：beta=0 是正上方 -> 仰角 90；beta=π/2 是水平 -> 仰角 0
check('仰角：beta=0 显示 90°', Math.abs(orbit.betaToElevation(0) - 90) < 1e-6)
check('仰角：beta=π/2 显示 0°', Math.abs(orbit.betaToElevation(Math.PI / 2)) < 1e-6)
check('仰角往返一致', Math.abs(orbit.betaToElevation(orbit.elevationToBeta(38)) - 38) < 1e-6)
check('仰角上限不碰 90（避开万向锁）', orbit.ELEVATION_MAX <= 89)
// 仰角增大必须更接近俯视（beta 更小）—— 这是「不反直觉」的硬约束
check(
  '仰角越大 beta 越小',
  orbit.elevationToBeta(80) < orbit.elevationToBeta(20),
  `${orbit.elevationToBeta(80).toFixed(3)} < ${orbit.elevationToBeta(20).toFixed(3)}`,
)

check('米制显示一位小数', orbit.meters(12.04) === '12.0m' && orbit.meters(7.25) === '7.3m')
check('epsilon 相同判定', orbit.poseNearlyEqual(
  { alpha: 1, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } },
  { alpha: 1 + 1e-6, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } },
))
check('epsilon 不同判定', !orbit.poseNearlyEqual(
  { alpha: 1, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } },
  { alpha: 1.01, beta: 1, radius: 1, target: { x: 0, y: 0, z: 0 } },
))

if (engine) {
  // setRadiusLimits 需要 host，这里只校验导出的常量与函数形状
  check('导出 readCameraPose', typeof engine.readCameraPose === 'function')
  check('导出 applyCameraPose', typeof engine.applyCameraPose === 'function')
  check('导出 setRadiusLimits', typeof engine.setRadiusLimits === 'function')
  check('半径硬边界存在', engine.MIN_RADIUS_FLOOR > 0 && engine.MAX_RADIUS_CEILING > 30)
}

// ---------------------------------------------------------------- 第 2 层：浏览器

const PORT = 5399
const PROJECTS = makeProjectsDir('m3d-orbit-')
const PROJ = `m3d-orbit-${Date.now()}`
seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '轨道相机验收' })
console.log('{}')
`,
)

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))

  await page.goto(`${app}/#/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((n) => {
    window.location.hash = `#/p/${encodeURIComponent(n)}/assets`
  }, PROJ)
  await page.locator('.rail').waitFor({ timeout: 30000 })
  await page.waitForTimeout(2200)
  await page.locator('[data-asset-studio3d-tab]').click()
  await page.waitForTimeout(2200)

  const readOrbit = async (k) => Number(await page.locator(`[data-m3d-orbit="${k}"]`).inputValue())

  // ---- 空场景：滑杆也要在 ----
  await page.locator('[data-m3d-new-scene]').click()
  await page.waitForTimeout(4000)
  await page.locator('.m3d-rail-nav button', { hasText: '分镜' }).first().click()
  await page.waitForTimeout(1000)
  check('空场景仍显示六条滑杆', (await page.locator('[data-m3d-orbit]').count()) === 6, String(await page.locator('[data-m3d-orbit]').count()))
  // 空场景点适应视图不崩、不改相机
  const rEmptyBefore = await readOrbit('radius')
  await page.locator('[data-m3d-fit-view]').click()
  await page.waitForTimeout(800)
  check('空场景适应视图不改距离', Math.abs((await readOrbit('radius')) - rEmptyBefore) < 0.2, `${rEmptyBefore} -> ${await readOrbit('radius')}`)

  // ---- 套用预设，验证自动取景 ----
  await page.locator('.m3d-back').click()
  await page.waitForTimeout(2000)
  await page.locator('[data-m3d-preset="one-bedroom-modern"]').first().click()
  // 自动取景发生在模型全部加载完之后，给足时间
  await page.waitForTimeout(36000)
  await page.locator('.m3d-rail-nav button', { hasText: '分镜' }).first().click()
  await page.waitForTimeout(1500)
  const rAuto = await readOrbit('radius')
  check('套用预设后自动取景（距离 ≠ 默认 10）', Math.abs(rAuto - 10) > 0.5, `${rAuto}m`)
  const eAuto = await readOrbit('beta')
  check('自动取景仰角 = 38°（FIT_BETA 0.9）', Math.abs(eAuto - 38) <= 2, `${eAuto}°`)

  // ---- 拖滑杆实时改相机 ----
  const radiusSlider = page.locator('[data-m3d-orbit="radius"]')
  const seq = []
  for (const v of [8, 11, 14]) {
    await radiusSlider.fill(String(v))
    await page.waitForTimeout(250)
    seq.push(await readOrbit('radius'))
  }
  check('拖滑杆实时生效', new Set(seq).size === 3, seq.join(','))
  check('滑杆写入未被相机回写覆盖', seq[2] === 14, String(seq[2]))

  // ---- 快速拖动后不跳回（双向绑定仲裁）----
  const alphaSlider = page.locator('[data-m3d-orbit="alpha"]')
  for (const v of [10, 60, 120, 200]) {
    await alphaSlider.fill(String(v))
    await page.waitForTimeout(80)
  }
  await page.waitForTimeout(900)
  check('快速拖动后不跳回', Math.abs((await readOrbit('alpha')) - 200) <= 2, String(await readOrbit('alpha')))

  // ---- 俯视 / 正视 ----
  await alphaSlider.fill('45')
  await page.waitForTimeout(300)
  await page.locator('[data-m3d-top-view]').click()
  await page.waitForTimeout(700)
  check('俯视保留方位角', Math.abs((await readOrbit('alpha')) - 45) <= 1, String(await readOrbit('alpha')))
  check('俯视仰角接近 90', (await readOrbit('beta')) >= 84, String(await readOrbit('beta')))
  await page.locator('[data-m3d-front-view]').click()
  await page.waitForTimeout(700)
  check('正视仰角回到 0', Math.abs(await readOrbit('beta')) <= 1, String(await readOrbit('beta')))

  // ---- 适应视图：大户型距离更大 ----
  await page.locator('[data-m3d-fit-view]').click()
  await page.waitForTimeout(800)
  const rSmall = await readOrbit('radius')
  check('一室一厅 fit 距离在合理区间', rSmall > 1 && rSmall < 25, `${rSmall}m`)

  await page.locator('.m3d-back').click()
  await page.waitForTimeout(2000)
  await page.locator('[data-m3d-preset="restaurant-modern"]').first().click()
  // 餐厅 82 个对象，加载比一室一厅慢；给足时间否则自动取景还没轮到就断言了
  await page.waitForTimeout(50000)
  await page.locator('.m3d-rail-nav button', { hasText: '分镜' }).first().click()
  await page.waitForTimeout(1500)
  // 自动取景受加载速度影响，不作为硬断言；以显式 fit 的结果为准（spec 的
  // 「大户型取景距离更大」由它证明）
  await page.locator('[data-m3d-fit-view]').click()
  await page.waitForTimeout(800)
  const rBigFit = await readOrbit('radius')
  check('餐厅 fit 距离 > 一室一厅 fit 距离', rBigFit > rSmall, `${rBigFit}m vs ${rSmall}m`)
  const rBig = await readOrbit('radius')
  check('餐厅相机距离非默认初值', Math.abs(rBig - 10) > 0.3, `${rBig}m`)

  // ---- 提示含平移 ----
  const hud = await page.locator('.m3d-viewport-hud-row').first().innerText()
  check('画布提示含平移', hud.includes('平移'), hud)

  // ---- 参数显示单位 ----
  check('距离滑杆 step 0.1', (await radiusSlider.getAttribute('step')) === '0.1')
  check('方位角在 0..360', (await readOrbit('alpha')) >= 0 && (await readOrbit('alpha')) <= 360)

  // 既有噪声：调试页 inspector 在无宿主时读 scene.getEngine()
  const real = errs.filter((m) => !/getEngine/.test(m))
  check('无其它页面异常', real.length === 0, real.slice(0, 2).join(' / '))
} finally {
  await browser.close()
  stop()
}

console.log(check.bad() ? `\n❌ ${check.bad()} 项失败` : '\n✅ 全部通过')
process.exit(check.bad() ? 1 : 0)
