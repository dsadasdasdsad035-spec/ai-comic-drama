/**
 * 素材选择器验证：
 * 1) /api/media 返回生成图/视频/项目素材
 * 2) 素材卡「图片来源」是下拉（分组），选中即生效，不用手填
 * 跑法：node verify-media.mjs
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const URL = 'http://localhost:5273'
let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}
const api = (p, init) => fetch(`${URL}${p}`, init).then((r) => r.json())

// 保证 assets 里有一条项目素材；recycle 不存在时先建（-db/-assets 脚本也依赖它）
await api('/api/project?name=recycle&create=1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '素材回归' }),
}).catch(() => ({}))
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

// 生成图片/视频目录可能为空（产物是可重生成物，不该提交进仓库）；
// 这里只断言接口形状，不要求恰好有文件
if (!fs.existsSync(path.join(process.cwd(), 'public', 'generated', 'picker-generated.png'))) {
  fs.mkdirSync(path.join(process.cwd(), 'public', 'generated'), { recursive: true })
  fs.writeFileSync(
    path.join(process.cwd(), 'public', 'generated', 'picker-generated.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  )
}
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
// 显式选 recycle：默认项目不是它，不选会操作到别的项目，选择器里也看不到刚种的素材
await p.locator('.topbar-project select').selectOption('recycle')
await p.waitForTimeout(2200)

// ---- 素材卡：下拉选图 ----
await p.locator('.canvas-tools').getByRole('button', { name: '+ 素材', exact: true }).click()
await p.waitForTimeout(700)
// 来源已从 <select> 改成缩略图选择器按钮（asset-media-picker 能力）
const assetSel = p.locator('.inspector .asset-source').first()
check('素材卡出现来源选择器', (await assetSel.count()) === 1)
// 打开缩略图选择器，按项目素材分类选第一条
await assetSel.click()
await p.waitForTimeout(900)
check('选择器打开', (await p.locator('.mp-dialog').count()) === 1)
const tabs = await p.locator('.mp-tabs button').count()
check('按来源分类（页签数量）', tabs >= 5, String(tabs))
// 素材卡里那条 url 指向不存在的旧产物；切到「生成图片」页签选一条真实存在的
await p.locator('.mp-tabs button').filter({ hasText: '生成图片' }).click()
await p.waitForTimeout(500)
const realTile = p.locator('[data-pick-key="/generated/picker-generated.png"]').first()
check('选择器有素材条目', (await realTile.count()) === 1)
await realTile.click()
await p.waitForTimeout(500)
await p.getByRole('button', { name: '使用这个' }).click()
await p.waitForTimeout(800)
const assetNode = p.locator('.react-flow__node-asset').first()
check('卡片预览出现', (await assetNode.locator('img.asset-media, .asset-media').count()) >= 1)
check('不再需要手填（选择器取代文本框）', (await p.locator('.mp-dialog').count()) === 0)

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
