import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(2000)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1500)
await p.locator('.bm .tm-btn').click()
await p.waitForTimeout(300)
await p.locator('.bm-item', { hasText: '适配视图' }).click()
await p.waitForTimeout(2200)

const stat = await p.evaluate(() => ({
  nodes: document.querySelectorAll('.react-flow__node').length,
  edges: document.querySelectorAll('.react-flow__edge').length,
  canvases: document.querySelectorAll('canvas').length,
  still: document.querySelectorAll('.shot-still').length,
  blank: document.querySelectorAll('.shot-blank').length,
  dom: document.getElementsByTagName('*').length,
}))
await p.evaluate(() => {
  window.__f = 0
  window.__long = []
  window.__t0 = performance.now()
  const loop = () => {
    window.__f++
    if (performance.now() - window.__t0 < 2500) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__long.push(Math.round(e.duration))
  }).observe({ entryTypes: ['longtask'] })
})
const box = await p.locator('.react-flow__pane').boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 24; i++) {
  await p.mouse.wheel(0, i % 2 ? 200 : -200)
  await p.waitForTimeout(80)
}
const r = await p.evaluate(() => ({
  fps: Math.round((window.__f / (performance.now() - window.__t0)) * 1000),
  long: window.__long.length,
  worst: Math.max(0, ...window.__long),
}))
console.log('真实项目:', JSON.stringify(stat), '| 缩放', JSON.stringify(r))
await b.close()
