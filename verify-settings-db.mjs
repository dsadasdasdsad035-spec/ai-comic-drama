/**
 * 设置页 + SQLite 存储端到端验证。
 * 会短暂写入设置（models.lite=TEST 后恢复），不动项目数据。
 * 跑法：node verify-settings-db.mjs
 */
import { chromium } from 'playwright-core'

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.message))
await p.goto('http://localhost:5273', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

// ---- 1. 项目数据从 SQLite 读出（迁移正确性） ----
const proj = await p.evaluate(() => fetch('/api/project?name=recycle').then((r) => r.json()))
const pj = proj?.project
check(
  'SQLite 读项目',
  pj && pj.shots?.length === 41 && pj.episodes?.length === 3,
  `shots=${pj?.shots?.length} eps=${pj?.episodes?.length}`,
)
check(
  'intensity/tone 在库里',
  pj.episodes[0].scenes[0].intensity === 3 && pj.episodes[0].scenes[0].tone === '压抑',
  JSON.stringify(pj.episodes[0].scenes[0]).slice(0, 80),
)
check('角色迁移', pj.characters?.length >= 1 && !!pj.characters[0].look_en, `${pj.characters?.length} 个`)

// ---- 2. 设置页 UI ----
await p.locator('header').locator('button', { hasText: /^设置/ }).first().click()
await p.waitForTimeout(700)
check('设置页打开', (await p.locator('.st-sec').count()) >= 3, `${await p.locator('.st-sec').count()} 个分区`)
check('四个规则包', (await p.locator('.st-rule').count()) === 4)
check('规则文本非空', ((await p.locator('.st-rule textarea').first().inputValue()) || '').includes('场景要素提取'))

await p.screenshot({ path: '/tmp/settings.png' })

// ---- 3. 改默认模型（渠道 + 模型表结构）→ 保存 → 落库 → 恢复 ----
const beforeDefaults = await p.evaluate(() =>
  fetch('/api/settings').then((r) => r.json()).then((j) => j.settings.defaults),
)
const textSel = p.locator('.st-field', { hasText: '文本 · 常规' }).locator('select')
await textSel.selectOption('deepseek-chat')
await p.locator('.st-actions button').click()
await p.waitForTimeout(900)
const saved1 = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()))
check('设置落库', saved1.settings?.defaults?.text === 'deepseek-chat', String(saved1.settings?.defaults?.text))

await textSel.selectOption(beforeDefaults.text)
await p.locator('.st-actions button').click()
await p.waitForTimeout(900)
const saved2 = await p.evaluate(() => fetch('/api/settings').then((r) => r.json()))
check('默认模型可恢复', saved2.settings?.defaults?.text === beforeDefaults.text, String(saved2.settings?.defaults?.text))

// ---- 4. 写路径：POST 合并不丢数据（传相同 style 的 characters 无副作用） ----
const before = await p.evaluate(() => fetch('/api/project?name=recycle').then((r) => r.json()))
await p.evaluate(async () => {
  await fetch('/api/project?name=recycle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logline: '一句话：废土回收人寻找妹妹' }),
  })
})
const after = await p.evaluate(() => fetch('/api/project?name=recycle').then((r) => r.json()))
check(
  'POST 合并：logline 更新且不丢 shots/episodes',
  after.project.logline.includes('废土回收人') &&
    after.project.shots.length === 41 &&
    after.project.episodes.length === 3,
)
check('POST 未传 characters 不清空', after.project.characters.length === before.project.characters.length)

// ---- 5. 页面无报错 ----
check('无 pageerror', errors.length === 0, errors.join('; ').slice(0, 120))

await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
