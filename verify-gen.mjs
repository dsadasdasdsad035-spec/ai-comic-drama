import { chromium } from 'playwright-core'

const EXEC =
  '/Users/mjy/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

const browser = await chromium.launch({ executablePath: EXEC })
const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1.5 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://127.0.0.1:5273/', { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(900)

// ---- 1. 单镜生成（S01） ----
const t0 = Date.now()
await page.locator('.shot-gen').first().click()
await page.waitForSelector('.gen-overlay', { timeout: 8000 })
await page.screenshot({ path: '/tmp/gen-running.png' })
await page.waitForSelector('.gen-overlay', { state: 'detached', timeout: 150000 })
const genMs = Date.now() - t0

await page.waitForTimeout(700)
const refAfter = await page.evaluate(() => {
  const raw = localStorage.getItem('storyboard-canvas-v1')
  return raw ? JSON.parse(raw).nodes[0].data.refImage : null
})

// ---- 2. 错误态：清空提示词后生成 ----
await page.locator('.shot').nth(1).click()
await page.waitForTimeout(300)
await page.locator('.field textarea').nth(1).fill('')
await page.locator('.gen-box button').click()
await page.waitForTimeout(600)
const genError = await page.locator('.gen-error').textContent().catch(() => null)
await page.screenshot({ path: '/tmp/gen-error.png' })

// ---- 3. 恢复正常 + 整体截图 ----
await page.locator('.field textarea').nth(1).fill('回收人推着满载义体的推车穿过夜市，霓虹灯牌反光，低机位跟拍')
await page.mouse.click(900, 700)
await page.waitForTimeout(500)
await page.screenshot({ path: '/tmp/gen-final.png' })

console.log(JSON.stringify({ genMs, refAfter, genError, errors }, null, 2))
await browser.close()
