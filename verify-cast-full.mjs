import { chromium } from 'playwright-core'
import fs from 'node:fs'

const proj = JSON.parse(fs.readFileSync('../manga-pipeline/projects/recycle/project.json', 'utf8'))
const mkNodes = (ep) =>
  proj.shots.filter((s) => (s.episode || 1) === ep).map((s, i) => ({
    id: `n${i}`, type: 'shot',
    position: { x: (i % 6) * 300, y: Math.floor(i / 6) * 340 },
    data: {
      no: s.no, seconds: 3, size: '中景', move: '固定', dialogue: '', prompt: 'p', marks: [],
      shotId: s.id, episode: ep,
      // 故意不带 cast：模拟升级前推送的老节点
    },
  }))

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await p.goto('http://localhost:5273', { waitUntil: 'domcontentloaded' })

// ── 场景 1：E01（老节点无 cast）→ 开角色后应自动补名单并连线
await p.evaluate((nodes) => {
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify({ nodes, edges: [], characters: [], cleared: false }))
  localStorage.setItem('storyboard-chars-on', '0')
  localStorage.removeItem('storyboard-char-pos')
}, mkNodes(1))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.locator('.bm .tm-btn').click()
await p.locator('.bm-item:has-text("角色上画布")').click()
await p.waitForTimeout(2600)
console.log('[E01] 角色节点', await p.locator('.react-flow__node-char').count(),
  '| 带 cast 的卡', await p.locator('.cast-stack').count(),
  '| 连线', await p.locator('.react-flow__edge').count(), '(期望 14)')
await p.screenshot({ path: '/tmp/cast-e01.png' })

// ── 场景 2：E02（含「陈曦（投影）」+ 无卡群演）
await p.evaluate((nodes) => {
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify({ nodes, edges: [], characters: [], cleared: false, epNo: 2 }))
}, mkNodes(2))
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(2600)
const chars = await p.locator('.react-flow__node-char').count()
const miss = await p.locator('.char-node.missing').count()
const names = await p.locator('.char-node .char-name').allInnerTexts()
console.log('[E02] 角色节点', chars, '| 无卡占位', miss, '| 节点名', JSON.stringify(names))
console.log('[E02] 连线', await p.locator('.react-flow__edge').count())
// 「陈曦（投影）」应该挂到「陈曦」卡上，而不是变成占位
const hasProjectionMiss = names.includes('陈曦（投影）')
console.log('[E02] 「陈曦（投影）」是否误判为无卡:', hasProjectionMiss, '(应为 false)')
await p.screenshot({ path: '/tmp/cast-e02.png' })
await b.close()
console.log('DONE')
