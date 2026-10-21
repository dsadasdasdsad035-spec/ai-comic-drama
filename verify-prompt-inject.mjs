import { chromium } from 'playwright-core'
const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage()
await p.goto('http://localhost:5273', { waitUntil: 'domcontentloaded' })
const r = await p.evaluate(async () => {
  const m = await import('/src/prompts.ts')
  return {
    storyboardLen: m.STORYBOARD_SYS.length,
    promptLen: m.PROMPT_SYS.length,
    scriptLen: m.SCRIPT_SYS.length,
    hasTransfer: m.STORYBOARD_SYS.includes('转接与运镜硬规则'),
    hasEyeMatch: m.STORYBOARD_SYS.includes('视线匹配'),
    hasFollowGeom: m.STORYBOARD_SYS.includes('跟」镜时四要素'),
    hasVocab: m.PROMPT_SYS.includes('dolly in'),
    hasParams: m.PROMPT_SYS.includes('no overexposure'),
    tail: m.STORYBOARD_SYS.slice(-60),
  }
})
console.log(JSON.stringify(r, null, 1))
await b.close()
