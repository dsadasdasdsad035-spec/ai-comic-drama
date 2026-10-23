/**
 * 日间/夜间主题验证（自起临时 dev server，不调用真实模型）：
 * 1) 系统偏好 / 手动选择 / 持久化 / 启动前主题
 * 2) 日间对比度、颜色 token、React Flow / 空白卡 / 原生控件
 * 3) 切换不位移、图片不改色、390px 标签、项目数据不变、减少动效
 * 跑法：node verify-theme.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5303
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-test-'))
const SVG = path.join(ROOT, 'public', 'generated', 'theme-test.svg')

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

const shot = (no, extra = {}) => ({
  id: `E01-${no}`,
  episode: 1,
  no,
  seconds: 3,
  size: '中景',
  move: '固定',
  desc: `${no} 画面`,
  keyframe_prompt: `${no} 画面，冷青低照度`,
  dialogue: [],
  cast: [],
  ...extra,
})

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const waitFor = async (fn, ms = 5000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

const contrast = (a, b) => {
  const lum = (hex) => {
    const c = String(hex).replace('#', '')
    const rgb = [0, 2, 4]
      .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  }
  const l1 = lum(a)
  const l2 = lum(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

let browser
try {
  if (!(await waitServer())) throw new Error('临时 dev server 启动失败')

  fs.mkdirSync(path.dirname(SVG), { recursive: true })
  fs.writeFileSync(
    SVG,
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#17324a"/><circle cx="160" cy="90" r="34" fill="#dff6ff" opacity=".7"/></svg>',
  )

  await api('/api/project?name=theme-test&create=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '主题验证' }),
  })
  await api('/api/project?name=theme-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: '主题验证项目',
      shots: [
        shot('S01', { keyframe: '/generated/theme-test.svg' }),
        shot('S02'),
      ],
    }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })

  // ---- 系统偏好 ----
  const lightCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
  })
  const lightPage = await lightCtx.newPage()
  await lightPage.goto(APP, { waitUntil: 'networkidle' })
  await lightPage.waitForTimeout(1200)
  check('系统浅色首次打开为日间', (await lightPage.evaluate(() => document.documentElement.dataset.theme)) === 'day')
  check(
    '没有手动选择时不写本地偏好',
    (await lightPage.evaluate(() => localStorage.getItem('storyboard-theme'))) === null,
  )

  const darkCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
  })
  const darkPage = await darkCtx.newPage()
  await darkPage.goto(APP, { waitUntil: 'networkidle' })
  await darkPage.waitForTimeout(1200)
  check('系统深色首次打开为夜间', (await darkPage.evaluate(() => document.documentElement.dataset.theme)) === 'night')
  await darkCtx.close()

  // ---- 日间 token 与切换 ----
  const dayState = await lightPage.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const v = (n) => cs.getPropertyValue(n).trim()
    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: cs.colorScheme,
      text: v('--text'),
      bg: v('--bg'),
      text2: v('--text-2'),
      muted: v('--muted'),
      panel: v('--panel'),
      accent: v('--accent'),
      accentInk: v('--accent-ink'),
      canvasDot: v('--canvas-dot'),
      konvaBlank: v('--konva-blank'),
    }
  })
  check('日间 color-scheme 为 light', dayState.colorScheme === 'light', dayState.colorScheme)
  check('日间强调色不是夜间亮青', dayState.accent.toLowerCase() !== '#38bdf8', dayState.accent)
  check('日间正文对比度 >= 4.5', contrast(dayState.text, dayState.bg) >= 4.5, String(contrast(dayState.text, dayState.bg)))
  check('日间次文字对比度 >= 4.5', contrast(dayState.text2, dayState.bg) >= 4.5, String(contrast(dayState.text2, dayState.bg)))
  check('日间 muted 对比度 >= 4.5', contrast(dayState.muted, dayState.panel) >= 4.5, String(contrast(dayState.muted, dayState.panel)))
  check('日间强调色对比度 >= 4.5', contrast(dayState.accent, dayState.panel) >= 4.5, String(contrast(dayState.accent, dayState.panel)))
  check('日间按钮文字对比度 >= 4.5', contrast(dayState.accentInk, dayState.accent) >= 4.5, String(contrast(dayState.accentInk, dayState.accent)))

  const toggle = lightPage.locator('.theme-toggle')
  check('顶栏主题开关存在', (await toggle.count()) === 1)
  check('主题开关有可见日间/夜间标签', /日间/.test(await toggle.innerText()) && /夜间/.test(await toggle.innerText()))
  check(
    '当前日间按钮 aria-pressed',
    (await lightPage.locator('[data-theme-mode="day"]').getAttribute('aria-pressed')) === 'true',
  )

  await lightPage.locator('[data-theme-mode="night"]').click()
  await lightPage.waitForTimeout(250)
  check('点击夜间后 root 为 night', (await lightPage.evaluate(() => document.documentElement.dataset.theme)) === 'night')
  check(
    '点击夜间后 aria-pressed 同步',
    (await lightPage.locator('[data-theme-mode="night"]').getAttribute('aria-pressed')) === 'true',
  )
  check(
    '手动选择写入 localStorage',
    (await lightPage.evaluate(() => localStorage.getItem('storyboard-theme'))) === 'night',
  )
  check('夜间 color-scheme 为 dark', (await lightPage.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) === 'dark')

  // 键盘切换：当前 night，聚焦日间按 Enter
  await lightPage.locator('[data-theme-mode="day"]').focus()
  await lightPage.keyboard.press('Enter')
  await lightPage.waitForTimeout(200)
  check('键盘 Enter 切回日间', (await lightPage.evaluate(() => document.documentElement.dataset.theme)) === 'day')

  // ---- 启动前主题 + 持久化（系统深色 + 存储日间） ----
  const flashCtx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
  })
  const flashPage = await flashCtx.newPage()
  await flashPage.addInitScript(() => {
    try {
      localStorage.setItem('storyboard-theme', 'day')
    } catch {
      /* ignore */
    }
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        window.__themeAtDom = document.documentElement.dataset.theme
      },
      { once: true },
    )
  })
  await flashPage.goto(APP, { waitUntil: 'networkidle' })
  await flashPage.waitForTimeout(900)
  check('保存主题优先于系统深色', (await flashPage.evaluate(() => document.documentElement.dataset.theme)) === 'day')
  check('DOMContentLoaded 时已是日间', (await flashPage.evaluate(() => window.__themeAtDom)) === 'day')
  await flashPage.reload({ waitUntil: 'networkidle' })
  await flashPage.waitForTimeout(700)
  check('刷新后保持日间', (await flashPage.evaluate(() => document.documentElement.dataset.theme)) === 'day')
  await flashCtx.close()

  // ---- 画布 / 空白卡 / 原生控件 / 图片 ----
  await lightPage.getByRole('button', { name: '画布', exact: true }).click()
  await lightPage.waitForTimeout(800)
  const canvasState = await lightPage.evaluate(() => {
    const minimap = document.querySelector('.react-flow__minimap')
    const background = document.querySelector('.react-flow__background')
    return {
      minimapBg: minimap ? getComputedStyle(minimap).backgroundColor : null,
      backgroundColor: background
        ? (background.style.getPropertyValue('--xy-background-pattern-color-props') ||
            getComputedStyle(background).getPropertyValue('--xy-background-pattern-color-props')).trim()
        : null,
      canvasDot: getComputedStyle(document.documentElement).getPropertyValue('--canvas-dot').trim(),
      konvaBlank: getComputedStyle(document.documentElement).getPropertyValue('--konva-blank').trim(),
      shotBlank: document.querySelector('.shot-blank') ? getComputedStyle(document.querySelector('.shot-blank')).backgroundImage : null,
      filter: document.querySelector('.shot-still') ? getComputedStyle(document.querySelector('.shot-still')).filter : null,
    }
  })
  check('日间 MiniMap 使用浅色背景', canvasState.minimapBg === 'rgb(255, 253, 248)', String(canvasState.minimapBg))
  check('日间背景点色正确', canvasState.backgroundColor === '#cfc6b8', String(canvasState.backgroundColor))
  check('日间画布点 token 正确', canvasState.canvasDot === '#cfc6b8', String(canvasState.canvasDot))
  check('日间 Konva 空画布 token 为浅色', canvasState.konvaBlank === '#e4ddd1', String(canvasState.konvaBlank))
  check('日间空白卡使用浅色底', Boolean(canvasState.shotBlank) && !/11, 18, 32/.test(canvasState.shotBlank), String(canvasState.shotBlank))
  check('图片不被主题滤镜改色', canvasState.filter === 'none', String(canvasState.filter))

  // 选中第一镜，验证 Inspector 也在主题内
  const node = lightPage.locator('.react-flow__node').first()
  await node.dispatchEvent('contextmenu', { clientX: 640, clientY: 420, button: 2 })
  await lightPage.waitForTimeout(250)
  await lightPage.locator('.ctx-menu button', { hasText: '关闭' }).click()
  await lightPage.waitForTimeout(300)
  check('Inspector 已打开', (await lightPage.locator('.inspector').count()) === 1)
  const inspectorBg = await lightPage.locator('.inspector').evaluate((el) => getComputedStyle(el).backgroundColor)
  check('Inspector 使用日间面板色', inspectorBg === 'rgb(255, 253, 248)', inspectorBg)

  // 布局不位移
  const before = await lightPage.evaluate(() =>
    ['.topbar', '.canvas', '.shot', '.inspector', '.ntl'].map((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { sel, x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
  await lightPage.locator('[data-theme-mode="night"]').click()
  await lightPage.waitForTimeout(250)
  const after = await lightPage.evaluate(() =>
    ['.topbar', '.canvas', '.shot', '.inspector', '.ntl'].map((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { sel, x: r.x, y: r.y, w: r.width, h: r.height }
    }),
  )
  check('切换主题不改变布局矩形', JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }))
  await lightPage.locator('[data-theme-mode="day"]').click()
  await lightPage.waitForTimeout(200)

  // 项目内容不被主题写入
  const projectBefore = await api('/api/project?name=theme-test')
  await lightPage.waitForTimeout(700)
  const projectAfter = await api('/api/project?name=theme-test')
  check(
    '切换主题不修改项目内容',
    JSON.stringify(projectBefore.project?.shots) === JSON.stringify(projectAfter.project?.shots) &&
      JSON.stringify(projectBefore.project?.designs) === JSON.stringify(projectAfter.project?.designs) &&
      JSON.stringify(projectBefore.project?.assets) === JSON.stringify(projectAfter.project?.assets),
  )

  // ---- 390px：标签不消失、无横向溢出 ----
  await lightPage.setViewportSize({ width: 390, height: 900 })
  await lightPage.waitForTimeout(300)
  const mobile = await lightPage.evaluate(() => {
    const t = document.querySelector('.theme-toggle')
    const day = document.querySelector('[data-theme-mode="day"]')
    const night = document.querySelector('[data-theme-mode="night"]')
    const r = t?.getBoundingClientRect()
    return {
      text: t?.innerText || '',
      dayVisible: Boolean(day && day.getBoundingClientRect().width > 0),
      nightVisible: Boolean(night && night.getBoundingClientRect().width > 0),
      right: r?.right ?? 0,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }
  })
  check('390px 主题标签仍可读', /日间/.test(mobile.text) && /夜间/.test(mobile.text), mobile.text)
  check('390px 两个主题按钮都可见', mobile.dayVisible && mobile.nightVisible)
  check('390px 无横向溢出', mobile.sw <= mobile.cw, JSON.stringify(mobile))
  check('390px 开关不超出视口', mobile.right <= 390, String(mobile.right))
  await lightPage.setViewportSize({ width: 1280, height: 900 })

  // ---- 减少动效 ----
  await lightPage.emulateMedia({ reducedMotion: 'reduce' })
  await lightPage.waitForTimeout(100)
  const reduced = await lightPage.locator('.topbar').evaluate((el) => getComputedStyle(el).transitionDuration)
  const durations = reduced.split(',').map((v) => parseFloat(v))
  check('减少动效时过渡接近 0', durations.length > 0 && durations.every((v) => v <= 0.001), reduced)

  await lightCtx.close()
} catch (e) {
  check('集成测试执行', false, (e && e.message) || String(e))
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(SVG, { force: true })
}

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`)
process.exit(bad === 0 ? 0 : 1)
