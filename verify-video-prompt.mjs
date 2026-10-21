import { chromium } from 'playwright-core'

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1500, height: 950 } })

const bodies = []
p.on('pageerror',(e)=>console.log('PAGEERROR:',e.message))
p.on('pageerror',(e)=>console.log('PAGEERROR:',e.message))
p.on('request', (r) => {
  if (r.url().includes('/api/seedance')) bodies.push(JSON.parse(r.postData() || '{}'))
})

await p.goto('http://localhost:5273', { waitUntil: 'domcontentloaded' })

// 1) 数据层：shotToData 是否正确带回 video_prompt
const round = await p.evaluate(async () => {
  const m = await import('/src/shotSync.ts')
  const d = m.shotToData({ id: 'E01-S01', no: 'S01', keyframe_prompt: '静态画面', video_prompt: '镜头前推 20 厘米', cast: ['陈默'] }, {
    no: 'S01', seconds: 3, size: '中景', move: '推', dialogue: '', prompt: '', marks: [],
  })
  return { videoPrompt: d.videoPrompt, prompt: d.prompt }
})
console.log('shotToData →', JSON.stringify(round), '(videoPrompt 应等于「镜头前推 20 厘米」)')

// 2) 请求层：点「出片」后发给服务端的 prompt 是否为 videoPrompt
await p.evaluate(() => {
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify({
    nodes: [{
      id: 'n1', type: 'shot', position: { x: 0, y: 0 },
      data: {
        no: 'S01', seconds: 3, size: '中景', move: '推', dialogue: '', marks: [],
        prompt: '静态外观：陈默，油污工装，雨夜摊位',
        
        refImage: '/generated/shot-1792491570220-5cd3fb.jpg',
      },
    }],
    edges: [], characters: [], cleared: false,
  }))
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.locator('.shot-vid').first().click()
await p.waitForTimeout(2500)

console.log('出片请求数:', bodies.length)
if (bodies[0]) {
  const pr = bodies[0].prompt || ''
  console.log('实际发送 prompt:', pr)
  console.log('用的是运动提示词:', pr.includes('静态外观'), '| 未串入静态描述:', !pr.includes('油污工装'))
  console.log('其它参数:', JSON.stringify({ seconds: bodies[0].seconds, cameraFixed: bodies[0].cameraFixed }))
}
await b.close()
