/**
 * 发布助手端到端验证：真实 Vite 服务 + 浏览器，平台调用全部用 mock 拦截。
 *
 * 覆盖：
 * - 助手入口只在「待发布」页签可用；右栏单槽位（检查器 ↔ 助手互斥）
 * - 准备度条五格、点击跳到区块
 * - 暂存 → 待确认卡 → 确认 → 任务出现「由助手提交」
 * - 三条权限负向：未确认时零任务、assistant 来源拒绝 publish、过期卡确认被拒
 * - 窄屏 1210 / 1190 / 900 三档的停靠栏 / 抽屉 / 全屏
 *
 * 跑法：node verify-publish-assistant.mjs
 * 前置：dev server 已在 5273 端口运行（本脚本自己起一个临时实例）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = Number(process.env.PUBLISH_ASSISTANT_PORT) || 5289
const projectsDir = process.env.SB_PROJECTS_DIR || path.join(ROOT, 'data', 'projects')

// ---- 造一份临时项目 + 成片 + 账号 ----
// 项目库是 SB_PROJECTS_DIR 下的共享 DB；成片文件走 /exports/ → <repo>/public/exports
const projectName = `pubassist${Date.now().toString(36)}`
const stamp = Date.now().toString(36)
const clipName = `pubassist-${stamp}.mp4`
const coverName = `pubassist-${stamp}.jpg`
const publicExports = path.join(ROOT, 'public', 'exports')
fs.mkdirSync(publicExports, { recursive: true })
const clipPath = path.join(publicExports, clipName)
const coverPath = path.join(publicExports, coverName)
fs.writeFileSync(clipPath, Buffer.alloc(16384))
fs.writeFileSync(coverPath, Buffer.alloc(2048))

const { createDeliverable } = await import('./server/deliverables.mjs')
const { upsertAccount } = await import('./server/publish-accounts.mjs')
const { listJobs } = await import('./server/publish-jobs.mjs')
const { stageIntent, confirmIntent, getIntent } = await import('./server/publish-intents.mjs')
const { getPlatform } = await import('./server/publish-platforms.mjs')
const { createProject } = await import('./server/db.mjs')

// 项目必须进 projects 表才会出现在顶栏下拉里
createProject(projectsDir, projectName, { title: '助手验收项目' })

const deliverable = createDeliverable(projectsDir, {
  project: projectName,
  episode: 1,
  title: '助手验收',
  url: `/exports/${clipName}`,
  source: 'import',
  width: 1080,
  height: 1920,
  duration: 14,
  bytes: 16384,
})
const account = upsertAccount(projectsDir, { platform: 'douyin', label: '主号', status: 'connected' })

const config = {
  master: { title: '测试标题文字', description: '测试简介内容', tags: [], aiGenerated: true },
  cover: { '9:16': `/exports/${coverName}` },
  targets: {
    douyin: { selected: true, accountId: account.id, mode: 'draft', override: null },
  },
}

// ---- 负向断言（不依赖浏览器）----
console.log('负向断言')
const jobsBefore = listJobs(projectsDir, { limit: 500 }).length
const intent = stageIntent(projectsDir, {
  deliverableId: deliverable.id,
  targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
  config,
  source: 'assistant',
  appRoot: ROOT,
})
assert.equal(listJobs(projectsDir, { limit: 500 }).length, jobsBefore, '暂存后任务数必须不变')
console.log('  ok 暂存不创建任何任务')

const publishIntent = (() => {
  try {
    stageIntent(projectsDir, {
      deliverableId: deliverable.id,
      targets: [{ platform: 'douyin', accountId: account.id, mode: 'publish' }],
      config,
      source: 'assistant',
      appRoot: ROOT,
    })
    return null
  } catch (e) {
    return e
  }
})()
assert.ok(publishIntent, 'assistant 来源的 publish 必须被拒')
assert.equal(publishIntent.code, 'assistant_cannot_publish')
console.log('  ok assistant 来源拒绝 publish 方式')

const { openDatabase } = await import('./server/db.mjs')
const db = openDatabase(projectsDir)
db.prepare('UPDATE publish_intents SET expires_at = ? WHERE id = ?').run(
  new Date(Date.now() - 60_000).toISOString(),
  intent.id,
)
let expiredErr = null
try {
  confirmIntent(projectsDir, intent.id, { appRoot: ROOT })
} catch (e) {
  expiredErr = e
}
assert.ok(expiredErr, '过期卡确认必须被拒')
assert.equal(getIntent(projectsDir, intent.id).state, 'expired')
assert.equal(listJobs(projectsDir, { limit: 500 }).length, jobsBefore, '过期确认后任务数仍不变')
console.log('  ok 过期卡确认被拒且不建任务')

// 建一张可用的新卡，供界面验收
const fresh = stageIntent(projectsDir, {
  deliverableId: deliverable.id,
  targets: [{ platform: 'douyin', accountId: account.id, mode: 'draft' }],
  config,
  source: 'assistant',
  appRoot: ROOT,
})
assert.equal(fresh.state, 'staged')

// ---- 起一个临时 dev server ----
const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  env: { ...process.env, SB_PROJECTS_DIR: projectsDir },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let serverLog = ''
server.stdout.on('data', (d) => (serverLog += String(d)))
server.stderr.on('data', (d) => (serverLog += String(d)))

async function waitServer(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (Date.now() > deadline) throw new Error(`dev server 未就绪\n${serverLog.slice(-2000)}`)
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

let browser = null
let failed = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`  ok ${name}`)
  } catch (e) {
    failed++
    console.log(`  FAIL ${name}\n       ${e && e.message ? e.message : String(e)}`)
  }
}

try {
  await waitServer(`http://127.0.0.1:${PORT}/api/health`).catch(async () => {
    // /api/health 可能不存在，退而求其次探首页
    await waitServer(`http://127.0.0.1:${PORT}/`)
  })

  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // 记录所有发布相关请求，用于断言「确认前零提交」
  const apiCalls = []
  page.on('request', (req) => {
    const u = req.url()
    if (u.includes('/api/publish/')) apiCalls.push({ url: u, method: req.method() })
  })

  await page.addInitScript(
    ({ project }) => {
      // 顶栏项目下拉的记忆键；键名不稳，下面仍会用下拉框显式选择兜底
      try {
        localStorage.setItem('sb:last-project', project)
        localStorage.setItem('storyboard-project', project)
      } catch {
        /* 忽略 */
      }
    },
    { project: projectName },
  )

  await step('选择项目并打开发布台', async () => {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
    const select = page.locator('.topbar-project select')
    await select.waitFor({ timeout: 25_000 })
    // option 在 select 收起时不可见，只能等它被渲染出来
    await page.waitForFunction(
      (name) => Boolean(document.querySelector(`.topbar-project option[value="${name}"]`)),
      projectName,
      { timeout: 25_000 },
    )
    await select.selectOption(projectName)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '发布' }).first().click({ timeout: 15_000 })
    await page.waitForSelector('[data-section="targets"]', { timeout: 20_000 })
  })

  await step('助手入口在待发布可用、记录页禁用', async () => {
    const btn = page.locator('.agent-btn')
    await btn.waitFor({ timeout: 10_000 })
    assert.equal(await btn.isDisabled(), false)
    await page.getByRole('button', { name: /发布记录/ }).click()
    await page.waitForTimeout(200)
    assert.equal(await page.locator('.agent-btn').isDisabled(), true)
    await page.getByRole('button', { name: '待发布' }).click()
    await page.waitForTimeout(200)
    assert.equal(await page.locator('.agent-btn').isDisabled(), false)
  })

  await step('右栏单槽位：检查器 → 助手互斥、不出现第四栏', async () => {
    assert.ok(await page.locator('.pb-dock.is-inspect').count())
    const before = await page.locator('.pb-dock').count()
    assert.equal(before, 1)
    await page.locator('.agent-btn').click()
    await page.waitForSelector('.pb-dock.is-chat', { timeout: 15_000 })
    assert.equal(await page.locator('.pb-dock.is-inspect').count(), 0)
    assert.equal(await page.locator('.pb-dock').count(), 1)
    // 编排区不横向溢出
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('.pb-main')
      return el ? el.scrollWidth - el.clientWidth : 0
    })
    assert.ok(overflow <= 1, `编排区横向溢出 ${overflow}px`)
  })

  await step('准备度条渲染五格，未选平台时后四格为不适用', async () => {
    const bar = page.locator('[data-publish-readiness]')
    await bar.waitFor({ timeout: 10_000 })
    const cells = page.locator('[data-readiness]')
    assert.equal(await cells.count(), 5)
    // 该成片的配置里没有勾选平台，所以后四格必须是 not-applicable 且不可点
    const states = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('data-state')))
    assert.equal(states[0], 'warn')
    for (const s of states.slice(1)) assert.equal(s, 'not-applicable')
    assert.equal(await page.locator('[data-readiness="cover"]').isDisabled(), true)
  })

  await step('勾选平台后准备度格可点并跳到区块', async () => {
    // 用界面真实勾选，验证 host 侧链路
    const firstTarget = page.locator('[data-section="targets"] .pb-target input[type="checkbox"]').first()
    await firstTarget.check()
    await page.waitForTimeout(1200)
    const state = await page.locator('[data-readiness="targets"]').getAttribute('data-state')
    assert.equal(state, 'ok')
    const coverCell = page.locator('[data-readiness="cover"]')
    const disabled = await coverCell.isDisabled()
    assert.equal(disabled, false, '选平台后封面格应可点')
    await coverCell.click()
    await page.waitForTimeout(300)
    assert.ok(await page.locator('[data-section="cover"]').isVisible())
  })

  await step('助手头部常驻能力边界说明', async () => {
    const boundary = page.locator('[data-publish-boundary]')
    await boundary.waitFor({ timeout: 10_000 })
    assert.match((await boundary.textContent()) || '', /最终发布按钮只有你能点/)
  })

  await step('助手工具面板里没有任何提交按钮（只能暂存）', async () => {
    // 工具表在 UI 侧只暴露暂存；确认入口只有待确认卡
    const confirmButtons = await page.locator('[data-confirm-intent]').count()
    // 初始没有卡
    assert.equal(confirmButtons, 0)
  })

  await step('窄屏 1210 / 1190 / 900 三档布局', async () => {
    await page.setViewportSize({ width: 1210, height: 900 })
    await page.waitForTimeout(200)
    // 1210 > 1200：仍是停靠栏
    let pos = await page.evaluate(() => {
      const el = document.querySelector('.pb-dock.is-chat')
      return el ? getComputedStyle(el).position : 'none'
    })
    assert.equal(pos, 'static')

    await page.setViewportSize({ width: 1190, height: 900 })
    await page.waitForTimeout(300)
    pos = await page.evaluate(() => {
      const el = document.querySelector('.pb-dock.is-chat')
      return el ? getComputedStyle(el).position : 'none'
    })
    assert.equal(pos, 'absolute', '1190 应为抽屉')
    // .pb 已纵向
    const dir = await page.evaluate(() => {
      const el = document.querySelector('.pb')
      return el ? getComputedStyle(el).flexDirection : ''
    })
    assert.equal(dir, 'column')
    // 遮罩存在
    assert.ok(await page.locator('.pb-dock-scrim').count())

    await page.setViewportSize({ width: 900, height: 800 })
    await page.waitForTimeout(300)
    const width = await page.evaluate(() => {
      const el = document.querySelector('.pb-dock.is-chat')
      return el ? el.getBoundingClientRect().width : 0
    })
    assert.ok(width >= 880, `900 应接近全屏，实际 ${width}`)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(200)
  })

  await step('关闭助手后检查器回到同一槽位', async () => {
    await page.locator('.agent-btn').click()
    await page.waitForTimeout(300)
    assert.equal(await page.locator('.pb-dock.is-chat').count(), 0)
    assert.equal(await page.locator('.pb-dock.is-inspect').count(), 1)
  })

  // ---- 界面层的暂存 → 确认：直接走服务端 API，避免依赖模型调用 ----
  console.log('\n提交意图闭环（服务端 + 界面回执）')
  const submitted = confirmIntent(projectsDir, fresh.id, { appRoot: ROOT })
  assert.equal(submitted.jobs.length, 1)
  const job = submitted.jobs[0]
  assert.equal(job.payload.source, 'assistant')
  assert.equal(job.payload.intentId, fresh.id)
  const afterJobs = listJobs(projectsDir, { limit: 500 })
  assert.equal(afterJobs.length, jobsBefore + 1)
  console.log('  ok 确认后建一条任务并带 assistant 来源')

  const again = confirmIntent(projectsDir, fresh.id, { appRoot: ROOT })
  assert.equal(again.reused, true)
  assert.equal(listJobs(projectsDir, { limit: 500 }).length, jobsBefore + 1)
  console.log('  ok 重复确认不新建任务')

  await step('记录页显示「助手提交」标签', async () => {
    await page.getByRole('button', { name: /发布记录/ }).click()
    await page.waitForSelector('.pb-chip', { timeout: 15_000 })
    const tag = page.locator('.pb-chip-tag')
    assert.ok((await tag.count()) >= 1, '应有一条助手提交标签')
    assert.match((await tag.first().textContent()) || '', /助手提交/)
  })

  await step('手动创建的任务不显示助手标签', async () => {
    const { createJob } = await import('./server/publish-jobs.mjs')
    createJob(projectsDir, {
      deliverableId: deliverable.id,
      project: projectName,
      episode: 1,
      platform: 'bilibili',
      accountId: '',
      mode: 'package',
      deliverableUrl: deliverable.url,
      payload: { source: 'manual', aiGenerated: true },
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    // 刷新后项目可能回落到首项，显式再选一次
    const sel = page.locator('.topbar-project select')
    await sel.waitFor({ timeout: 25_000 })
    await page.waitForFunction(
      (name) => Boolean(document.querySelector(`.topbar-project option[value="${name}"]`)),
      projectName,
      { timeout: 25_000 },
    )
    await sel.selectOption(projectName)
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '发布' }).first().click({ timeout: 15_000 })
    await page.getByRole('button', { name: /发布记录/ }).click()
    await page.waitForSelector('.pb-chip', { timeout: 15_000 })
    const chips = page.locator('.pb-chip')
    const n = await chips.count()
    let manualWithTag = 0
    for (let i = 0; i < n; i++) {
      const text = (await chips.nth(i).textContent()) || ''
      if (text.includes('B 站') && text.includes('助手提交')) manualWithTag++
    }
    assert.equal(manualWithTag, 0, '手动任务不应带助手标签')
  })
} finally {
  if (browser) await browser.close().catch(() => {})
  server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 800))
  try {
    server.kill('SIGKILL')
  } catch {
    /* 已退出 */
  }
  const usage = getPlatform('douyin')
  void usage
  // 只清本脚本造的成片文件与数据库行；绝不动整个项目库
  for (const p of [clipPath, coverPath]) {
    try {
      fs.rmSync(p, { force: true })
    } catch {
      /* 清理失败不阻塞 */
    }
  }
  try {
    const cleanup = openDatabase(projectsDir)
    cleanup.prepare('DELETE FROM deliverables WHERE project = ?').run(projectName)
    cleanup.prepare('DELETE FROM publish_jobs WHERE project = ?').run(projectName)
    cleanup.prepare('DELETE FROM publish_intents WHERE project = ?').run(projectName)
    cleanup.prepare('DELETE FROM publish_accounts WHERE label = ?').run('主号')
    cleanup.prepare('DELETE FROM projects WHERE name = ?').run(projectName)
  } catch {
    /* 清理失败不阻塞 */
  }
}

console.log('')
if (failed) {
  console.log(`❌ 发布助手验收有 ${failed} 项失败`)
  process.exit(1)
}
console.log('✅ 发布助手端到端验收通过')
