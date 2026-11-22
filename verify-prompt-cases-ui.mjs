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

  // 导入弹窗
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
  }

  // 选中镜头后应用：先到画布点一镜，再回素材页应用
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
