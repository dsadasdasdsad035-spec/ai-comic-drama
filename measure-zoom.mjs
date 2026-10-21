import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
// 推送全部 41 镜到画布
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(3000)

const stats = await p.evaluate(() => ({
  nodes: document.querySelectorAll('.react-flow__node').length,
  edges: document.querySelectorAll('.react-flow__edge').length,
  canvases: document.querySelectorAll('canvas').length,
  dom: document.getElementsByTagName('*').length,
}))
console.log('静态:', JSON.stringify(stats))

// 采样：2.5s 内 rAF 帧数 + 长任务
await p.evaluate(() => {
  window.__frames = 0
  window.__long = []
  window.__t0 = performance.now()
  const loop = () => {
    window.__frames++
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
const res = await p.evaluate(() => ({
  frames: window.__frames,
  fps: Math.round((window.__frames / (performance.now() - window.__t0)) * 1000),
  long: window.__long.length,
  worst: Math.max(0, ...window.__long),
}))
console.log('缩放采样:', JSON.stringify(res))
await b.close()
