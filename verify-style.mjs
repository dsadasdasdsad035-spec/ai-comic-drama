import { chromium } from 'playwright-core'

const contrast = (fg, bg) => {
  const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const L = (h) => {
    const n = parseInt(h.replace('#', ''), 16)
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  }
  const a = L(fg), b = L(bg)
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1600)

const t = await p.evaluate(() => {
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const k of ['--bg','--bg-2','--panel','--panel-2','--chrome-1','--chrome-2','--chrome-line','--line','--line-2','--text','--text-2','--muted','--accent','--accent-ink','--warn','--danger','--ok','--font-sans','--font-mono','--dur-fast','--dur-base','--dur-slow']) {
    out[k] = cs.getPropertyValue(k).trim() || '(INVALID)'
  }
  return out
})
const bodyFont = await p.evaluate(() => getComputedStyle(document.body).fontFamily)
const metaColor = await p.evaluate(() => {
  const el = document.querySelector('.shot-meta') || document.querySelector('.brand-sub')
  return el ? getComputedStyle(el).color : null
})
const monoUsed = await p.evaluate(() => {
  const el = document.querySelector('.shot-dur')
  return el ? getComputedStyle(el).fontFamily : null
})

console.log('token 解析:', JSON.stringify(t, null, 1).slice(0, 900))
console.log('\nbody font:', bodyFont)
console.log('次要文字 color:', metaColor, '(应比主文字 #dbe7f3 暗)')
console.log('时长 mono font:', monoUsed)
console.log('\n对比度（AA 需 ≥4.5）:')
for (const [n, fg] of [['text', '#dbe7f3'], ['text-2', '#b6c8da'], ['muted', '#7d93ab'], ['accent', '#38bdf8'], ['warn', '#fbbf24'], ['danger', '#f87171'], ['ok', '#4ade80']]) {
  console.log(`  ${n.padEnd(8)} on panel #0e1620 -> ${contrast(fg, '#0e1620')}:1`)
}
await p.screenshot({ path: '/tmp/style-after.png' })
await b.close()
