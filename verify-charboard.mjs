/**
 * 角色板增删改验证：
 * 1) 角色视图列出 DB 里的角色
 * 2) + 新建角色 → 卡片出现，编辑名字/外观锚点/关键词 → 落库
 * 3) 改名 → 画布连线（refIds = char-角色名）跟着迁移
 * 4) 删除 → 卡片消失 + 库里没有 + 相关 refIds 解除
 * 跑法：node verify-charboard.mjs
 */
import { chromium } from 'playwright-core'

const URL = 'http://localhost:5273'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const getChars = async () =>
  (await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())).project.characters

// 预清理：画布连线全部清空（新实例 localStorage 为空，会从 DB 拉到干净状态）
{
  const j = await fetch(`${URL}/api/project?name=recycle`).then((r) => r.json())
  const shots = j.project.shots.map((x) => ({ ...x, refIds: [] }))
  await fetch(`${URL}/api/project?name=recycle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
}

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1600)

const before = await getChars()
await p.getByRole('button', { name: '角色', exact: true }).click()
await p.waitForTimeout(600)
check('角色板列出全部角色', (await p.locator('.char-card').count()) === before.length, String(before.length))

// ---- 1. 新建 ----
await p.locator('button', { hasText: '+ 新建角色' }).click()
await p.waitForTimeout(500)
const afterAdd = await p.locator('.char-card').count()
check('新建后多一张卡', afterAdd === before.length + 1, String(afterAdd))
const card = p.locator('.char-card').last()
const newName = await card.locator('.char-name').innerText()
check('新卡有占位名', /^新角色\d+$/.test(newName), newName)

// ---- 2. 编辑字段 ----
await card.locator('.btn-mini', { hasText: '编辑' }).click()
await p.waitForTimeout(300)
check('编辑区展开', (await card.locator('.char-edit').count()) === 1)
await card.locator('[data-char-field="lookEn"]').fill('test man in his 30s, grey coat, brown eyes')
await card.locator('[data-char-field="lookCn"]').fill('测试用外观：灰色外套')
await card.locator('[data-char-field="role"]').fill('测试角色')
await card.locator('[data-char-field="keywords"]').fill('灰外套、短发')
await p.waitForTimeout(300)
check('卡片显示中文外观', (await card.locator('.char-look p').innerText()).includes('灰色外套'))

// 改名（id 跟着名字走）
await card.locator('[data-char-field="name"]').fill('测试角色A')
await card.locator('[data-char-field="name"]').press('Enter')
await p.waitForTimeout(500)
check('改名生效', (await card.locator('.char-name').innerText()) === '测试角色A')

await p.waitForTimeout(2000) // 回写防抖 1.2s
let chars = await getChars()
const saved = chars.find((c) => c.name === '测试角色A')
check('新角色落库', !!saved)
check('外观锚点落库', (saved?.look_en ?? '').includes('test man in his 30s'), String(saved?.look_en))
check('关键词落库', JSON.stringify(saved?.keywords) === JSON.stringify(['灰外套', '短发']), JSON.stringify(saved?.keywords))

// ---- 3. 改名迁移连线 ----
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '画布', exact: true }).click()
await p.waitForTimeout(800)
const shotNodeId = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  return (s.nodes || []).find((x) => x.type !== 'asset' && x.data?.shotId)?.id
})
// 用右键菜单连「陈默」
await p.locator(`[data-id="${shotNodeId}"]`).dispatchEvent('contextmenu', {
  clientX: 640,
  clientY: 420,
  button: 2,
})
await p.waitForTimeout(400)
await p.locator('.ctx-row[data-ref="char-陈默"] .ctx-main').click()
await p.waitForTimeout(400)
await p.keyboard.press('Escape')
await p.waitForTimeout(2600)
const linkedBefore = await p.evaluate(async (nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const sid = (s.nodes || []).find((x) => x.id === nid)?.data?.shotId
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  return (j.project.shots.find((x) => x.id === sid)?.refIds ?? [])
}, shotNodeId)
check('已连上 char-陈默', linkedBefore.includes('char-陈默'), JSON.stringify(linkedBefore))

// 角色视图里把「陈默」改名
await p.getByRole('button', { name: '角色', exact: true }).click()
await p.waitForTimeout(500)
const chenmo = p.locator('.char-card').filter({ hasText: '陈默' }).first()
await chenmo.locator('.btn-mini', { hasText: '编辑' }).click()
await chenmo.locator('[data-char-field="name"]').fill('陈默测')
await chenmo.locator('[data-char-field="name"]').press('Enter')
await p.waitForTimeout(2600)
const linkedAfter = await p.evaluate(async (nid) => {
  const s = JSON.parse(localStorage.getItem('storyboard-canvas-v1') || '{}')
  const sid = (s.nodes || []).find((x) => x.id === nid)?.data?.shotId
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  return (j.project.shots.find((x) => x.id === sid)?.refIds ?? [])
}, shotNodeId)
check('连线跟着改名迁移', linkedAfter.includes('char-陈默测') && !linkedAfter.includes('char-陈默'), JSON.stringify(linkedAfter))

// 改回来
await p.locator('.char-card').filter({ hasText: '陈默测' }).first().locator('.btn-mini', { hasText: '编辑' }).click()
await p.locator('[data-char-field="name"]').first().fill('陈默')
await p.locator('[data-char-field="name"]').first().press('Enter')
await p.waitForTimeout(2400)

// ---- 4. 删除测试角色 ----
const target = p.locator('.char-card').filter({ hasText: '测试角色A' }).first()
check('找到测试角色卡', (await target.count()) === 1)
await target.locator('.btn-mini.danger').click()
await p.waitForTimeout(2600)
chars = await getChars()
check('删除后库里没有', !chars.some((c) => c.name === '测试角色A'))
check('卡片数回落', (await p.locator('.char-card').count()) === before.length, String(before.length))

// 清理连线残留
await p.evaluate(async () => {
  const j = await fetch('http://localhost:5273/api/project?name=recycle').then((r) => r.json())
  const shots = j.project.shots.map((x) => ({
    ...x,
    refIds: (x.refIds ?? []).filter((r) => !r.startsWith('char-') || r === 'char-陈默'),
  }))
  await fetch('http://localhost:5273/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shots }),
  })
})

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/charboard.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
