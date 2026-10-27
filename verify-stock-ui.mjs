/**
 * 在线素材库界面验收（离线）：来源切换、显式检索、预览、授权、导入与落点、设置脱敏、键盘与窄屏。
 * 所有 /api/stock/* 都用 page.route 拦截，不访问真实图库。
 * 跑法：node verify-stock-ui.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5371
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-ui-'))
const PROJECTS = path.join(TMP, 'projects')
const PROJECT = 'stock-ui'
fs.mkdirSync(PROJECTS, { recursive: true })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const section = (t) => console.log(`\n=== ${t} ===`)

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS, PEXELS_API_KEY: '' }, stdio: 'ignore' },
)
const waitServer = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${APP}/api/health`)
      if (r.ok) return true
    } catch {
      /* 继续等 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

const item = (id, mediaType, over = {}) => ({
  provider: 'pexels',
  itemId: String(id),
  mediaType,
  title: `素材 ${id}`,
  author: 'Ada',
  authorUrl: 'https://example.org/ada',
  sourceUrl: `https://example.org/item/${id}`,
  license: {
    name: mediaType === 'image' || mediaType === 'video' ? 'Pexels License' : 'CC BY 4.0',
    url: 'https://example.org/license',
    attribution: `“Ada” · ${mediaType === 'audio' ? 'CC BY 4.0' : 'Pexels License'} · 在线素材`,
    requiresAttribution: mediaType === 'audio',
  },
  thumbnailUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#2563eb"/></svg>'),
  previewUrl: '/videos/picker-none.mp4',
  variants: [{ url: `/videos/${id}.mp4`, mime: mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4' }],
  token: `stk_${id}`,
  ...over,
})

let searchCalls = []
let importCalls = []
const installRoutes = async (page) => {
  await page.route('**/api/stock/providers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        providers: [
          { id: 'pexels', label: 'Pexels', mediaTypes: ['image', 'video'], needsKey: true, ok: true },
          { id: 'pixabay', label: 'Pixabay', mediaTypes: ['image', 'video'], needsKey: true, ok: false, reason: '未配置 Key' },
          { id: 'openverse', label: 'Openverse', mediaTypes: ['image', 'audio'], needsKey: false, ok: true, keyFromEnv: true },
        ],
      }),
    }),
  )
  await page.route('**/api/stock/search**', async (route) => {
    const u = new URL(route.request().url())
    const params = Object.fromEntries(u.searchParams)
    searchCalls.push(params)
    if (params.q === 'boom') {
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, kind: 'rate-limit', message: 'rate limit exceeded' }),
      })
    }
    const type = params.type || 'image'
    const page1 = [
      item(1, type),
      item(2, type, { title: '第二条', author: 'Bo' }),
    ]
    if (params.q === 'empty') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, provider: params.provider, mediaType: type, query: params.q, page: 1, perPage: 24, hasMore: false, cached: false, items: [] }),
      })
    }
    const items = params.page === '2' ? [item(3, type, { title: '第二页素材' })] : page1
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: params.provider,
        mediaType: type,
        query: params.q,
        page: Number(params.page) || 1,
        perPage: 24,
        total: 3,
        hasMore: params.page !== '2',
        cached: params.page === '1',
        items,
      }),
    })
  })
  await page.route('**/api/stock/import', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    importCalls.push(body)
    const id = String(body.token || '').replace(/^stk_/, '')
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        url: `/project-assets/${PROJECT}/stock-pexels-${id}.jpg`,
        provider: 'pexels',
        itemId: id,
        mediaType: 'image',
        reused: false,
        meta: { provider: 'pexels', itemId: id, url: `/project-assets/${PROJECT}/stock-pexels-${id}.jpg`, mediaType: 'image', title: '素材 ' + id, author: 'Ada', license: 'Pexels License', licenseUrl: '', attribution: 'Ada · Pexels License · Pexels', createdAt: new Date().toISOString() },
      }),
    })
  })
  await page.route('**/api/stock/meta**', (route) => {
    const u = new URL(route.request().url())
    const url = u.searchParams.get('url') || ''
    if (url.includes('stock-pexels-')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, meta: { provider: 'pexels', itemId: '1', url, mediaType: 'image', title: '素材 1', author: 'Ada', authorUrl: '', sourceUrl: 'https://example.org/item/1', license: 'Pexels License', licenseUrl: '', attribution: 'Ada · Pexels License · Pexels', createdAt: '' } }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, meta: null }) })
  })
}

let browser
try {
  if (!(await waitServer())) throw new Error('临时 dev server 启动失败')
  await fetch(`${APP}/api/project?name=${PROJECT}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '在线素材 UI 验收' }),
  })

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await ctx.newPage()
  await installRoutes(page)
  await page.goto(APP, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  // 选中验收项目
  await page.locator('header button', { hasText: '项目' }).first().click().catch(() => {})
  await page.waitForTimeout(300)
  const projectOption = page.locator(`text=${PROJECT}`).first()
  if (await projectOption.count()) {
    await projectOption.click()
    await page.waitForTimeout(500)
  }

  section('素材页入口')
  await page.locator('header button', { hasText: '素材' }).first().click()
  await page.waitForTimeout(900)
  const openBtn = page.getByRole('button', { name: '在线素材库' })
  check('素材页有在线素材库入口', (await openBtn.count()) === 1)
  await openBtn.click()
  await page.waitForTimeout(700)
  const dialog = page.locator('.stock-dialog')
  check('在线素材库弹窗打开', (await dialog.count()) === 1)
  check('默认未检索时不请求来源', searchCalls.length === 0, `calls=${searchCalls.length}`)

  section('来源与检索')
  check('来源列表含三家', (await page.locator('[data-stock-provider]').count()) === 3)
  check(
    '不可用来源标注原因',
    (await page.locator('[data-stock-provider="pixabay"]').innerText()).includes('不可用'),
  )
  check(
    '环境变量来源有标记',
    (await page.locator('[data-stock-provider="openverse"]').innerText()).includes('ENV'),
  )

  const query = page.locator('[data-stock-query]').first()
  await query.fill('雨')
  check('关键词过短时搜索禁用', await page.locator('[data-stock-search]').first().isDisabled())
  await query.fill('rain')
  // 键入不触发检索
  check('键入不发请求', searchCalls.length === 0, `calls=${searchCalls.length}`)
  await query.press('Enter')
  await page.waitForTimeout(600)
  check('提交后发起一次检索', searchCalls.length === 1, `calls=${searchCalls.length}`)
  check('检索参数带 provider/type/q', searchCalls[0]?.provider === 'pexels' && searchCalls[0]?.q === 'rain')
  check('结果渲染', (await page.locator('[data-stock-item]').count()) === 2)
  check('显示来源缓存标记', (await page.locator('.stock-count').innerText()).includes('来自缓存'))
  check('显示总数', (await page.locator('.stock-count').innerText()).includes('共 3 条'))

  await page.locator('[data-stock-item="1"]').first().click()
  await page.waitForTimeout(400)
  check('详情显示作者', (await page.locator('[data-stock-detail]').innerText()).includes('Ada'))
  check('详情显示许可', (await page.locator('[data-stock-detail]').innerText()).includes('Pexels License'))
  check('详情有来源页面链接', (await page.locator('.stock-source-link').count()) === 1)
  check('免署名许可不显示署名提示', (await page.locator('.stock-attribution').count()) === 0)

  await page.locator('[data-stock-more]').first().click()
  await page.waitForTimeout(500)
  check('加载更多追加结果', (await page.locator('[data-stock-item]').count()) === 3)
  check('分页保留选中项', (await page.locator('[data-stock-item="1"].on').count()) === 1)

  // 空结果与限流
  await query.fill('empty')
  await query.press('Enter')
  await page.waitForTimeout(500)
  check('空结果显示空状态', (await page.locator('.stock-empty').first().innerText()).includes('没有匹配'))
  await query.fill('boom')
  await query.press('Enter')
  await page.waitForTimeout(500)
  check('限流显示可读原因', (await page.locator('[data-stock-error]').innerText()).includes('限流'))

  // 音频与署名
  section('音频与署名')
  await page.locator('[data-stock-provider="openverse"]').click()
  await page.waitForTimeout(200)
  check('Openverse 只提供图片和音频', (await page.locator('[data-stock-type]').count()) === 2)
  await page.locator('[data-stock-type="audio"]').click()
  await page.waitForTimeout(200)
  await query.fill('rain audio')
  await query.press('Enter')
  await page.waitForTimeout(600)
  await page.locator('[data-stock-item="1"]').first().click()
  await page.waitForTimeout(300)
  check('音频详情有播放器', (await page.locator('[data-stock-detail] audio').count()) === 1)
  check('需署名许可显示署名提示', (await page.locator('.stock-attribution').count()) === 1)
  check('音频标注不参与出片', (await page.locator('[data-stock-detail]').innerText()).includes('不参与出片音轨'))
  await page.locator('[data-stock-copy]').click()
  await page.waitForTimeout(300)
  check('复制署名有反馈', (await page.locator('[data-stock-copy]').innerText()).includes('已复制'))

  section('导入与落点')
  importCalls = []
  await page.locator('[data-stock-import]').first().click()
  await page.waitForTimeout(600)
  check('导入只提交 project + token', Object.keys(importCalls[0] || {}).sort().join(',') === 'project,token', JSON.stringify(importCalls[0]))
  check('导入成功标记已导入', (await page.locator('.stock-imported-badge').count()) >= 1)
  const cardCount = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem(`storyboard-canvas-v1:${'stock-ui'}`) || '{}')
    return (p.nodes || []).filter((n) => n.type === 'asset').length
  })
  check('导出生成了画布素材卡', cardCount >= 1, `cards=${cardCount}`)

  // 场景设定落点
  await page.locator('[data-stock-provider="pexels"]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-stock-type="image"]').click()
  await page.waitForTimeout(200)
  await query.fill('rain scene')
  await query.press('Enter')
  await page.waitForTimeout(600)
  await page.locator('[data-stock-item="2"]').first().click()
  await page.waitForTimeout(200)
  await page.locator('.stock-target select').selectOption('scene')
  await page.locator('[data-stock-import]').first().click()
  await page.waitForTimeout(700)
  const designState = await page.evaluate(async () => {
    const proj = await fetch('/api/project?name=stock-ui').then((r) => r.json())
    const designs = proj.project?.designs || []
    const stockDesign = designs.find((d) => String(d.id).startsWith('design-stock-'))
    return { total: designs.length, found: Boolean(stockDesign), kind: stockDesign?.kind, hasImage: Boolean(stockDesign?.image) }
  })
  check(
    '场景落点写入设定卡',
    designState.found && designState.kind === 'scene' && designState.hasImage,
    JSON.stringify(designState),
  )

  await page.locator('.stock-dialog .mp-close').click()
  await page.waitForTimeout(400)
  check('关闭在线素材库', (await page.locator('.stock-dialog').count()) === 0)

  section('设置分区')
  await page.locator('header button', { hasText: '设置' }).first().click()
  await page.waitForTimeout(800)
  await page.locator('.st-nav button', { hasText: '素材库' }).click()
  await page.waitForTimeout(400)
  check('设置页有素材库分区', (await page.locator('[data-settings-stock]').count()) === 1)
  check('三个来源各有配置卡', (await page.locator('[data-stock-provider-card]').count()) === 3)
  const keyInput = page.locator('[data-stock-key="pexels"]')
  check('Key 输入是密码框', (await keyInput.getAttribute('type')) === 'password')
  check('未保存时占位提示环境变量', (await keyInput.getAttribute('placeholder') || '').includes('PEXELS_API_KEY'))
  await page.locator('[data-stock-test]').click()
  await page.waitForTimeout(900)
  check('检测后显示可用性', (await page.locator('[data-settings-stock]').innerText()).includes('不可用'))

  section('窄屏与键盘')
  // 只量在线素材浏览器自身：全局顶栏在 390px 的横向滚动是既有行为，不属于本次变更
  await page.setViewportSize({ width: 390, height: 900 })
  await page.waitForTimeout(300)
  await page.locator('header button', { hasText: '素材' }).first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: '在线素材库' }).click()
  await page.waitForTimeout(700)
  const narrow = await page.evaluate(() => {
    const dialog = document.querySelector('.stock-dialog')
    const grid = document.querySelector('[data-stock-grid]')
    const search = document.querySelector('[data-stock-query]')
    const detail = document.querySelector('[data-stock-detail]')
    const r = (el) => (el ? { sw: el.scrollWidth, cw: el.clientWidth, right: Math.round(el.getBoundingClientRect().right) } : null)
    return { dialog: r(dialog), grid: r(grid), searchRight: search ? Math.round(search.getBoundingClientRect().right) : 0, detail: r(detail) }
  })
  check(
    '窄屏在线素材库不横向溢出',
    Boolean(narrow.dialog) && narrow.dialog.sw <= narrow.dialog.cw + 1 && narrow.dialog.right <= 390,
    JSON.stringify(narrow),
  )
  check('窄屏检索框可用', narrow.searchRight > 0 && narrow.searchRight <= 390, JSON.stringify(narrow))
  check('窄屏详情改为单列可滚动', narrow.detail && narrow.detail.cw > 0, JSON.stringify(narrow.detail))

  // 键盘：Tab 进入检索框，Esc 关闭弹窗
  await page.locator('[data-stock-query]').first().focus()
  check('检索框可获得焦点', await page.locator('[data-stock-query]').first().evaluate((el) => el === document.activeElement))
  await page.keyboard.press('Escape').catch(() => {})
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForTimeout(300)

  await ctx.close()
} catch (e) {
  check('UI 验收执行', false, (e && e.message) || String(e))
} finally {
  await browser?.close().catch(() => {})
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad === 0 ? '\n✅ 全部通过' : `\n❌ ${bad} 项失败`)
process.exit(bad ? 1 : 0)
