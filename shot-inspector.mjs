import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })
await p.goto('http://localhost:5273', { waitUntil: 'domcontentloaded' })
await p.evaluate(() => {
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify({
    nodes: [{ id: 'n1', type: 'shot', position: { x: 0, y: 0 }, data: {
      no: 'S01', seconds: 3, size: '中景', move: '推', dialogue: '陈默：哪来的？', marks: [],
      prompt: '陈默，油污工装，雨夜摊位，medium shot，low angle',
      videoPrompt: '镜头缓慢前推 20 厘米，雨丝斜切画面，冷青色调，24fps',
      refImage: '/generated/shot-1792491570220-5cd3fb.jpg',
    } }],
    edges: [], characters: [], cleared: false,
  }))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
await p.locator('.react-flow__node-shot').first().click()
await p.waitForTimeout(500)
const fields = await p.locator('.inspector .field span').allInnerTexts().catch(() => [])
const has = await p.locator('textarea').count()
console.log('Inspector 字段:', JSON.stringify(fields), '| textarea 数:', has)
await p.locator('.inspector').screenshot({ path: '/tmp/inspector-video-prompt.png' }).catch(() => p.screenshot({ path: '/tmp/inspector-video-prompt.png' }))
await b.close()
