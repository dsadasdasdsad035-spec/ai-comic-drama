/**
 * 界面层真实验收：在 Electron 已启动的应用上，用浏览器点击走完整个知识库流程。
 *
 * 与 verify-knowledge-real-ui.mjs 的区别：那个自己起 server + 传 API 造数据；
 * 这个**只点界面**，验证用户实际看到与操作到的东西 ——
 * 上传按钮、文档清单、提问、流式回答、引用卡展开。
 *
 * 前置：应用在 KB_APP_BASE 上活着，且知识库已配置（桌面版内置时自动满足）。
 * 跑法：KB_APP_BASE=http://127.0.0.1:57835 node verify-knowledge-ui-real-click.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const BASE = String(process.env.KB_APP_BASE || 'http://127.0.0.1:57835').replace(/\/+$/, '')
const OUT = path.join(process.cwd(), 'out', 'kb-ui-click')
const PROJECT = String(process.env.KB_UI_PROJECT || `uic${Date.now().toString().slice(-5)}`)
const FIXTURE = '/tmp/kb-world.md'
fs.mkdirSync(OUT, { recursive: true })

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

async function api(p, init = {}) {
  const r = await fetch(BASE + p, init)
  const t = await r.text()
  try {
    return { status: r.status, body: JSON.parse(t) }
  } catch {
    return { status: r.status, body: t }
  }
}

// 准备工作：建项目（界面没提供「建项目」之外的知识库初始化，项目要先存在）
const made = await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '界面点击验收' }),
})
if (!made.body?.ok) {
  console.error('建项目失败（用已有的项目测也行，跳过建项目）:', made.body?.message)
}
if (!fs.existsSync(FIXTURE)) {
  console.error(`缺少素材：${FIXTURE}`)
  process.exit(2)
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  // ---------------------------------------------------------------- 打开视图
  await page.goto(`${BASE}/#/p/${PROJECT}/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-view]', { timeout: 30_000 })
  check('从地址栏直达知识库视图', true)

  check('未落入「未配置」引导页', (await page.locator('[data-knowledge-unconfigured]').count()) === 0)

  // 等加载完成（清单容器出现且 loading 结束）
  await page.waitForSelector('[data-knowledge-doc-list]', { timeout: 30_000 })
  await page.waitForTimeout(2500)

  // ---------------------------------------------------------------- 上传（点界面）
  const uploadInput = page.locator('[data-knowledge-upload] input[type=file]')
  check('上传控件存在（label 包着隐藏 input）', (await uploadInput.count()) === 1)
  await uploadInput.setInputFiles(FIXTURE)

  // 等清单出现该文档（最多 120 秒：解析要跑 collector + embedder）
  await page.waitForFunction(
    () => document.querySelectorAll('[data-knowledge-doc-row]').length > 0,
    { timeout: 180_000 },
  )
  const rows = await page.locator('[data-knowledge-doc-row]').count()
  check('上传后清单出现文档', rows >= 1, `${rows} 行`)

  const rowText = await page.locator('[data-knowledge-doc-row]').first().innerText()
  check('文档行显示文件名', /kb-world\.md/.test(rowText), rowText.replace(/\n/g, ' ').slice(0, 60))

  await page.screenshot({ path: path.join(OUT, '01-uploaded.png'), fullPage: true })

  // ---------------------------------------------------------------- 等向量就绪
  // 太早提问会拿到「库里没有相关内容」——用户实际踩过的坑，所以这里显式等
  let ready = false
  for (let i = 0; i < 40; i++) {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, query: '沈砚 雨夜巷口', topN: 3 }),
    })
    if ((r.body?.hits || []).length > 0) {
      ready = true
      break
    }
    await page.waitForTimeout(3000)
  }
  check('向量化就绪（检索能命中）', ready)

  // ---------------------------------------------------------------- 提问（点界面）
  await page.locator('[data-knowledge-question]').fill('沈砚在哪一场正式登场？只回答场合名')
  await page.locator('[data-knowledge-ask]').click()

  // 等助手消息出现且不再处于「回答中」
  await page.waitForFunction(
    () => {
      const bodies = [...document.querySelectorAll('.kb-msg.is-assistant .kb-msg-body')]
      const last = bodies[bodies.length - 1]
      const btn = document.querySelector('[data-knowledge-ask]')
      return Boolean(last && last.textContent.trim()) && Boolean(btn && !btn.disabled)
    },
    { timeout: 180_000 },
  ).catch(() => {})
  await page.waitForTimeout(3500)

  const answer = await page.locator('.kb-msg.is-assistant .kb-msg-body').last().innerText()
  check('回答渲染出「雨夜巷口」', /雨夜巷口/.test(answer), answer.slice(0, 60))
  check('回答无 <think> 泄漏', !/<think/i.test(answer), answer.slice(0, 50))

  // ---------------------------------------------------------------- 引用卡
  const cites = page.locator('[data-knowledge-cites]')
  check('渲染了引用卡', (await cites.count()) >= 1, `${await cites.count()} 个`)

  // 默认收起：片段内容不该可见
  const collapsed = await cites.last().evaluate((el) => !el.hasAttribute('open'))
  check('引用卡默认收起（不挤占回答）', collapsed)

  if ((await cites.count()) >= 1) {
    await cites.last().locator('summary').click()
    await page.waitForTimeout(500)
    const citeText = await cites.last().innerText()
    check('展开后看到片段', citeText.length > 30, `${citeText.length} 字符`)
    check('引用片段不含 <document_metadata>', !/document_metadata/i.test(citeText))
    check('引用片段含真实内容', /沈砚|符牌|雨夜巷口|猎魔人/.test(citeText), citeText.replace(/\n/g, ' ').slice(0, 70))
  }

  await page.screenshot({ path: path.join(OUT, '02-answer.png'), fullPage: true })

  // ---------------------------------------------------------------- 历史回读
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-doc-row]', { timeout: 30_000 })
  await page.waitForTimeout(3000)
  const msgs = await page.locator('.kb-msg').count()
  check('刷新后历史从上游回读', msgs >= 2, `${msgs} 条`)
  const histText = await page.locator('.kb-messages').innerText()
  check('回读历史无 <think> 残留', !/<think/i.test(histText))

  // ---------------------------------------------------------------- 移除（点界面）
  const beforeRows = await page.locator('[data-knowledge-doc-row]').count()
  await page.locator('[data-knowledge-doc-row]').first().locator('button', { hasText: '移出' }).click()
  await page.waitForTimeout(4000)
  const afterRows = await page.locator('[data-knowledge-doc-row]').count()
  check('点「移出」后清单减少', afterRows < beforeRows, `${beforeRows} → ${afterRows}`)

  await page.screenshot({ path: path.join(OUT, '03-removed.png'), fullPage: true })
} finally {
  await browser.close()
  const del = await api(`/api/project?name=${PROJECT}`, { method: 'DELETE' })
  console.log(`\n清理：删除测试项目 ${PROJECT} → ${del.body?.ok ? '成功' : '失败'}`)
}

console.log(bad ? `\n${bad} 项失败` : '\n界面点击验收全部通过')
process.exit(bad ? 1 : 0)
