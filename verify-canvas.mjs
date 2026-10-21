/**
 * 画布渲染模式验证：
 * 1) 静态模式不挂 Konva（canvas = 0），卡片用 img/占位
 * 2) 切到画笔 → 恢复 Konva Stage（能画标注）
 * 3) 切回选择 → canvas 归零
 * 4) 低缩放加 zoom-lite，卡片次要信息隐藏
 * 5) 无 pageerror
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1800)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(2000)

const base = await p.evaluate(() => ({
  nodes: document.querySelectorAll('.react-flow__node-shot').length,
  canvases: document.querySelectorAll('canvas').length,
  still: document.querySelectorAll('.shot-still').length,
  blank: document.querySelectorAll('.shot-blank').length,
}))
check('分镜卡渲染出来', base.nodes > 0, String(base.nodes))
check('静态模式不挂 Konva', base.canvases === 0, JSON.stringify(base))
check('卡片用 img 或占位', base.still + base.blank === base.nodes, JSON.stringify(base))

// 切画笔 → Konva 回来
await p.keyboard.press('p')
await p.waitForTimeout(1200)
const draw = await p.evaluate(() => document.querySelectorAll('canvas').length)
check('画笔模式恢复 Konva', draw >= base.nodes, String(draw))

// 切回选择 → 归零
await p.keyboard.press('v')
await p.waitForTimeout(1200)
const back = await p.evaluate(() => document.querySelectorAll('canvas').length)
check('切回选择后 canvas 归零', back === 0, String(back))

// 低缩放 → zoom-lite
await p.evaluate(() => {
  const pane = document.querySelector('.react-flow__pane')
  pane?.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }))
})
await p.waitForTimeout(400)
for (let i = 0; i < 8; i++) {
  await p.mouse.move(800, 500)
  await p.mouse.wheel(0, 300)
  await p.waitForTimeout(120)
}
await p.waitForTimeout(600)
const lite = await p.evaluate(() => document.querySelector('.canvas')?.classList.contains('zoom-lite'))
check('低缩放切到 zoom-lite', lite === true, String(lite))

check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
