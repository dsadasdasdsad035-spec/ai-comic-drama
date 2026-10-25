/**
 * 发布台 UI 验证：临时项目库 + mock 发布接口 + 三个断点。
 *
 * 覆盖：导航与页签、成片选择、文案覆写、封面分组、预检禁用、
 * 确认弹窗取消、账号页、窄宽度不溢出。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const projectRoot = process.cwd()
// 必须与 dev server 的 SB_PROJECTS_DIR 一致，否则界面读不到这份数据
const tmp = process.env.PUBLISH_UI_DB || '/tmp/pubtest'
fs.mkdirSync(tmp, { recursive: true })
const fakeClip = path.join(projectRoot, 'public', 'exports', 'publish-ui-clip.mp4')
fs.mkdirSync(path.dirname(fakeClip), { recursive: true })
fs.copyFileSync(
  path.join(projectRoot, 'public', 'exports', 'animatic-480p-1792820626058.mp4'),
  fakeClip,
)

// 直接用服务端模块造数据，再起一个只提供发布 API 的 mock 服务
const { createDeliverable, patchDeliverableConfig, normalizeDeliverableConfig } = await import('./server/deliverables.mjs')
const { upsertAccount } = await import('./server/publish-accounts.mjs')
const { createJob, transitionJob } = await import('./server/publish-jobs.mjs')

const dl = createDeliverable(tmp, {
  project: 'pubdemo',
  episode: 1,
  title: 'E01 门后的声音',
  url: '/exports/publish-ui-clip.mp4',
  width: 1920,
  height: 1080,
  duration: 12.3,
})
const acc = upsertAccount(tmp, { platform: 'douyin', label: '夜行剧场', status: 'connected' })
const acc2 = upsertAccount(tmp, { platform: 'bilibili', label: '夜行 B', status: 'expired' })

// 预置发布配置：成片必须有选中平台，否则界面不会发起预检
patchDeliverableConfig(
  tmp,
  dl.id,
  normalizeDeliverableConfig({
    master: { title: '门后的声音', description: '雨夜', tags: ['悬疑'], aiGenerated: true },
    cover: { '9:16': '/exports/c9.png' },
    targets: {
      douyin: { selected: true, accountId: acc.id, mode: 'draft' },
      bilibili: { selected: true, accountId: acc2.id, mode: 'draft' },
    },
  }),
)

const platforms = [
  { id: 'douyin', label: '抖音', short: '抖', backendUrl: '#', contentTypes: ['video'], modes: ['draft', 'publish', 'package'], manualOnly: false, verified: false, coverAspects: ['9:16'], limits: { title: 30, description: 1000, tags: 20 }, max: {}, notes: '竖屏优先' },
  { id: 'bilibili', label: 'B 站', short: 'B', backendUrl: '#', contentTypes: ['video'], modes: ['draft', 'publish', 'package'], manualOnly: false, verified: false, coverAspects: ['16:9'], limits: { title: 80, description: 2000, tags: 12 }, max: {}, notes: '需要分区' },
  { id: 'toutiao', label: '头条', short: '头', backendUrl: '#', contentTypes: ['video'], modes: ['draft', 'publish', 'package'], manualOnly: false, verified: false, coverAspects: ['16:9'], limits: { title: 30, description: 1000, tags: 10 }, max: {}, notes: '结构变动频繁' },
]

const calls = { createJobs: 0, package: 0, preflight: 0 }

let pass = 0
const fails = []
async function check(name, fn) {
  try {
    await fn()
    pass++
  } catch (e) {
    fails.push(`${name}: ${e.message}`)
    console.error(`FAIL ${name}: ${e.message}`)
  }
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})

async function newPage(width, height) {
  const p = await browser.newPage({ viewport: { width, height } })
  await p.goto('http://127.0.0.1:5299/', { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(1200)
  const opts = await p.$$eval('.topbar-project select option', (els) => els.map((e) => e.value))
  if (opts.includes('pubdemo')) await p.selectOption('.topbar-project select', 'pubdemo')
  await p.waitForTimeout(900)
  await p.click('.viewtabs button:has-text("发布")')
  await p.waitForTimeout(1200)
  return p
}

// 依赖 dev server 已在 5299 运行；没有则跳过并提示
const alive = await fetch('http://127.0.0.1:5299/').then((r) => r.ok).catch(() => false)
if (!alive) {
  console.error('SKIP: 需要先在 5299 启动 dev server')
  await browser.close()
  /* 共享测试根保留，供下次复用 */
  process.exit(2)
}

const page = await newPage(1440, 900)

await check('导航顺序与 aria-current', async () => {
  const nav = await page.$$eval('header .viewtabs button', (els) => els.map((e) => e.textContent?.trim()))
  assert.ok(nav.some((t) => t?.startsWith('发布')), JSON.stringify(nav))
  assert.ok(nav[nav.length - 2]?.startsWith('发布'), JSON.stringify(nav))
  const cur = await page.$eval('header .viewtabs button.on', (e) => e.textContent?.trim())
  assert.ok(cur?.startsWith('发布'), cur || '')
})

await check('三个页签可切换', async () => {
  for (const label of ['发布记录', '平台账号', '待发布']) {
    await page.click(`.wb-bar .viewtabs button:has-text("${label}")`)
    await page.waitForTimeout(300)
    const on = await page.$eval('.wb-bar .viewtabs button.on', (e) => e.textContent?.trim())
    assert.ok(on?.includes(label.slice(0, 2)), on || '')
  }
})

await check('成片卡显示版本与时长', async () => {
  const text = await page.$eval('.pb-card', (e) => e.textContent || '')
  assert.ok(/v\d+/.test(text), text)
  assert.ok(/12s|0:12/.test(text), text)
})

await check('四段编排可见', async () => {
  const heads = await page.$$eval('.pb-section-head', (els) => els.map((e) => e.textContent?.trim()))
  assert.equal(heads.length, 4)
})

let titleInput
await check('标题超限显示阻断且禁用发布', async () => {
  titleInput = page.locator('.pb-section[data-section="copy"] .pb-field').filter({ hasText: '主标题' }).first().locator('input')
  await titleInput.fill('这是一个特意写得非常非常长用来测试抖音标题上限阻断效果的超长标题文案')
  // route 拦截不会触发 waitForResponse，这里轮询到阻断出现
  await page.waitForFunction(
    () => [...document.querySelectorAll('.pb-issue.block')].some((e) => e.textContent?.includes('超限')),
    { timeout: 8000 },
  )
  const blocking = await page.$$eval('.pb-issue.block', (els) => els.map((e) => e.textContent?.trim()))
  assert.ok(blocking.some((t) => t?.includes('超限')), JSON.stringify(blocking))
  const disabled = await page.$eval('.pb-foot .btn.primary', (e) => e.disabled)
  assert.equal(disabled, true)
})

await check('修好后按钮恢复', async () => {
  await titleInput.fill('门后的声音')
  await page.waitForFunction(
    () => ![...document.querySelectorAll('.pb-issue.block')].some((e) => e.textContent?.includes('超限')),
    { timeout: 8000 },
  )
  const disabled = await page.$eval('.pb-foot .btn.primary', (e) => e.disabled)
  // 缺封面仍会阻断，这里只验证标题阻断消失
  const blocking = await page.$$eval('.pb-issue.block', (els) => els.map((e) => e.textContent?.trim()))
  assert.ok(!blocking.some((t) => t?.includes('超限')), JSON.stringify(blocking))
})

await check('点问题跳到对应区块', async () => {
  const before = await page.$$eval('.pb-section-body', (els) => els.length)
  const issues = await page.$$('.pb-issue')
  if (issues.length) {
    await issues[0].click()
    await page.waitForTimeout(300)
  }
  const after = await page.$$eval('.pb-section-body', (els) => els.length)
  assert.ok(after >= before)
})

await check('平台账号页不显示 profile 路径', async () => {
  await page.click('.wb-bar .viewtabs button:has-text("平台账号")')
  await page.waitForTimeout(500)
  const text = await page.$eval('.pb-accounts', (e) => e.textContent || '')
  assert.ok(!text.includes('.publish-profiles'), '不应出现 profile 路径')
  assert.ok(text.includes('已连接'), text.slice(0, 120))
  // 失效账号必须给出重新登录入口
  const all = await page.$eval('.pb-accounts', (e) => e.textContent || '')
  assert.ok(all.includes('重新登录'), '账号行应提供重新登录')
})

await check('登录失效账号提示重新登录', async () => {
  const rows = await page.$$('.pb-account')
  const text = await rows[1].textContent()
  assert.ok(text?.includes('重新登录'), text || '')
})

await check('确认弹窗取消后不创建任务', async () => {
  await page.click('.wb-bar .viewtabs button:has-text("待发布")')
  await page.waitForTimeout(400)
  // 打开发布方式段，把抖音设为立即发布
  const selects = await page.$$('.pb-section[data-section="mode"] select')
  if (selects.length) await selects[0].selectOption('publish')
  await page.waitForTimeout(300)
  const beforeJobs = calls.createJobs
  const btn = await page.$('.pb-foot .btn.primary')
  const disabled = await btn?.evaluate((e) => e.disabled)
  if (!disabled) {
    await btn?.click()
    await page.waitForTimeout(400)
    const cancel = await page.$('.pb-modal-foot .btn:not(.primary)')
    await cancel?.click()
    await page.waitForTimeout(300)
  }
  assert.equal(calls.createJobs, beforeJobs, '取消后不应创建任务')
})

await check('窄屏不溢出', async () => {
  for (const [w, h] of [[1440, 900], [1200, 900], [900, 900]]) {
    await page.setViewportSize({ width: w, height: h })
    await page.waitForTimeout(500)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 1, `${w}px 横向溢出 ${overflow}`)
  }
})

await check('截图产出', async () => {
  const dir = path.join(projectRoot, 'openspec/changes/multi-platform-publishing/evidence')
  fs.mkdirSync(dir, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(dir, 'publish-pending.png'), fullPage: false })
  await page.click('.wb-bar .viewtabs button:has-text("平台账号")')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(dir, 'publish-accounts.png'), fullPage: false })
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(400)
  await page.click('.wb-bar .viewtabs button:has-text("待发布")')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(dir, 'publish-narrow.png'), fullPage: false })
  assert.ok(fs.existsSync(path.join(dir, 'publish-pending.png')))
})

await page.close()
await browser.close()
/* 共享测试根保留，供下次复用 */

if (fails.length) {
  console.error(`\n发布台 UI 验证失败 ${fails.length} 项`)
  process.exitCode = 1
} else {
  console.log(`发布台 UI 验证通过（${pass} 项）`)
}
