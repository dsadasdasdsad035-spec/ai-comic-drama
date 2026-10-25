/**
 * 设置页 2.0 信息架构验收：
 * 分组导航、唯一渠道卡、模型库搜索、目录同步、两级默认路由、状态条。
 * 不保存设置；所有改动在最后 reload 丢弃。
 *
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-settings-ui-v2.mjs
 */
import { chromium } from 'playwright-core'

const APP = process.env.APP_URL || 'http://127.0.0.1:5280'
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.waitForSelector('.settings-shell')

  const navs = await page.locator('.st-nav button').allTextContents()
  check('分组导航', navs.some((x) => x.includes('渠道')) && navs.some((x) => x.includes('模型')) && navs.some((x) => x.includes('默认路由')), JSON.stringify(navs))
  check('渠道卡每个渠道只出现一次', (await page.locator('.st-prov[data-pid="ark"]').count()) === 1)
  check('APIMart 渠道卡', (await page.locator('.st-prov[data-pid="apimart"]').count()) === 1)
  const statusText = await page.locator('.st-statusbar').innerText()
  check('状态条可见', /缺 Key|余额不足|失效默认|正常/.test(statusText), statusText)

  await page.locator('button', { hasText: '+ 添加渠道' }).click()
  const addMenu = page.locator('.st-menu')
  check('添加渠道预设菜单', (await addMenu.locator('button').count()) >= 8, String(await addMenu.locator('button').count()))
  check('已存在的 APIMart 预置禁用', await addMenu.locator('button', { hasText: 'APIMart' }).isDisabled())
  await page.locator('.st-menu-backdrop').click({ position: { x: 8, y: 8 } })

  await page.locator('.st-nav button', { hasText: '模型' }).click()
  await page.waitForSelector('.st-model-table')
  const modelCount = await page.locator('.st-model-item').count()
  check('模型库一行一个模型', modelCount >= 8, String(modelCount))
  await page.locator('.st-search').first().fill('seedream')
  await page.waitForTimeout(200)
  check('模型库搜索', (await page.locator('.st-model-item').count()) >= 1)
  await page.locator('.st-search').first().fill('')
  const firstModel = page.locator('.st-model-item').first()
  await firstModel.locator('.st-model-caps-btn').click()
  check('模型能力编辑展开', (await firstModel.locator('.st-model-caps-editor').count()) === 1)

  // 目录同步：只同步一个模型，然后 reload 丢弃
  await page.locator('button', { hasText: '同步 APIMart 目录' }).click()
  await page.waitForTimeout(2500)
  if (await page.locator('.st-modal-error').count()) {
    const err = await page.locator('.st-modal-error').innerText()
    check('目录错误可读', /余额不足|Key|连不上|失败/.test(err), err)
  } else {
    const tabs = await page.locator('.st-tabs button').allTextContents()
    check('目录分类 tab', tabs.some((x) => x.includes('全部')) && tabs.some((x) => x.includes('视频')), JSON.stringify(tabs))
    check('目录条目数量', (await page.locator('.st-catalog-row').count()) > 50, String(await page.locator('.st-catalog-row').count()))
    await page.locator('.st-modal .st-search').fill('z-image-turbo')
    await page.waitForTimeout(200)
    const row = page.locator('.st-catalog-row', { hasText: 'z-image-turbo' }).first()
    await row.locator('input[type=checkbox]').check()
    await page.locator('.st-modal-foot button', { hasText: '清空' }).click()
    check('目录选择可清空', await page.locator('.st-modal-foot button.primary').isDisabled())
    await row.locator('input[type=checkbox]').check()
    await page.locator('.st-modal-foot button.primary').click()
    await page.waitForTimeout(300)
    check('目录同步结果计数', /新增|更新|跳过/.test(await page.locator('.st-catalog-result').innerText()))
    await page.locator('.st-modal-head button', { hasText: '✕' }).click()
  }

  // 两级默认路由
  await page.locator('.st-nav button', { hasText: '默认路由' }).click()
  await page.waitForTimeout(300)
  const textRow = page.locator('[data-routing-cap="text"]')
  await textRow.locator('select').nth(0).selectOption('apimart')
  await page.waitForTimeout(200)
  const textModels = await textRow.locator('select').nth(1).locator('option').allTextContents()
  check('渠道→模型两级下拉', textModels.some((x) => /GPT-5\.1/.test(x)), JSON.stringify(textModels.slice(0, 5)))
  await textRow.locator('select').nth(1).selectOption('apimart-text-gpt-5-1')
  await page.waitForTimeout(200)
  check('默认路由状态可用', (await textRow.locator('.st-routing-status').innerText()) === '可用')
  check('环节默认跟随文本默认', (await page.locator('[data-stage-model-select="script"]').inputValue()) === '')
  check('页面无脚本异常', errors.length === 0, errors[0] || '')
} finally {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await browser.close()
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
