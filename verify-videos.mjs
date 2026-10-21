/**
 * 视频挂载与缺失提示验证：
 * 1) /api/videos 列出 public/videos 里的文件
 * 2) Inspector 有「挂载已有视频」下拉，选中挂上后节点 videoUrl 变更并落库
 * 3) clip 指向不存在的文件时，卡片显示「视频文件缺失」
 * 跑法：node verify-videos.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const list = await fetch(`${URL}/api/videos`).then((r) => r.json())
check('接口返回视频列表', list.ok && Array.isArray(list.videos) && list.videos.length > 0, String(list.videos?.length))
const realVideo = list.videos.find((v) => fs.existsSync('public' + v.url))
// 记录第一个镜头的原 clip，跑完还原，避免污染项目数据
const before = (await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())).project
// 画布节点按镜号排序，测试挂载的是镜号最小的那一镜
const firstShot = [...before.shots].sort((a, b) => String(a.no).localeCompare(String(b.no), 'zh'))[0]
check('列表里的路径都能对应到文件', Boolean(realVideo), realVideo?.url)

// 清空素材库，避免恢复逻辑干扰
await fetch(`${URL}/api/project?name=recycle`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assets: [] }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1200)

const shotNodeId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId)?.id
})
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(700)

const picker = p.locator('.vid-pick select')
check('Inspector 有挂载下拉', (await picker.count()) === 1)
const opts = await picker.locator('option').count()
check('下拉里有视频选项', opts > 1, String(opts))

await picker.selectOption(realVideo.url)
await p.locator('.vid-pick button', { hasText: '挂上' }).click()
await p.waitForTimeout(2600)

const node = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.videoUrl
}, shotNodeId)
check('节点 videoUrl 已挂上', node === realVideo.url, String(node))

const saved = (await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())).project.shots
const sid = await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.id === nid)?.data?.shotId
}, shotNodeId)
check('clip 已落库', saved.find((s) => s.id === sid)?.clip === realVideo.url, String(saved.find((s) => s.id === sid)?.clip))

// 破损视频提示：把 clip 改成不存在的文件
await p.evaluate((nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((x) => x.id === nid)
  n.data.videoUrl = '/videos/definitely-missing.mp4'
  localStorage.setItem('storyboard-canvas-v1', JSON.stringify(s))
}, shotNodeId)
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(2200)
const broken = await p.locator('.vid-broken').count()
check('缺失视频显示提示', broken >= 1, String(broken))

// 还原：把第一个镜头 clip 改回去
{
  const j = (await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())).project
  const shots = j.shots.map((s) => (s.id === firstShot.id ? { ...s, clip: firstShot.clip ?? '' } : s))
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: { ...j, shots } }),
  })
}

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
