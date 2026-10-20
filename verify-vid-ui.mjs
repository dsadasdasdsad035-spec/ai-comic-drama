import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5273/'
const OUT = '/tmp/sb-shots'
const IMG = '/generated/shot-1792463350590-e1bff0.jpg'
const VID = '/videos/shot-vid-1792465091666-c6fcf1.mp4'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

await page.evaluate(
  ([img, vid]) => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1'))
    p.nodes[1].data.refImage = img
    p.nodes[1].data.videoUrl = vid
    p.nodes[1].data.vidState = 'idle'
    p.nodes[1].data.vidError = undefined
    localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
  },
  [IMG, VID],
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const node = page.locator('.react-flow__node').nth(1)
await node.click()
await page.waitForTimeout(2500)

const st1 = await page.evaluate(() => {
  const n = document.querySelectorAll('.react-flow__node')[1]
  const v = n?.querySelector('.vid-preview')
  return {
    hasVideo: Boolean(v),
    paused: v?.paused,
    duration: Number(v?.duration?.toFixed?.(2)),
    readyState: v?.readyState,
    vidTag: n?.querySelector('.vid-tag')?.textContent || null,
    btn: n?.querySelector('.shot-vid')?.textContent || null,
    toggle: n?.querySelector('.vid-btn')?.textContent || null,
  }
})
console.log('播放态:', JSON.stringify(st1))
await page.screenshot({ path: `${OUT}/20-vid-playing.png` })

await node.locator('.vid-btn').click()
await page.waitForTimeout(700)
const st2 = await page.evaluate(() => {
  const n = document.querySelectorAll('.react-flow__node')[1]
  return {
    hasVideo: Boolean(n?.querySelector('.vid-preview')),
    toggle: n?.querySelector('.vid-btn')?.textContent || null,
  }
})
console.log('切静帧:', JSON.stringify(st2))
await page.screenshot({ path: `${OUT}/21-vid-still.png` })

await node.locator('.vid-btn').click()
await page.waitForTimeout(500)

// Inspector 视频区块
const insp = await page.evaluate(() => {
  const box = document.querySelector('.vid-box')
  if (!box) return null
  return {
    head: box.querySelector('.gen-head')?.textContent,
    len: box.querySelector('.vid-len')?.textContent,
    btn: box.querySelector('button')?.textContent,
    hasThumb: Boolean(box.querySelector('.vid-thumb')),
    thumbDur: Number(box.querySelector('.vid-thumb')?.duration?.toFixed?.(2)),
  }
})
console.log('Inspector:', JSON.stringify(insp))
await page.screenshot({ path: `${OUT}/22-vid-inspector.png` })

// 出片按钮点击后立刻进入 running 态（提示词为空时的兜底也应正常）
const btnState = await page.evaluate(() => {
  const b = document.querySelectorAll('.react-flow__node')[1]?.querySelector('.shot-vid')
  return { text: b?.textContent, disabled: b?.disabled }
})
console.log('卡片按钮:', JSON.stringify(btnState))

console.log('--- errors ---')
console.log(logs.filter((l) => /pageerror|\[error\]/i.test(l)).slice(0, 6).join('\n') || '(none)')
await browser.close()
