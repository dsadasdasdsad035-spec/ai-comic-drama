import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

const audit = await p.evaluate(() => {
  const cs = (el) => (el ? getComputedStyle(el) : null)
  const root = cs(document.documentElement)
  const tokens = {}
  for (const t of ['--bg','--bg-2','--panel','--panel-2','--line','--line-2','--text','--text-2','--muted','--accent','--accent-ink','--warn','--danger','--ok','--font-sans','--font-mono']) {
    tokens[t] = root.getPropertyValue(t).trim() || '(EMPTY/INVALID)'
  }
  const body = cs(document.body)
  const samples = {}
  const pick = (sel, label) => {
    const el = document.querySelector(sel)
    if (!el) { samples[label] = 'missing: ' + sel; return }
    const s = cs(el)
    samples[label] = { color: s.color, fontSize: s.fontSize, fontFamily: s.fontFamily.slice(0, 40), bg: s.backgroundColor }
  }
  pick('body', 'body')
  pick('.shot-meta', 'shot-meta(次要文字)')
  pick('.brand-sub', 'brand-sub')
  pick('.btn', 'btn')
  pick('.shot-no', 'shot-no')
  pick('.brand b', 'brand-title')
  return { tokens, bodyFont: body.fontFamily, bodyColor: body.color, samples }
})
console.log(JSON.stringify(audit, null, 2))
await b.close()
