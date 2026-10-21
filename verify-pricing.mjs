/**
 * 计价验证：
 * 1) 生成画面默认 1 张
 * 2) 图片费用 = 单价 × 张数（改张数后立刻变）
 * 3) 视频费用 = 秒单价 × 时长（480p/720p 分开）
 * 4) 任务台账按实际张数/时长计入，总额 = 各任务之和
 * 5) 设置页改单价 → 重新加载后生效
 * 跑法：node verify-pricing.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())
/** 从 "Seedream 4.5 · ¥0.22 / 次" 里取 ¥ 后面那个数 */
const num = (s) => {
  const m = String(s).match(/¥\s*([\d.]+)/)
  return m ? Number(m[1]) : NaN
}

// 基线单价（设置里可能已有自定义值，先取回来）
const s0 = (await api('/api/settings')).settings
const base = {
  image: Number(s0.pricing?.image ?? 0.22),
  video480: Number(s0.pricing?.video480 ?? 0.08),
  video720: Number(s0.pricing?.video720 ?? 0.15),
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

// 清画布任务台账，便于断言本次花费
await p.addInitScript(() => localStorage.removeItem('storyboard-tasks-v1'))
await p.route('**/api/seedream', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake-price.jpg'], size: '1440x2560' }),
  }),
)
await p.route('**/api/seedance**', (route) =>
  route.request().method() === 'POST'
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'price-task' }) })
    : route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, status: 'succeeded', url: '/videos/fake.mp4' }),
      }),
)

// 保证第一镜有提示词，否则出图会被前置校验拦下（不产生任务）
{
  const j = (await api('/api/project?name=recycle')).project
  const target = j.shots.find((s) => s.keyframe_prompt) ?? j.shots[0]
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project: {
        ...j,
        shots: j.shots.map((s) =>
          s.id === target.id ? { ...s, keyframe_prompt: s.keyframe_prompt || '计价测试：雨夜街头的中景' } : s,
        ),
      },
    }),
  })
}

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(1000)

const shotNodeId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId)?.id
})
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, shotNodeId)
await p.waitForTimeout(600)

// 1) 默认 1 张
const cntSel = p.locator('.gen-box', { hasText: 'AI 生成画面' }).locator('select').nth(1)
check('生成画面默认 1 张', (await cntSel.inputValue()) === '1', await cntSel.inputValue())

// 2) 图片费用 = 单价 × 张数
const imgCost = async () =>
  num(await p.locator('.gen-box', { hasText: 'AI 生成画面' }).locator('.gen-cost').innerText())
const c1 = await imgCost()
check('1 张费用 = 单价', Math.abs(c1 - base.image) < 0.005, `${c1} vs ${base.image}`)
await cntSel.selectOption('2')
await p.waitForTimeout(300)
const c2 = await imgCost()
check('2 张费用翻倍', Math.abs(c2 - base.image * 2) < 0.01, `${c2} vs ${base.image * 2}`)
await cntSel.selectOption('1')
await p.waitForTimeout(200)

// 3) 视频费用 = 秒单价 × 时长
const sec = Number(
  await p.locator('.inspector .field', { hasText: '时长（秒）' }).locator('input').inputValue(),
)
const vidCost = num(await p.locator('.vid-box').locator('.gen-cost').innerText())
check('视频费用 = 480p 秒单价 × 时长', Math.abs(vidCost - base.video480 * Math.round(sec)) < 0.02,
  `${vidCost} vs ${base.video480}×${Math.round(sec)}`)

// 切 720p 看是否换价
await p.locator('.vid-box select').first().selectOption('720p')
await p.waitForTimeout(300)
const vid720 = num(await p.locator('.vid-box').locator('.gen-cost').innerText())
check('720p 用 720p 单价', Math.abs(vid720 - base.video720 * Math.round(sec)) < 0.02,
  `${vid720} vs ${base.video720}×${Math.round(sec)}`)
await p.locator('.vid-box select').first().selectOption('480p')
await p.waitForTimeout(200)

// 4) 触发出图 + 出片，检查任务台账金额
await p.locator('button', { hasText: /生成画面/ }).first().click()
await p.waitForTimeout(1200)
await p.locator('button', { hasText: /生成视频|重出视频/ }).first().click()
await p.waitForTimeout(4200)

const tasks = await p.evaluate(() => JSON.parse(localStorage.getItem('storyboard-tasks-v1') || '[]'))
console.log('   · 任务台账:', JSON.stringify(tasks.map((t) => ({ kind: t.kind, state: t.state, cost: t.cost, err: t.error }))))
const done = tasks.filter((t) => t.state === 'done')
const sum = done.reduce((a, t) => a + (t.cost ?? 0), 0)
check('任务台账有出图与出片', done.some((t) => t.kind === 'image') && done.some((t) => t.kind === 'video'),
  done.map((t) => `${t.kind}:${t.cost}`).join(','))
const imgTask = done.find((t) => t.kind === 'image')
const vidTask = done.find((t) => t.kind === 'video')
check('出图任务金额 = 1 张单价', Math.abs((imgTask?.cost ?? 0) - base.image) < 0.005, String(imgTask?.cost))
check('出片任务金额 = 时长 × 单价',
  Math.abs((vidTask?.cost ?? 0) - base.video480 * Math.round(sec)) < 0.02,
  String(vidTask?.cost))
check('总额 = 各任务之和', Math.abs(sum - ((imgTask?.cost ?? 0) + (vidTask?.cost ?? 0))) < 0.001, String(sum))

// 5) 改单价 → 重新加载生效
const oldImage = s0.pricing?.image
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pricing: { ...s0.pricing, image: 0.5 } }),
})
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(800)
const nodeId2 = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.data?.shotId)?.id
})
await p.evaluate((nid) => {
  const el = document.querySelector(`[data-id="${nid}"]`)
  const opt = { bubbles: true, button: 0, view: window }
  for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(t, opt))
}, nodeId2)
await p.waitForTimeout(600)
const c3 = await imgCost()
check('改单价后显示 ¥0.50', Math.abs(c3 - 0.5) < 0.01, String(c3))

// 还原单价
await api('/api/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pricing: { ...s0.pricing, image: oldImage ?? 0.22 } }),
})

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
