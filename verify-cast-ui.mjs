import { chromium } from 'playwright-core'

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

await p.goto('http://localhost:5273', { waitUntil: 'domcontentloaded' })

// 造一份带 cast + 角色图的存档（模拟工作台推送后的画布状态）
await p.evaluate(() => {
  const mk = (id, no, x, cast, seconds = 3) => ({
    id,
    type: 'shot',
    position: { x, y: 0 },
    data: { no, seconds, size: '中景', move: '固定', dialogue: '测试台词', prompt: 'p', marks: [], cast },
  })
  localStorage.setItem(
    'storyboard-canvas-v1',
    JSON.stringify({
      nodes: [
        mk('n1', 'S01', 0, ['陈默']),
        mk('n2', 'S02', 360, ['陈默', '陈曦']),
        mk('n3', 'S03', 720, ['黑雨衣女人']),
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', type: 'shot', data: { relation: 'cut' } },
        { id: 'e2', source: 'n2', target: 'n3', type: 'shot', data: { relation: 'cut' } },
      ],
      characters: [
        { id: '陈默', name: '陈默', role: '主角', lookCn: '', lookEn: 'a', palette: '', keywords: [], image: '/generated/shot-1792491570220-5cd3fb.jpg' },
        { id: '陈曦', name: '陈曦', role: '配角', lookCn: '', lookEn: 'b', palette: '', keywords: [], image: '/generated/shot-1792491584150-6a3d52.jpg' },
        { id: '黑雨衣女人', name: '黑雨衣女人', role: '反派', lookCn: '', lookEn: 'c', palette: '', keywords: [] },
      ],
      cleared: false,
    }),
  )
  localStorage.removeItem('storyboard-char-pos')
  localStorage.setItem('storyboard-chars-on', '1')
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1800)

console.log('char nodes:', await p.locator('.react-flow__node-char').count())
console.log('char node imgs:', await p.locator('.char-node img').count())
console.log('char placeholder:', await p.locator('.char-placeholder').count())
console.log('cast-stack cards:', await p.locator('.cast-stack').count())
console.log('cast avatars:', await p.locator('.cast-stack img').count())
console.log('cast initial fallback:', await p.locator('.cast-stack .cast-initial').count())
console.log('cast edges:', await p.locator('.react-flow__edge').count())

// 头像图片是否真的加载成功（naturalWidth > 0）
const loaded = await p.evaluate(() =>
  [...document.querySelectorAll('.cast-stack img, .char-node img')].map((i) => ({
    src: i.getAttribute('src'),
    ok: i.naturalWidth > 0,
  })),
)
console.log('img load check:', JSON.stringify(loaded))

console.log('timeline cast chips:', await p.locator('.ntl-chip.cast').count())
console.log('timeline cast avatars:', await p.locator('.ntl-chip.cast img').count())
console.log('timeline text fallback:', await p.locator('.ntl-chip.cast i').count())

await p.screenshot({ path: '/tmp/cast-verify.png', fullPage: false })

// 点角色节点 → 聚焦出场镜头（不报错即可）
await p.locator('.react-flow__node-char').first().click()
await p.waitForTimeout(700)
console.log('after char click, pageerror-free: true')

await b.close()
console.log('DONE')
