import { chromium } from 'playwright-core'

const URL = 'http://127.0.0.1:5273/'
const OUT = '/tmp/sb-shots'
const IMG = '/generated/shot-1792463350590-e1bff0.jpg'
const IMG2 = '/generated/shot-1792463351262-d5fb9c.jpg'

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
  ([img, img2]) => {
    const p = JSON.parse(localStorage.getItem('storyboard-canvas-v1'))
    // S03 制造超长：台词长、镜头短
    const lines = [
      '回收人第七次敲响这扇门。',
      '哥，塔里的灯还亮着吗？',
      '这不是你的东西，我说过很多次了，义体登记在塔里，不在地下。',
      '',
      '我知道。所以我才来。',
    ]
    p.nodes.forEach((n, i) => {
      n.data.refImage = i % 2 === 0 ? img : img2
      n.data.dialogue = lines[i] ?? ''
      n.data.voiceUrl = undefined
      n.data.voiceState = 'idle'
      n.data.voiceSeconds = undefined
      n.data.videoUrl = undefined
      n.data.marks = []
    })
    p.nodes[2].data.seconds = 1.5 // 台词明显超长
    localStorage.setItem('storyboard-canvas-v1', JSON.stringify(p))
  },
  [IMG, IMG2],
)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1400)

// 批量配音（先把音轨做出来）
await page.getByRole('button', { name: '批量配音' }).click()
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(700)
  const n = await page.locator('.shot-voice').count()
  if (n >= 4) break
}
console.log('带配音镜头:', await page.locator('.shot-voice').count())
console.log('超长告警角标:', await page.locator('.shot-voice.over').count())

// S03 检查 Inspector 告警
await page.locator('.react-flow__node').nth(2).click()
await page.waitForTimeout(600)
const warn = await page.locator('.gen-warn').first().innerText().catch(() => '(无)')
console.log('Inspector 告警:', warn.replace(/\s+/g, ' '))
await page.screenshot({ path: `${OUT}/60-voice-overflow.png` })

// 导出（字幕开）
await page.getByRole('button', { name: '▶ 连播' }).click()
await page.waitForTimeout(700)
console.log('字幕开关默认:', await page.locator('.pv-subs input').isChecked())
await page.getByRole('button', { name: '导出成片' }).click()

let msg = ''
let warnBox = ''
for (let i = 0; i < 50; i++) {
  await page.waitForTimeout(1500)
  const m = page.locator('.pv-msg').last()
  if ((await m.count()) > 0) {
    msg = (await m.innerText()).trim()
    const w = page.locator('.pv-msg.warn')
    if ((await w.count()) > 0) warnBox = (await w.innerText()).trim()
    if (/镜|失败|超时/.test(msg)) break
  }
}
console.log('导出结果:', msg)
console.log('超长告警:', warnBox || '(无)')
await page.screenshot({ path: `${OUT}/61-subs-export.png` })

const href = await page.evaluate(() => {
  const a = document.querySelector('.pv-foot a[download]')
  return a ? a.getAttribute('href') : null
})
console.log('成片:', href)

// 关字幕再导一次，确认开关生效
if (href) {
  await page.locator('.pv-subs input').uncheck()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '导出成片' }).click()
  let msg2 = ''
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(1500)
    const m = page.locator('.pv-msg').last()
    if ((await m.count()) > 0) {
      msg2 = (await m.innerText()).trim()
      if (/镜|失败|超时/.test(msg2)) break
    }
  }
  console.log('关字幕后:', msg2)
}

console.log('--- errors ---')
console.log(logs.filter((l) => /pageerror|\[error\]/i.test(l)).slice(0, 6).join('\n') || '(none)')
await browser.close()
