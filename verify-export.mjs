import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5273/'
const OUT = '/tmp/sb-shots'
const IMG = '/generated/shot-1792463350590-e1bff0.jpg'
const IMG2 = '/generated/shot-1792463351262-d5fb9c.jpg'
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
await page.waitForTimeout(700)

await page.evaluate(
  ([img, img2, vid]) => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1'))
    p.nodes[0].data.refImage = img
    p.nodes[1].data.refImage = img
    p.nodes[1].data.videoUrl = vid
    p.nodes[1].data.vidState = 'idle'
    p.nodes[2].data.refImage = img2
    p.nodes[3].data.refImage = img2
    p.nodes[4].data.refImage = img
    localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
  },
  [IMG, IMG2, VID],
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1300)

await page.locator('.react-flow__node').nth(0).click()
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(800)

console.log('分辨率选项:', await page.locator('.pv-res option').allTextContents())
await page.screenshot({ path: `${OUT}/40-export-idle.png` })

await page.getByRole('button', { name: '导出成片' }).click()
await page.waitForTimeout(500)
console.log('合成中按钮:', await page.locator('.pv-foot button:has-text("合成中")').count())

// 等结果
let msg = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  const m = await page.locator('.pv-msg').first()
  if ((await m.count()) > 0) {
    msg = (await m.innerText()).trim()
    if (/镜|失败|不存在|错误|超时/.test(msg)) break
  }
}
console.log('结果:', msg)
await page.screenshot({ path: `${OUT}/41-export-done.png` })

const dl = await page.evaluate(() => {
  const a = document.querySelector('.pv-foot a[download]')
  return a ? { href: a.getAttribute('href'), download: a.getAttribute('download') } : null
})
console.log('下载链接:', JSON.stringify(dl))

// 切 1080p 重新合成
if (dl) {
  await page.locator('.pv-res').selectOption('1080p')
  await page.waitForTimeout(400)
  console.log('切分辨率后 下载链接还在:', await page.locator('.pv-foot a[download]').count())
  await page.getByRole('button', { name: '导出成片' }).click()
  let msg2 = ''
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500)
    const m = page.locator('.pv-msg').first()
    if ((await m.count()) > 0) {
      msg2 = (await m.innerText()).trim()
      if (/镜|失败|超时/.test(msg2)) break
    }
  }
  console.log('1080p 结果:', msg2)
  await page.screenshot({ path: `${OUT}/42-export-1080.png` })
  const dl2 = await page.evaluate(() => {
    const a = document.querySelector('.pv-foot a[download]')
    return a ? a.getAttribute('href') : null
  })
  console.log('1080p 链接:', dl2)
}

console.log('--- errors ---')
console.log(logs.filter((l) => /pageerror|\[error\]/i.test(l)).slice(0, 6).join('\n') || '(none)')
await browser.close()
