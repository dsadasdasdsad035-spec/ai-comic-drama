import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5273/'
const OUT = '/tmp/sb-shots'
const IMG = '/generated/shot-1792463350590-e1bff0.jpg'

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1560, height: 940 } })
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))

await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

// 给 S02 挂一张真实位图（用已生成的 jpg，避免再花钱出图）
await page.evaluate((img) => {
  const raw = localStorage.getItem('storyboard-canvas-v1')
  const p = JSON.parse(raw)
  p.nodes[1].data.refImage = img
  p.nodes[1].data.videoUrl = undefined
  p.nodes[1].data.vidState = 'idle'
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
}, IMG)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

const node = page.locator('.react-flow__node').nth(1)
await node.click()
await page.waitForTimeout(300)

const btn = node.locator('.shot-vid')
console.log('出片按钮:', await btn.innerText(), '| disabled:', await btn.isDisabled())
await page.screenshot({ path: `${OUT}/10-vid-idle.png` })

await btn.click()
await page.waitForTimeout(2500)
console.log('点击后:', await btn.innerText())
await page.screenshot({ path: `${OUT}/11-vid-running.png` })

// 轮询直到出现视频或报错
let ok = false
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(4000)
  const st = await page.evaluate(() => {
    const v = document.querySelectorAll('.react-flow__node')[1]?.querySelector('.vid-preview')
    const err = document.querySelectorAll('.react-flow__node')[1]?.querySelector('.vid-error')
    return {
      hasVideo: Boolean(v),
      ready: v ? v.readyState : 0,
      w: v ? v.videoWidth : 0,
      err: err ? err.textContent : null,
    }
  })
  if (st.hasVideo || st.err) {
    console.log(`第 ${i + 1} 次:`, JSON.stringify(st))
    ok = st.hasVideo
    break
  }
}

await page.waitForTimeout(1500)
const detail = await page.evaluate(() => {
  const n = document.querySelectorAll('.react-flow__node')[1]
  const v = n?.querySelector('.vid-preview')
  return {
    hasVideo: Boolean(v),
    paused: v?.paused,
    duration: v?.duration,
    currentTime: v?.currentTime,
    error: n?.querySelector('.vid-error')?.textContent || null,
    barTag: n?.querySelector('.vid-tag')?.textContent || null,
    btn: n?.querySelector('.shot-vid')?.textContent || null,
  }
})
console.log('结果:', JSON.stringify(detail))
await page.screenshot({ path: `${OUT}/12-vid-done.png` })

// 切换「看静帧」
if (detail.hasVideo) {
  await page.locator('.react-flow__node').nth(1).locator('.vid-btn').click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/13-vid-off.png` })
  const still = await page.evaluate(
    () => Boolean(document.querySelectorAll('.react-flow__node')[1]?.querySelector('.vid-preview')),
  )
  console.log('切静帧后还有视频层:', still)
}

// 持久化
const saved = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return p.nodes?.[1]?.data?.videoUrl ?? null
})
console.log('localStorage videoUrl:', saved)

const bad = logs.filter((l) => /pageerror|error/i.test(l)).slice(0, 5)
console.log('--- errors ---')
console.log(bad.join('\n') || '(none)')
await browser.close()
