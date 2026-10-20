import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5273/'
const OUT = '/tmp/sb-shots'

const browser = await chromium.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

// 1. board view
await page.screenshot({ path: `${OUT}/01-board.png` })

// 2. select a shot S02 by clicking its node
const nodes = page.locator('.react-flow__node')
console.log('nodes:', await nodes.count())
await nodes.nth(1).click()
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/02-selected.png` })

// 3. switch to character view
await page.getByRole('button', { name: '角色', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/03-chars.png` })

const cards = page.locator('.char-card')
console.log('char cards:', await cards.count())
console.log('board-hint:', await page.locator('.board-hint').innerText())

// 4. inject first character into selected shot
await page.locator('.char-card').nth(0).getByRole('button', { name: '注入镜头' }).click()
await page.waitForTimeout(600)
const toast = await page.locator('.toast').innerText().catch(() => '(no toast)')
console.log('toast:', toast)
await page.screenshot({ path: `${OUT}/04-injected.png` })

// 5. back to board, read the prompt of the selected shot from inspector
await page.getByRole('button', { name: '分镜', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/05-board-prompt.png` })
const ta = page.locator('.panel textarea').first()
console.log('prompt:', await ta.inputValue().catch(() => '(none)'))

// 6. persistence check
const saved = await page.evaluate(() => {
  const raw = localStorage.getItem('storyboard-canvas-v1')
  const p = JSON.parse(raw || '{}')
  return { hasChars: Array.isArray(p.characters), charCount: p.characters?.length }
})
console.log('saved:', JSON.stringify(saved))

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.getByRole('button', { name: '角色', exact: true }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/06-after-reload.png` })

console.log('--- console ---')
console.log(logs.filter((l) => !/Download the React DevTools/.test(l)).slice(0, 20).join('\n'))
await browser.close()
