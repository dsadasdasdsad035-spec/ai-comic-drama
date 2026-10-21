/**
 * 从剧本/本集拆角色验证（拦截 /api/text，不真调模型）：
 * 1) 「从本集拆角色」请求带上本集场次与分镜出场
 * 2) 新角色入库、卡片出现；已有锚点的同名角色不被覆盖
 * 3) 「从全剧拆角色」请求带上原文梗概；重复执行幂等（不重复加卡）
 * 跑法：node verify-charextract.mjs
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

// 预清理：去掉上次跑残留
{
  const chars = await getChars()
  if (chars.some((c) => c.name === '铁牙')) {
    await fetch(`${URL}/api/project?name=recycle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characters: chars.filter((c) => c.name !== '铁牙') }),
    })
    await new Promise((r) => setTimeout(r, 400))
  }
}

const before = await getChars()
const chenmoBefore = before.find((c) => c.name === '陈默')?.look_en ?? ''
check('基线有角色', before.length >= 2, String(before.length))

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } })
p.on('dialog', (d) => d.accept())
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

// 拦截文本模型：返回「陈默（已有锚点，应跳过）+ 铁牙（新角色）」
const calls = []
await p.route('**/api/text', async (route) => {
  calls.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      model: 'fake-pro',
      text: '',
      json: {
        characters: [
          {
            name: '陈默',
            role: '主角',
            age: '30 岁上下',
            look_cn: '模型瞎写的陈默外观，不应该覆盖',
            look_en: 'WRONG anchor that must not overwrite existing',
            palette: '黑',
            keywords: ['模型写的'],
          },
          {
            name: '铁牙',
            role: '反派 · 夜市打手',
            age: '40 岁上下',
            look_cn: '四十岁上下的壮汉，方脸，铁制假牙，左脸刀疤，破皮夹克。',
            look_en: 'burly man in his 40s, square face, iron false teeth, scar on left cheek, worn leather jacket',
            palette: '铁灰 + 暗红',
            keywords: ['铁牙', '左脸刀疤', '皮夹克'],
          },
        ],
      },
    }),
  })
})

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1600)
// 先把本集镜头推到画布，拆分时才会带上「分镜出场与台词」
await p.getByRole('button', { name: '镜头表', exact: true }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '生成到画布' }).click()
await p.waitForTimeout(1000)
await p.getByRole('button', { name: '角色', exact: true }).click()
await p.waitForTimeout(500)

// ---- 1. 从本集拆 ----
await p.locator('button', { hasText: '从本集拆角色' }).click()
await p.waitForTimeout(1500)
check('发出文本请求', calls.length === 1, String(calls.length))
const prompt1 = calls[0]?.prompt ?? ''
check('请求带本集剧本场次', /第\s*1\s*集的剧本场次与分镜/.test(prompt1))
check('prompt 里有真实场次内容', /夜市摊位/.test(prompt1) && /黑雨衣来客/.test(prompt1))
check('prompt 里有场次出场名单', /出场：陈默/.test(prompt1))
check('请求带分镜出场/台词', /本集分镜出场与台词/.test(prompt1))
check('走 pro 模型 + JSON', calls[0]?.model === 'pro' && calls[0]?.json === true)
check('带上角色守则系统提示词', /角色设定师/.test(calls[0]?.system ?? ''))

const cards = await p.locator('.char-card').count()
check('新角色卡片出现', cards === before.length + 1, `${before.length} → ${cards}`)
const tieya = p.locator('.char-card').filter({ hasText: '铁牙' }).first()
check('铁牙卡在列表中', (await tieya.count()) === 1)
check('铁牙有外观锚点', (await tieya.locator('.char-en').innerText()).includes('iron false teeth'))

const chenmoCard = p.locator('.char-card').filter({ hasText: '陈默' }).first()
const chenmoNow = await chenmoCard.locator('.char-en').innerText()
check('已有角色锚点未被覆盖', chenmoNow.trim() === chenmoBefore.trim(), chenmoNow.slice(0, 40))

await p.waitForTimeout(2000)
const saved = await getChars()
check('新角色已落库', saved.some((c) => c.name === '铁牙'))
check(
  '库里陈默锚点没变',
  (saved.find((c) => c.name === '陈默')?.look_en ?? '') === chenmoBefore,
)

// ---- 2. 从全剧拆（幂等） ----
await p.locator('button', { hasText: '从全剧拆角色' }).click()
await p.waitForTimeout(1500)
check('第二次请求走全剧素材', calls.length === 2 && /原著 \/ 梗概/.test(calls[1]?.prompt ?? ''))
check('重复拆解不重复加卡', (await p.locator('.char-card').count()) === before.length + 1)

// 清理
const after = await getChars()
await fetch(`${URL}/api/project?name=recycle`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ characters: after.filter((c) => c.name !== '铁牙') }),
})

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await p.screenshot({ path: '/tmp/charextract.png' })
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
