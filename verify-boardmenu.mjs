import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

// 顶栏按钮数量（画布视图）
const btnsBefore = await p.locator('header .btn').allInnerTexts()
console.log('顶栏 .btn 按钮:', JSON.stringify(btnsBefore))

// 打开操作下拉
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(400)
const items = await p.locator('.bm-panel .bm-item').allInnerTexts()
const secs = await p.locator('.bm-panel .bm-sec').allInnerTexts()
console.log('分区:', JSON.stringify(secs))
console.log('菜单项:', JSON.stringify(items))

// 面板是否在视口内
const box = await p.locator('.bm-panel').boundingBox()
console.log('面板位置:', JSON.stringify(box), '| 右侧溢出:', box && box.x + box.width > 1600)

// 点「角色上画布」→ 菜单关闭 + 角色节点出现
await p.locator('.bm-item:has-text("角色上画布")').click()
await p.waitForTimeout(900)
console.log('菜单已关闭:', (await p.locator('.bm-panel').count()) === 0)
console.log('角色节点:', await p.locator('.react-flow__node-char').count())

// 再开，验证状态显示「开」
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
const charsItem = await p.locator('.bm-item:has-text("角色上画布")').innerText()
console.log('角色项文本:', charsItem.replace(/\n/g, ' '))

// Esc 关闭
await p.keyboard.press('Escape')
await p.waitForTimeout(300)
console.log('Esc 关闭:', (await p.locator('.bm-panel').count()) === 0)

await p.screenshot({ path: '/tmp/boardmenu.png' })
await b.close()
console.log('DONE')
