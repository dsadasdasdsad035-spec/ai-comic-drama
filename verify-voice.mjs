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
await page.waitForTimeout(900)

await page.evaluate(
  ([img, img2, vid]) => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1'))
    const d = [
      '回收人第七次敲响这扇门。',
      '哥，塔里的灯还亮着吗？',
      '',
      '这不是你的东西。',
      '我知道。所以我才来。',
    ]
    p.nodes.forEach((n, i) => {
      n.data.refImage = i % 2 === 0 ? img : img2
      n.data.dialogue = d[i] ?? ''
      n.data.voiceUrl = undefined
      n.data.voiceState = 'idle'
      n.data.voiceError = undefined
      n.data.videoUrl = i === 1 ? vid : undefined
    })
    localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
  },
  [IMG, IMG2, VID],
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

// S01
await page.locator('.react-flow__node').nth(0).click()
await page.waitForTimeout(500)
await page.locator('.si-tabs [role="tab"]', { hasText: '音画' }).click()
await page.waitForTimeout(300)

const box = page.locator('.voice-box')
console.log('配音块存在:', await box.count())
console.log('引擎标签:', (await box.locator('.gen-cost').innerText()).trim())
console.log('音色数:', await box.locator('select').first().locator('option').count())
console.log(
  '音色列表:',
  (await box.locator('select').first().locator('option').allTextContents()).join(' | '),
)
await page.screenshot({ path: `${OUT}/50-voice-idle.png` })

// 生成单镜配音（Inspector 音画 Tab 吸底）
await page.locator('[data-shot-footer] button', { hasText: '生成配音' }).click()
await page.waitForTimeout(4000)
const one = await page.evaluate(() => {
  const a = document.querySelector('.voice-audio')
  return a ? { has: true, dur: Number(a.duration?.toFixed?.(2)), src: a.getAttribute('src') } : { has: false }
})
console.log('单镜配音:', JSON.stringify(one))
console.log('配音块标题:', (await box.locator('.gen-cost').innerText()).trim())
await page.screenshot({ path: `${OUT}/51-voice-one.png` })

// 卡片上的 ♪ 角标
console.log('卡片♪角标:', await page.locator('.shot-voice').count())

// 画布无批量配音：操作菜单不应出现该入口
await page.locator('.bm .tm-btn').click()
await page.waitForTimeout(300)
const batchVoiceItems = await page.getByRole('button', { name: '批量配音' }).count()
const batchVidItems = await page.getByRole('button', { name: '批量出片' }).count()
console.log('批量配音菜单项数（应为 0）:', batchVoiceItems)
console.log('批量出片菜单项数（应为 0）:', batchVidItems)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// 逐镜 Inspector 配音（替代原批量菜单）
for (let i = 0; i < 4; i++) {
  await page.locator('.react-flow__node').nth(i).click()
  await page.waitForTimeout(350)
  await page.locator('.si-tabs [role="tab"]', { hasText: '音画' }).click()
  await page.waitForTimeout(200)
  const btn = page.locator('[data-shot-footer] button', { hasText: /生成配音|重新配音/ })
  if ((await btn.count()) > 0 && (await btn.isEnabled())) await btn.click()
  await page.waitForTimeout(2200)
}
console.log('逐镜配音后带♪镜头数:', await page.locator('.shot-voice').count())
await page.screenshot({ path: `${OUT}/52-voice-batch.png` })

// 连播 + 导出（应带音轨）
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
await page.getByRole('button', { name: '导出成片' }).click()
let msg = ''
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500)
  const m = page.locator('.pv-msg').first()
  if ((await m.count()) > 0) {
    msg = (await m.innerText()).trim()
    if (/镜|失败|超时/.test(msg)) break
  }
}
console.log('导出结果:', msg)
await page.screenshot({ path: `${OUT}/53-voice-export.png` })

const href = await page.evaluate(() => {
  const a = document.querySelector('.pv-export a[download$=".mp4"]')
  return a ? a.getAttribute('href') : null
})
console.log('成片:', href)

console.log('--- errors ---')
console.log(logs.filter((l) => /pageerror|\[error\]/i.test(l)).slice(0, 6).join('\n') || '(none)')
await browser.close()
