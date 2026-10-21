import { chromium } from 'playwright-core'

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('dialog', (d) => d.accept())
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

await page.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// 确保在画布视图
const boardTab = page.locator('button:has-text("画布")')
if (await boardTab.count()) await boardTab.first().click().catch(() => {})

// 打开「角色」开关
await page.locator('button[title*="把角色放上画布"]').click()
await page.waitForTimeout(1200)

const charNodes = await page.locator('.react-flow__node-char').count()
console.log('char nodes on canvas:', charNodes)

const castEdges = await page.locator('.react-flow__edge-path').count()
console.log('edges total:', castEdges)

const stacks = await page.locator('.cast-stack').count()
const stackImgs = await page.locator('.cast-stack img').count()
console.log('shot cards with cast-stack:', stacks, '| avatar imgs:', stackImgs)

// 截图存证
await page.screenshot({ path: '/tmp/chars-canvas.png' })

// 时间线角色轨
const tlAvatars = await page.locator('.ntl-chip.cast img').count()
console.log('timeline cast avatars:', tlAvatars)

// 刷新持久化验证
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const charNodes2 = await page.locator('.react-flow__node-char').count()
console.log('char nodes after reload:', charNodes2)

await browser.close()
console.log('DONE')
