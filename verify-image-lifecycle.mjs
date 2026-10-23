/**
 * 画布出图生命周期：单镜取消/旧图保留、防重入、批量取消、任务台账取消、刷新中断复位。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-image-lifecycle.mjs
 */
import { chromium } from 'playwright-core'

const URL = process.env.APP_URL || 'http://127.0.0.1:5280'
const NAME = `vimgcancel-${Date.now()}`
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const api = async (p, init) => {
  const r = await fetch(`${URL}${p}`, init)
  return r.json()
}
await api(`/api/project?name=${encodeURIComponent(NAME)}&create=1`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: NAME, aspect: '16:9' }),
})
await api(`/api/project?name=${encodeURIComponent(NAME)}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    episodes: [{ no: 1, scenes: [{ no: 1, slug: '井道' }] }],
    shots: [
      { id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', move: '固定', cast: ['A'], keyframe_prompt: 'first', keyframe: '/generated/shot-1792635057902-5480cf.jpg' },
      { id: 'E01-S02', episode: 1, no: 'S02', seconds: 3, size: '中景', move: '固定', cast: ['A'], keyframe_prompt: 'second' },
    ],
  }),
})

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
p.on('console', (m) => {
  if (m.type() === 'error' && !/fake|verify-/.test(m.location()?.url || '') && !/Failed to load resource|404|Expected static flag/.test(m.text())) errors.push(m.text())
})
let imagePosts = 0
let hold = true
await p.route('**/api/seedream', async (route) => {
  imagePosts++
  if (hold) {
    // 模拟上游永不返回；客户端取消/超时后这个等待仍可能残留，测试结束统一关闭浏览器
    await new Promise((r) => setTimeout(r, 60_000))
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'late' }) }).catch(() => {})
  }
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake.png'], url: '/generated/fake.png', size: '1x1', elapsed: 1 }),
  })
})

const canvasKey = `storyboard-canvas-v1:${encodeURIComponent(NAME)}`
const nodeData = async (shotId) =>
  p.evaluate(({ key, shotId }) => {
    const s = JSON.parse(localStorage.getItem(key) || '{}')
    return (s.nodes || []).find((x) => x.data?.shotId === shotId)?.data ?? null
  }, { key: canvasKey, shotId })
const nodeIds = async () =>
  p.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key) || '{}')
    const out = {}
    for (const n of s.nodes || []) if (n.data?.shotId) out[n.data.shotId] = n.id
    return out
  }, canvasKey)
const taskStates = () =>
  p.evaluate(() => JSON.parse(localStorage.getItem('storyboard-tasks-v1') || '[]').map((t) => t.state))
const clickNode = async (id, shift = false) => {
  await p.evaluate(({ nid, shift }) => {
    const el = document.querySelector(`[data-id="${nid}"]`)
    if (!el) return
    const o = { bubbles: true, button: 0, view: window, shiftKey: shift }
    el.dispatchEvent(new MouseEvent('mousedown', o))
    el.dispatchEvent(new MouseEvent('mouseup', o))
    el.dispatchEvent(new MouseEvent('click', o))
  }, { nid: id, shift })
  await p.waitForTimeout(300)
}

await p.goto(URL, { waitUntil: 'networkidle' })
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(900)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(700)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(800)
const ids = await nodeIds()
check('两个镜头进入画布', Boolean(ids['E01-S01'] && ids['E01-S02']), JSON.stringify(ids))

// 1) 单镜取消 + 旧图保留
const s1 = ids['E01-S01']
await clickNode(s1)
hold = true
imagePosts = 0
await p.locator(`[data-id="${s1}"] .shot-gen`).click()
await p.waitForTimeout(350)
check('运行中显示取消', (await p.locator('.gen-cancel').count()) === 1)
await p.locator('.gen-cancel').click()
await p.waitForTimeout(500)
let d = await nodeData('E01-S01')
check('取消后回到 idle', d?.genState !== 'running', JSON.stringify(d?.genState))
check('取消保留旧图', d?.refImage === '/generated/shot-1792635057902-5480cf.jpg')
check('取消不写错误', !d?.genError, JSON.stringify(d?.genError))

// 2) 防重入
hold = true
imagePosts = 0
await p.locator(`[data-id="${s1}"] .shot-gen`).click()
await p.locator(`[data-id="${s1}"] .shot-gen`).click({ force: true }).catch(() => {})
await p.waitForTimeout(300)
check('双击只发起一个请求', imagePosts === 1, String(imagePosts))
await p.locator('.gen-cancel').click()
await p.waitForTimeout(300)

// 3) 任务台账取消
hold = true
imagePosts = 0
await p.locator(`[data-id="${s1}"] .shot-gen`).click()
await p.waitForTimeout(300)
await p.locator('.tc-btn').click()
await p.waitForTimeout(200)
const tcCancel = p.locator('.tc-panel .tc-row.running button', { hasText: '取消' }).first()
check('任务台账出现取消', (await tcCancel.count()) === 1)
await tcCancel.click()
await p.waitForTimeout(450)
check('任务台账取消状态', (await taskStates()).includes('cancelled'), JSON.stringify(await taskStates()))
check('任务台账取消后节点 idle', (await nodeData('E01-S01'))?.genState !== 'running')

// 4) 批量取消：选两张，取消当前后第二张不再提交
await p.locator('.tc-panel .btn-mini', { hasText: '收起' }).click().catch(() => {})
await clickNode(s1)
await clickNode(ids['E01-S02'], true)
const selbar = p.locator('.selbar')
check('批量选择栏出现', (await selbar.count()) === 1)
hold = true
imagePosts = 0
await selbar.getByRole('button', { name: '出图', exact: true }).click()
await p.waitForTimeout(500)
check('批量取消按钮出现', (await selbar.getByRole('button', { name: '取消出图', exact: true }).count()) === 1)
await selbar.getByRole('button', { name: '取消出图', exact: true }).click()
await p.waitForTimeout(700)
check('批量取消停止后续提交', imagePosts <= 1, String(imagePosts))
check('批量取消后进度复位', (await p.locator('.selbusy').count()) === 0)

// 5) 正常成功路径
hold = false
imagePosts = 0
await p.locator(`[data-id="${s1}"] .shot-gen`).click()
await p.waitForTimeout(700)
d = await nodeData('E01-S01')
check('正常出图成功', d?.genState === 'idle' && (d?.candidates ?? []).includes('/generated/fake.png'), JSON.stringify(d?.candidates))
check('正常出图请求一次', imagePosts === 1, String(imagePosts))

// 6) 刷新中断复位
await p.evaluate(({ key, nid }) => {
  const s = JSON.parse(localStorage.getItem(key) || '{}')
  const n = (s.nodes || []).find((x) => x.id === nid)
  if (n) {
    n.data.genState = 'running'
    n.data.genError = ''
    localStorage.setItem(key, JSON.stringify(s))
  }
}, { key: canvasKey, nid: s1 })
await p.reload({ waitUntil: 'networkidle' })
await p.waitForTimeout(900)
await p.locator('.topbar-project select').selectOption(NAME)
await p.waitForTimeout(700)
check('刷新后不再转圈', (await p.locator('.gen-overlay').count()) === 0)
check('刷新后中断状态可读', (await p.locator('.gen-error-badge').count()) >= 1)

check('页面无异常', errors.length === 0, errors.slice(0, 2).join(' | '))
await b.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
