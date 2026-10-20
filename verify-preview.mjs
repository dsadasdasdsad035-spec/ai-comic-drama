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
    localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
  },
  [IMG, VID],
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1200)

// 从 S01 开始连播
await page.locator('.react-flow__node').nth(0).click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(900)

const peek = () =>
  page.evaluate(() => {
    const pv = document.querySelector('.pv')
    if (!pv) return null
    return {
      no: pv.querySelector('.pv-no')?.textContent,
      meta: pv.querySelector('.pv-meta')?.textContent,
      time: pv.querySelector('.pv-time')?.textContent,
      segs: pv.querySelectorAll('.pv-seg').length,
      onSeg: [...pv.querySelectorAll('.pv-seg')].findIndex((s) => s.classList.contains('on')),
      hasVideo: Boolean(pv.querySelector('.pv-stage video')),
      hasImg: Boolean(pv.querySelector('.pv-stage img')),
      ended: Boolean(pv.querySelector('.pv-end')),
      paused: Boolean(pv.querySelector('.pv-paused')),
    }
  })

console.log('初始:', JSON.stringify(await peek()))
await page.screenshot({ path: `${OUT}/30-preview-s01.png` })

// 空格暂停
await page.keyboard.press('Space')
await page.waitForTimeout(400)
console.log('暂停:', JSON.stringify(await peek()))
await page.screenshot({ path: `${OUT}/31-preview-paused.png` })
await page.keyboard.press('Space')

// 跳到 S02（视频镜）
await page.locator('.pv-seg').nth(1).click()
await page.waitForTimeout(2000)
const p2 = await peek()
console.log('S02:', JSON.stringify(p2))
await page.screenshot({ path: `${OUT}/32-preview-s02-video.png` })

// 直接跳到最后一镜，等它播完
await page.locator('.pv-seg').nth(4).click()
await page.waitForTimeout(5200)
console.log('片尾:', JSON.stringify(await peek()))
await page.screenshot({ path: `${OUT}/33-preview-end.png` })

// 重播 + Esc 关闭
await page.getByRole('button', { name: '重播' }).click()
await page.waitForTimeout(600)
console.log('重播:', JSON.stringify(await peek()))
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
console.log('关闭后还有预览层:', await page.evaluate(() => Boolean(document.querySelector('.pv'))))

console.log('--- errors ---')
console.log(logs.filter((l) => /pageerror|\[error\]/i.test(l)).slice(0, 6).join('\n') || '(none)')
await browser.close()
