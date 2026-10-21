/**
 * 多参考图链路验证：角色图自动进 Seedream 多图参考 + Inspector 手动附加场景/道具图。
 * 拦截 /api/seedream 请求断言 payload，不真实出图（不花钱）。
 * 会短暂修改 project 的 characters（测完还原）。
 * 跑法：node verify-refs.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))

// ---- 打开页面（先 goto，evaluate 里的 fetch 才有页面上下文） ----
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1000)

// ---- 准备：给第一个角色挂一张参考图，记住原 characters 以便还原 ----
const pj = await p.evaluate(() => fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json()))
const proj = pj.project
const origChars = JSON.parse(JSON.stringify(proj.characters))
const heroName = origChars[0].name
const charsWithImg = origChars.map((c, i) => (i === 0 ? { ...c, image: '/generated/verify-char.jpg' } : c))
await p.evaluate((chars) =>
  fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters: chars }),
  }),
  charsWithImg,
)
await p.reload()
await p.waitForTimeout(1500)
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1200)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1200)

// 找一个 cast 含主角的节点
const target = await p.evaluate((hero) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const n = (s.nodes || []).find((n) => (n.data?.cast ?? []).some((c) => c.startsWith(hero)))
  return n ? { id: n.id, cast: n.data.cast, shotId: n.data.shotId } : null
}, heroName)
check('找到带 cast 的节点', !!target, JSON.stringify(target?.cast))

// ---- 拦截 /api/seedream ----
const captured = []
await p.route('**/api/seedream', async (route) => {
  captured.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, urls: ['/generated/fake1.jpg'], size: '1440x2560', elapsed: 0.1 }),
  })
})

await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(900)
// 选中目标节点（点节点卡片中心）
await p.evaluate((id) => {
  const inst = window.__rf ?? null
  void inst
  const el = document.querySelector(`[data-id="${id}"]`)
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}, target.id)
await p.waitForTimeout(600)

// Inspector 里点「生成」按钮
const genBtn = p.locator('button', { hasText: /生成画面/ }).first()
check('Inspector 生成按钮存在', (await genBtn.count()) > 0)
await genBtn.click()
await p.waitForTimeout(1200)

check('拦截到 1 次 Seedream 请求', captured.length === 1, String(captured.length))
if (captured.length) {
  const body = captured[0]
  check('refImages 含角色图', (body.refImages ?? []).includes('/generated/verify-char.jpg'), JSON.stringify(body.refImages))
  check('prompt 带参考图说明', /参考图说明/.test(body.prompt) && body.prompt.includes('外观基准'))
} else {
  check('refImages 含角色图', false, '未捕获请求')
  check('prompt 带参考图说明', false, '未捕获请求')
}

// ---- Inspector 手动加场景图 refExtras ----
const addIn = p.locator('.refx-add-in')
check('参考图输入框存在', (await addIn.count()) > 0)
await addIn.fill('/generated/verify-scene.jpg')
await addIn.press('Enter')
await p.waitForTimeout(400)
await genBtn.click()
await p.waitForTimeout(1200)
check('第二次请求被拦截', captured.length === 2, String(captured.length))
await p.waitForTimeout(2600) // 等防抖写回（1.5s）落库
if (captured.length === 2) {
  const body = captured[1]
  check(
    'refExtras 进多图参考',
    (body.refImages ?? []).includes('/generated/verify-scene.jpg'),
    JSON.stringify(body.refImages),
  )
  // 落库断言
  const after = await p.evaluate(() => fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json()))
  const shot = after.project.shots.find((s) => s.id === target.shotId)
  check('refExtras 落库', JSON.stringify(shot?.refExtras) === JSON.stringify(['/generated/verify-scene.jpg']), JSON.stringify(shot?.refExtras))
}

// ---- 还原 characters 与 refExtras ----
await p.evaluate((chars) =>
  fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters: chars, shots: undefined }),
  }).then(() =>
    fetch('http://localhost:5273/api/project?name=recycle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shots: undefined,
        refExtrasClear: undefined,
      }),
    }),
  ),
  origChars,
)
// 单独清 refExtras
await p.evaluate(async (shotId) => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((s) => (s.id === shotId ? { ...s, refExtras: [] } : s))
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}, target.shotId)
await p.evaluate((chars) =>
  fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characters: chars }),
  }),
  origChars,
)
const restored = await p.evaluate(() => fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json()))
check(
  '数据还原',
  JSON.stringify(restored.project.characters) === JSON.stringify(origChars) &&
    (restored.project.shots.find((s) => s.id === target.shotId)?.refExtras ?? []).length === 0,
)
check('无 pageerror', errors.length === 0, errors.join('; ').slice(0, 120))

await p.screenshot({ path: '/tmp/refs.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
