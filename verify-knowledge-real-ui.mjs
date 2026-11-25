/**
 * 知识库真实上游的浏览器验收（task 5.4 的 UI 部分）。
 *
 * 自包含：自己建项目、自己上传文档、自己提问、结束时清理，不依赖任何既存数据，
 * 也不假设上一次跑过的残留。跑在真实 AnythingLLM 上（不是 mock）。
 *
 * 前置：
 *   - 一个存活的 AnythingLLM（默认 127.0.0.1:3001）且已配好对话模型与 embedder
 *   - 一个跑着的应用实例（dev server 或 server/index.mjs），且它的知识库已配置
 *
 * 跑法：
 *   KB_APP_BASE=http://127.0.0.1:5400 node verify-knowledge-real-ui.mjs
 *
 * 会产生少量上游 LLM token 费用（2 次问答），不涉及 Seedance。
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const BASE = String(process.env.KB_APP_BASE || 'http://127.0.0.1:5400').replace(/\/+$/, '')
const OUT = path.join(process.cwd(), 'out', 'knowledge-real-ui')
const PROJECT = String(process.env.KB_UI_PROJECT || `kbrui${Date.now().toString().slice(-6)}`)
const MD_PATH = process.env.KB_MD_PATH || '/tmp/kb-verify-world.md'
const PDF_PATH = process.env.KB_PDF_PATH || '/tmp/kb-src.pdf'

fs.mkdirSync(OUT, { recursive: true })

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

async function api(pathname, init = {}) {
  const r = await fetch(BASE + pathname, init)
  const t = await r.text()
  try {
    return { status: r.status, body: JSON.parse(t) }
  } catch {
    return { status: r.status, body: t }
  }
}

// ---------------------------------------------------------------- 前置检查

const health = await api('/api/health')
if (health.status !== 200) {
  console.error(`应用不可达：${BASE}`)
  process.exit(2)
}

const kbSettings = await api('/api/knowledge/settings')
if (!kbSettings.body?.enabled) {
  console.error('知识库未配置：先到设置页填上游地址与 API Key')
  process.exit(2)
}
console.log(`应用：${BASE}`)
console.log(`上游：${kbSettings.body.baseUrl}`)

if (!fs.existsSync(MD_PATH)) {
  console.error(`缺少测试素材：${MD_PATH}`)
  process.exit(2)
}

// ---------------------------------------------------------------- 准备数据

console.log(`\n准备项目 ${PROJECT}`)
const created = await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '知识库真实UI验收' }),
})
if (!created.body?.ok) {
  console.error('建项目失败：', created.body)
  process.exit(2)
}

async function upload(file, mime) {
  const res = await fetch(
    `${BASE}/api/knowledge/upload?project=${encodeURIComponent(PROJECT)}&filename=${encodeURIComponent(path.basename(file))}`,
    { method: 'POST', headers: { 'Content-Type': mime }, body: fs.readFileSync(file) },
  )
  return res.json()
}

const upMd = await upload(MD_PATH, 'text/markdown')
check('上传 markdown', upMd?.ok === true, (upMd?.documents || []).map((d) => d.title).join(','))
let upPdf = null
if (fs.existsSync(PDF_PATH)) {
  upPdf = await upload(PDF_PATH, 'application/pdf')
  check('上传 PDF', upPdf?.ok === true, (upPdf?.documents || []).map((d) => d.title).join(','))
} else {
  console.log(`⚠️  跳过 PDF（找不到 ${PDF_PATH}）`)
}

// 等向量化：上传后 collector 解析 + embedder 写入需要时间，
// 太早提问会拿到「库里没有相关内容」—— 那正是用户实际踩过的坑。
async function waitVectorReady(maxMs = 90_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, query: '沈砚 雨夜巷口 符牌', topN: 3 }),
    })
    if ((r.body?.hits || []).length > 0) return true
    await new Promise((r2) => setTimeout(r2, 3000))
  }
  return false
}
const ready = await waitVectorReady()
check('向量化就绪（检索能命中）', ready)
if (!ready) console.log('   向量迟迟没写入，后面的问答很可能被上游判为「无相关内容」')

// ---------------------------------------------------------------- 浏览器验收

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  await page.goto(`${BASE}/#/p/${PROJECT}/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-view]', { timeout: 30_000 })
  check('知识库视图打开', true)

  // 已配置的前提下不该落到引导页
  check('未落到「未配置」引导页', (await page.locator('[data-knowledge-unconfigured]').count()) === 0)

  await page.waitForSelector('[data-knowledge-doc-row]', { timeout: 30_000 })
  const rows = await page.locator('[data-knowledge-doc-row]').count()
  const expectRows = upPdf ? 2 : 1
  check(`清单显示 ${expectRows} 份文档`, rows === expectRows, `实际 ${rows}`)

  // 真实提问 1：事实抽取
  await page.locator('[data-knowledge-question]').fill('沈砚在哪一场正式登场？只回答场合名')
  await page.locator('[data-knowledge-ask]').click()
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-knowledge-ask]')
      const bodies = [...document.querySelectorAll('.kb-msg.is-assistant .kb-msg-body')]
      const last = bodies[bodies.length - 1]
      return btn && !btn.disabled && last && last.textContent.trim().length > 0
    },
    { timeout: 180_000 },
  ).catch(() => {})
  await page.waitForTimeout(4000)

  const a1 = await page.locator('.kb-msg.is-assistant .kb-msg-body').last().innerText()
  check('回答答出「雨夜巷口」', /雨夜巷口/.test(a1), a1.slice(0, 70))
  check('回答无 <think> 泄漏', !/<think/i.test(a1), a1.slice(0, 50))
  check('渲染了引用卡', (await page.locator('[data-knowledge-cites]').count()) >= 1)

  // 引用卡默认收起：展开后才看得到片段，且片段里没有上游元数据头
  await page.locator('[data-knowledge-cites] summary').last().click()
  await page.waitForTimeout(400)
  const citeText = await page.locator('[data-knowledge-cites]').last().innerText()
  check('引用片段不含 <document_metadata>', !/document_metadata/i.test(citeText), citeText.slice(0, 60))
  check('引用片段含真实内容', /沈砚|符牌|雨夜巷口|猎魔人/.test(citeText))

  // 真实提问 2：另一轮，验历史累积
  await page.locator('[data-knowledge-question]').fill('核心道具是什么？只说道具名')
  await page.locator('[data-knowledge-ask]').click()
  await page.waitForTimeout(12_000)
  const a2 = await page.locator('.kb-msg.is-assistant .kb-msg-body').last().innerText()
  check('第二轮答出符牌相关', /符牌|镇|锁|焚/.test(a2), a2.slice(0, 70))
  check('第二轮无 <think> 泄漏', !/<think/i.test(a2))

  const msgs = await page.locator('.kb-msg').count()
  check('两轮问答共 4 条消息', msgs >= 4, `${msgs} 条`)

  await page.screenshot({ path: path.join(OUT, 'real-e2e.png'), fullPage: true })

  // 重开页面验历史回读（历史存在上游，不走本地副本）
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-doc-row]', { timeout: 30_000 })
  await page.waitForTimeout(3000)
  const afterReload = await page.locator('.kb-msg').count()
  check('刷新后历史从上游回读', afterReload >= 4, `${afterReload} 条`)
  const histText = await page.locator('.kb-messages').innerText()
  check('回读的历史无 <think> 残留', !/<think/i.test(histText))
} finally {
  await browser.close()

  // ---------------------------------------------------------------- 清理
  const docs = await api(`/api/knowledge/docs?project=${encodeURIComponent(PROJECT)}`)
  const locs = (docs.body?.documents || []).map((d) => d.location).filter(Boolean)
  if (locs.length) {
    const rm = await api('/api/knowledge/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, locations: locs }),
    })
    console.log(`\n清理：移出 ${rm.body?.removed ?? 0} 份文档`)
  }
  const del = await api(`/api/project?name=${PROJECT}`, { method: 'DELETE' })
  console.log(`清理：删除测试项目 ${PROJECT} → ${del.body?.ok ? '成功' : '失败'}`)
}

if (bad) {
  console.log(`\n${bad} 项失败`)
} else {
  console.log('\n真实上游浏览器验收全部通过')
}
process.exit(bad ? 1 : 0)
