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

// 2. 选中一张分镜卡（角色卡/素材卡不算）
// 卡片可能互相重叠，坐标点击会命中上层别的卡；直接给分镜卡派发 click 最稳
const nodes = page.locator('.react-flow__node .shot')
console.log('nodes:', await nodes.count())
await page.evaluate(() => {
  const shot = [...document.querySelectorAll('.react-flow__node')].filter((n) => n.querySelector('.shot'))[0]
  shot?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
})
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/02-selected.png` })

// 3. switch to character view
await page.getByRole('button', { name: '角色', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/03-chars.png` })

const cards = page.locator('.char-card')
console.log('char cards:', await cards.count())
console.log('board-hint:', await page.locator('.board-hint').innerText())

// 4. inject first character into selected shot（注入按钮在默认收起的「更多」里）
await page.locator('.char-more > summary').first().click()
await page.waitForTimeout(200)
await page.locator('.char-card').nth(0).getByRole('button', { name: '注入镜头' }).click()
await page.waitForTimeout(600)
const toast = await page.locator('.toast').innerText().catch(() => '(no toast)')
console.log('toast:', toast)
await page.screenshot({ path: `${OUT}/04-injected.png` })

// 5. back to board, read the prompt of the selected shot from inspector
await page.getByRole('button', { name: '画布', exact: true }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/05-board-prompt.png` })
// 驾驶舱里提示词在「画面」页的首帧提示词 textarea
const ta = page.locator('.inspector textarea').first()
console.log('prompt:', (await ta.inputValue().catch(() => '(none)')).slice(0, 60))

// 6. persistence check
const saved = await page.evaluate(() => {
  const project = document.querySelector('.topbar-project select')?.value || ''
  const raw = localStorage.getItem(`storyboard-canvas-v1:${encodeURIComponent(project)}`)
  const p = JSON.parse(raw || '{}')
  return { project, hasNodes: Array.isArray(p.nodes), nodeCount: p.nodes?.length }
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
