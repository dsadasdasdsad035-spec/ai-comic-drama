/**
 * 素材选择器验证：
 * 1) /api/media 返回生成图/视频/项目素材
 * 2) 素材卡「图片来源」是下拉（分组），选中即生效，不用手填
 * 跑法：node verify-media.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())

// 保证 assets 里有一条项目素材
await api('/api/project?name=recycle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    assets: [
      {
        kind: 'scene',
        title: '废土夜市',
        url: '/generated/shot-1792463350590-e1bff0.jpg',
        note: '主场景',
        tags: ['夜景'],
      },
    ],
  }),
})

const media = await api('/api/media?name=recycle')
check('接口返回生成图片', Array.isArray(media.images) && media.images.length > 0, String(media.images?.length))
check('接口返回视频', Array.isArray(media.videos), String(media.videos?.length))
check('接口返回项目素材', (media.assets ?? []).length === 1, JSON.stringify(media.assets?.map((a) => a.title)))
check('素材项带 url', (media.assets ?? []).every((a) => String(a.url).startsWith('/generated/')))

const b = await chromium.launch({ headless: true, channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1680, height: 1100 } })
const errors = []
p.on('pageerror', (e) => errors.push(e.stack || e.message))

// 拦截文本模型：避免真打 API
await p.route('**/api/text', (route) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, model: 'fake-lite', text: 'ok', json: null }),
  }),
)

await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(1500)

// ---- 素材卡：下拉选图 ----
await p.locator('header').locator('button', { hasText: '+ 素材' }).click()
await p.waitForTimeout(700)
const assetSel = p.locator('.inspector select').first()
check('素材卡出现来源下拉', (await assetSel.count()) === 1)
const optCount = await assetSel.locator('option').count()
check('下拉里有可选项', optCount > 2, String(optCount))
const groups = await assetSel.locator('optgroup').count()
check('按来源分组', groups >= 2, String(groups))

const pickUrl = media.images[0].url
await assetSel.selectOption(pickUrl)
await p.waitForTimeout(600)
const assetNode = p.locator('.react-flow__node-asset').first()
check('卡片预览出现', (await assetNode.locator('img.asset-media, .asset-media').count()) >= 1)
check('不再需要手填（输入框默认隐藏）', (await p.locator('.inspector .field input[type="text"]').count()) === 0)

// 清理：assets 还原为空（保留 media 断言用过的数据）
await api('/api/project?name=recycle', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assets: [] }),
})

if (errors.length) console.log('\n--- pageerror ---\n' + errors.join('\n---\n'))
check('无 pageerror', errors.length === 0, errors[0]?.split('\n')[0] ?? '')
await b.close()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
