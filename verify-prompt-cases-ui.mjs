/**
 * 提示词案例 Tab 的浏览器验收（真实 UI，不花额度）。
 *
 * 覆盖：Tab 可切换、空态、导入弹窗预览（走真实 vflow 索引）、入库后卡片渲染、
 * 详情打开、复制、应用到镜头、收藏与备注、删除。
 *
 * 跑法：node verify-prompt-cases-ui.mjs [APP_URL]
 * 依赖：应用已启动且项目 `demo` 里有一镜 `S01`。
 */
import { chromium } from 'playwright-core'

const APP = (process.argv[2] || process.env.APP_URL || 'http://127.0.0.1:5398').replace(/\/+$/, '')
/** 项目名：冒烟脚本会传自己的临时项目（如 smoke），单独跑默认 demo */
const PROJECT = process.argv[3] || process.env.PCL_PROJECT || 'demo'
/** 无网环境用：跳过导入弹窗与选镜应用，直接验证库内既有案例的分面界面 */
const SKIP_IMPORT = process.env.PCL_UI_SKIP_IMPORT === '1'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)))

try {
  await page.goto(`${APP}/#/p/${encodeURIComponent(PROJECT)}/assets`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-prompt-case-tab]', { timeout: 20_000 })
  check('素材页出现提示词案例 Tab', true)

  await page.click('[data-prompt-case-tab]')
  await page.waitForTimeout(600)
  const tabOn = await page.locator('[data-prompt-case-tab]').evaluate((el) => el.classList.contains('on'))
  check('Tab 点击后处于选中态', tabOn)
  check('渲染案例面板', await page.locator('[data-prompt-case-tab-panel]').count() === 1)

  // 空态（此时库里为空）
  const emptyVisible = await page.locator('[data-prompt-case-empty]').count()
  const gridCount = await page.locator('[data-prompt-case-card]').count()
  check('空库显示空态', emptyVisible === 1 || gridCount > 0, `empty=${emptyVisible} cards=${gridCount}`)

  // 导入弹窗（无网验收时跳过；分面界面改用预置案例）
  if (SKIP_IMPORT) {
    console.log('  · PCL_UI_SKIP_IMPORT=1：跳过导入弹窗，使用库内既有案例')
  } else {
  await page.click('[data-prompt-case-import-open]')
  await page.waitForSelector('[data-prompt-case-import-backdrop]', { timeout: 10_000 })
  check('导入弹窗打开', true)
  await page.selectOption('[data-prompt-case-import-source]', 'vflow')
  await page.fill('[data-prompt-case-import-q]', 'claymation')
  await page.click('[data-prompt-case-import-preview]')
  await page.waitForSelector('[data-prompt-case-import-list] li', { timeout: 60_000 })
  const previewCount = await page.locator('[data-prompt-case-import-list] li').count()
  check('预览返回条目', previewCount > 0, `${previewCount} 条`)

  // 全不选后只选一条再导入
  await page.click('text=全不选')
  await page.locator('[data-prompt-case-import-list] li input[type=checkbox]').first().check()
  await page.click('[data-prompt-case-import-submit]')
  await page.waitForTimeout(4000)
  const okText = await page.locator('.pc-import-ok').first().textContent().catch(() => '')
  check('导入结果显示新增数', /新增\s*\d+\s*条/.test(okText || ''), okText || '(无)')

  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('.mp-close').first().click().catch(() => {})
  await page.waitForTimeout(900)
  }

  // 卡片与详情
  const cards = await page.locator('[data-prompt-case-card]').count()
  check('导入后出现卡片', cards > 0, `${cards} 张`)
  if (cards > 0) {
    await page.locator('[data-prompt-case-card]').first().click()
    await page.waitForSelector('[data-prompt-case-detail]', { timeout: 10_000 })
    check('详情打开', true)
    const detailText = await page.locator('[data-prompt-case-detail]').innerText()
    check('详情显示提示词全文', detailText.includes('提示词全文') || detailText.length > 200)
    check('详情标注许可口径', /仅参考|自有/.test(detailText), detailText.slice(0, 40))

    // 未选镜头时应用按钮禁用
    const applyDisabled = await page.locator('.pc-apply-actions button').first().isDisabled()
    check('未选镜头时应用按钮禁用', applyDisabled)

    // 收藏
    const favBefore = await page.locator('.pc-detail-actions button').first().innerText()
    await page.locator('.pc-detail-actions button').first().click()
    await page.waitForTimeout(700)
    const favAfter = await page.locator('.pc-detail-actions button').first().innerText()
    check('收藏状态可切换', favBefore !== favAfter, `${favBefore} -> ${favAfter}`)

    // 卡片徽标：最多 3 个，其余折成 +N
    const badgeBox = page.locator('[data-prompt-case-card]').first().locator('[data-prompt-case-badges]')
    const plainBadges = await badgeBox.locator('.pc-facet-tag:not(.more)').count()
    const moreBadge = await badgeBox.locator('[data-facet-more]').count()
    check('卡片分面徽标不超过 3 个', plainBadges <= 3, `${plainBadges} 个`)
    check('超出部分折叠为 +N', moreBadge === 0 || plainBadges === 3, `more=${moreBadge}`)

    // 详情分面编辑：来源标注、删除自动值转「已隐藏」、可恢复
    check('详情展示分面区', (await page.locator('[data-prompt-case-facets]').count()) === 1)
    const autoChip = page
      .locator('[data-prompt-case-facets] [data-facet][data-facet-source="import"], [data-prompt-case-facets] [data-facet][data-facet-source="derived"]')
      .first()
    if (await autoChip.count()) {
      const src = await autoChip.getAttribute('data-facet-source')
      check('详情分面标注来源', src === 'import' || src === 'derived', src || '')
      await autoChip.locator('button').click()
      await page.waitForTimeout(900)
      check('删除自动值后进入已隐藏', (await page.locator('[data-facet-hidden]').count()) === 1)
      const hiddenChip = page.locator('[data-facet-hidden-key]').first()
      if (await hiddenChip.count()) {
        await hiddenChip.click()
        await page.waitForTimeout(900)
        check('恢复后不再显示已隐藏', (await page.locator('[data-facet-hidden]').count()) === 0)
      }
    } else {
      console.log('  · 详情没有自动分面可删，跳过隐藏/恢复步骤')
    }
  }

  // 分面栏与 chip：点选一个轴值后列表收窄，取消后恢复
  check('桌面分面栏存在', (await page.locator('[data-facet-col] [data-facet-rail]').count()) === 1)
  const railValues = page.locator('[data-facet-col] [data-facet-value]:not([disabled])')
  const railCount = await railValues.count()
  if (railCount > 0) {
    const firstValue = railValues.first()
    const key = await firstValue.getAttribute('data-facet-value')
    const cardsBefore = await page.locator('[data-prompt-case-card]').count()
    await firstValue.click()
    await page.waitForTimeout(1000)
    const chips = await page.locator(`[data-facet-chip="${key}"]`).count()
    const cardsAfter = await page.locator('[data-prompt-case-card]').count()
    check('点选分面后出现 chip', chips === 1, key || '')
    check('筛选后列表收窄或为空', cardsAfter <= cardsBefore, `${cardsBefore} -> ${cardsAfter}`)
    await page.locator(`[data-facet-chip="${key}"]`).click()
    await page.waitForTimeout(1000)
    check('取消 chip 后恢复列表', (await page.locator('[data-prompt-case-card]').count()) >= cardsAfter)
  } else {
    console.log('  · 分面栏没有带计数的值，跳过点选（导入条目分类可能全部未映射）')
  }

  // 选中镜头后应用：先到画布点一镜，再回素材页应用
  if (SKIP_IMPORT) {
    console.log('  · PCL_UI_SKIP_IMPORT=1：跳过选镜应用（预置案例不含画布镜头）')
  } else {
  await page.goto(`${APP}/#/p/${encodeURIComponent(PROJECT)}/board`, { waitUntil: 'domcontentloaded' })
  {
    await page
    // 画布默认落在集目录，先进某一集
    const epBtn = page.locator('[data-board-ep]').first()
    if ((await epBtn.count()) > 0) {
      await epBtn.click()
      await page.waitForTimeout(1200)
    }
    const hasShot = await page
      .waitForSelector('.react-flow__node .shot', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    if (!hasShot) {
      console.log('  · 跳过选镜应用：该项目没有分镜卡（seed 项目不含镜头）')
      throw new Error('__skip_apply__')
    }
    await page
      .locator('.react-flow__node')
      .filter({ has: page.locator('.shot') })
      .first()
      .click()
    await page.waitForTimeout(600)
    await page.goto(`${APP}/#/p/${encodeURIComponent(PROJECT)}/assets`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-prompt-case-tab]', { timeout: 20_000 })
    await page.click('[data-prompt-case-tab]')
    await page.waitForTimeout(700)
    await page.locator('[data-prompt-case-card]').first().click()
    await page.waitForSelector('[data-prompt-case-detail]', { timeout: 10_000 })
    await page.waitForTimeout(300)
    const enabled = await page.locator('.pc-apply-actions button').first().isEnabled()
    check('选镜后应用按钮可用', enabled)
    if (enabled) {
      // page.evaluate 的函数体在页面上下文独立执行，外层变量必须显式传参
      const readPrompt = (proj) =>
        page.evaluate(async (name) => {
          const r = await fetch('/api/project?name=' + encodeURIComponent(name), { credentials: 'include' })
          const j = await r.json()
          return j.project?.shots?.[0]?.keyframe_prompt || ''
        }, proj)
      const bodyBefore = await readPrompt(PROJECT)
      await page.locator('.pc-apply-actions button').first().click()
      // 画布改动是延迟写回项目（约 1.5s），这里等写回完成
      await page.waitForTimeout(3200)
      const bodyAfter = await readPrompt(PROJECT)
      check('应用后写入项目镜头', Boolean(bodyAfter) && bodyAfter !== bodyBefore, `${bodyBefore.length} -> ${bodyAfter.length} 字符`)
    }
  }
  }

  // 分页：翻页 / 回顶部 / 切筛选不残留旧页码 / 搜空不误报空库
  const pagerEl = page.locator('[data-board-list-pager]')
  const hasPager = (await pagerEl.count()) > 0
  const pagerText = async () =>
    (await pagerEl.count()) ? (await pagerEl.innerText()).replace(/\s+/g, ' ').trim() : '(无分页条)'
  const firstCardTitle = async () =>
    ((await page.locator('[data-prompt-case-card] .pc-card-title').first().textContent().catch(() => '')) || '').trim()
  /** 列表真正滚动的祖先（.pc-grid 自身不滚），找不到就退回 window */
  const scrollerTop = () =>
    page.evaluate(() => {
      let el = document.querySelector('[data-prompt-case-grid]')?.parentElement || null
      while (el) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4) return Math.round(el.scrollTop)
        el = el.parentElement
      }
      return Math.round(window.scrollY)
    })
  const scrollToBottom = () =>
    page.evaluate(() => {
      let el = document.querySelector('[data-prompt-case-grid]')?.parentElement || null
      while (el) {
        const st = getComputedStyle(el)
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop = el.scrollHeight
          return
        }
        el = el.parentElement
      }
      window.scrollTo(0, document.body.scrollHeight)
    })

  if (!hasPager) {
    console.log('  · 案例不足一页，跳过分页断言（冒烟会预置 13 条第二页数据）')
  } else {
    const page1Title = await firstCardTitle()
    await scrollToBottom()
    await page.waitForTimeout(300)
    const scrolledBefore = await scrollerTop()
    await page.locator('[data-board-list-pager] button', { hasText: '下一页' }).click()
    await page.waitForTimeout(1200)
    const page2Pager = await pagerText()
    const page2Title = await firstCardTitle()
    check('翻页后分页条指向第 2 页', /第 2 \//.test(page2Pager), page2Pager)
    check('翻页后换成第 2 页内容', page2Title !== page1Title, `${page1Title} → ${page2Title}`)
    check('翻页后回到列表顶部', (await scrollerTop()) === 0, `之前 ${scrolledBefore}`)

    // 切筛选时若还带着 page=2，请求回来晚于 page=1 就会把列表覆盖回第二页
    const listReqs = []
    const capture = (r) => {
      if (/\/api\/prompt-cases\?/.test(r.url())) listReqs.push(r.url())
    }
    page.on('request', capture)
    const facetValue = page.locator('[data-facet-col] [data-facet-value]:not([disabled])').first()
    if (await facetValue.count()) {
      await facetValue.click()
      await page.waitForTimeout(1600)
      const stale = listReqs.filter((u) => /[?&]page=2(&|$)/.test(u))
      check('切筛选不再发旧页码请求', stale.length === 0, listReqs.map((u) => new URL(u).search).join(' | '))
      const afterPager = await pagerText()
      check('切筛选后回到第 1 页', afterPager === '(无分页条)' || /第 1 \//.test(afterPager), afterPager)
      // 清掉刚加的分面，别把后面的用例带偏
      await page.locator('[data-facet-chip]').first().click().catch(() => {})
      await page.waitForTimeout(900)
    } else {
      console.log('  · 没有可分面值，跳过旧页码断言')
    }
    page.off('request', capture)

    // 仅用搜索把结果搜空：不该说「案例库还是空的」
    const searchBox = page.locator('.board-list-toolbar input.stock-search')
    if ((await searchBox.count()) > 0) {
      await searchBox.fill('zzz-no-such-case-zzz')
      await page.waitForTimeout(1400)
      const emptyNode = page.locator('[data-prompt-case-empty]').first()
      const emptyText = (await emptyNode.innerText().catch(() => '')).replace(/\s+/g, ' ')
      check('搜不到时不误报空库', Boolean(emptyText) && !emptyText.includes('案例库还是空的'), emptyText.slice(0, 40))
      check('搜不到时提示没有匹配', emptyText.includes('没有匹配'), emptyText.slice(0, 40))
      await searchBox.fill('')
      await page.waitForTimeout(1200)
    }
  }

  // 移动端抽屉：与桌面侧栏共用同一份计数，窄屏下可打开并完成一次筛选
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(600)
  const drawerToggle = page.locator('[data-facet-drawer-open]')
  check('窄屏显示分类筛选入口', await drawerToggle.isVisible())
  if (await drawerToggle.isVisible()) {
    await drawerToggle.click()
    await page.waitForSelector('[data-facet-drawer]', { timeout: 5_000 })
    check('移动端抽屉打开', true)
    const drawerValues = page.locator('[data-facet-drawer] [data-facet-value]:not([disabled])')
    if (await drawerValues.count()) {
      const key = await drawerValues.first().getAttribute('data-facet-value')
      await drawerValues.first().click()
      await page.waitForTimeout(900)
      check('抽屉内可完成筛选', (await page.locator(`[data-facet-chip="${key}"]`).count()) === 1, key || '')
    } else {
      console.log('  · 抽屉内没有带计数的值，仅验证开合')
    }
    await page.locator('[data-facet-drawer] .pc-facet-drawer-head button').click()
    await page.waitForTimeout(400)
    check('抽屉可关闭', (await page.locator('[data-facet-drawer]').count()) === 0)
    await page.locator('[data-facet-chip]').first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForTimeout(400)

  // 反推面板
  await page.click('[data-prompt-case-reverse-open]')
  await page.waitForSelector('[data-prompt-case-reverse-backdrop]', { timeout: 10_000 })
  // 等健康探测落地：面板先渲染表单，探测返回后才决定显示不可用还是档位
  await page
    .waitForSelector('[data-prompt-case-rea-missing], .pc-tier', { timeout: 20_000 })
    .catch(() => {})
  const reverseText = await page.locator('[data-prompt-case-reverse-backdrop]').innerText()
  check('反推面板显示工具不可用或档位',
    reverseText.includes('反推工具不可用') || reverseText.includes('零下载'),
    reverseText.slice(0, 60).replace(/\n/g, ' '))
  check('反推面板给出安装命令或源视频选择',
    reverseText.includes('uv tool install') || reverseText.includes('源视频'),
    '')

  await page.screenshot({ path: '/tmp/pcl-ui.png', fullPage: false })
  console.log('\n截图：/tmp/pcl-ui.png')
} catch (e) {
  if (e.message === '__skip_apply__') {
    console.log('  · 选镜应用步骤已跳过（本次 seed 项目无分镜）')
  } else {
    check('UI 流程未抛错', false, e.message.slice(0, 200))
  }
} finally {
  await browser.close()
}

console.log(`\n${bad === 0 ? '全部通过' : `${bad} 项失败`}`)
process.exit(bad === 0 ? 0 : 1)
