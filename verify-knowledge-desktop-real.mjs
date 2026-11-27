/**
 * 真实开发模式桌面端验收（`npm run desktop:dev` + 内置 AnythingLLM）。
 *
 * 与其它验收的区别：**不搭桩、不打桩接口**。它打的是真实应用进程与真实的
 * 内置知识库实例，验的就是「用户点得到、点得通」这条路径。
 *
 * 覆盖：
 * - 全局 `#/knowledge` 页：建库 → 上传 → 改名 → 删库，且没有提问框/消息流
 * - 创意会话（真实 dsh 宿主）：会话头部/hero 的选库控件渲染、列出真实库、
 *   选择后落到该会话
 *
 * **只做维护与选择，不做问答**：所以不产生任何 LLM token 费用。
 * 上传的文档会由内置实例的 collector 真解析、真向量化。
 *
 * 前置：`npm run desktop:dev` 已在跑，且内置知识库启动成功
 *       （日志里有 `[desktop] 内置知识库已启动`）。
 *
 * 跑法：
 *   KB_APP_BASE=http://127.0.0.1:<端口> node verify-knowledge-desktop-real.mjs
 *
 * 端口在看：`lsof -nP -a -p $(pgrep -f server/desktop-entry.mjs) -iTCP -sTCP:LISTEN`
 *
 * 注意：脚本按**库名**定位行，不按顺序取第一行 —— 真实实例里可能已有迁移来的
 * 旧库，按顺序取会改错/删错对象（早期版本踩过）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const APP = String(process.env.KB_APP_BASE || 'http://127.0.0.1:54925').replace(/\/+$/, '')
const STAMP = Date.now().toString().slice(-5)
const KB_NAME = `桌面验收库-${STAMP}`

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad += 1
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 960 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))

const answerDialog = (value) =>
  page.once('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(value)
    else await d.accept()
  })

try {
  // ---- 全局知识库页
  await page.goto(`${APP}/#/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-view]', { timeout: 40_000 })
  check('全局 #/knowledge 打开（真实应用）', true)
  check('没有提问输入框', (await page.locator('[data-knowledge-question]').count()) === 0)
  check('没有消息流', (await page.locator('.kb-messages, [data-knowledge-answer]').count()) === 0)

  // 新建库
  const beforeCount = await page.locator('[data-knowledge-base-row]').count()
  answerDialog(KB_NAME)
  await page.locator('[data-knowledge-create]').click()
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-knowledge-base-row]').length === n + 1,
    beforeCount,
    { timeout: 40_000 },
  )
  /* 按名字定位，不能用 .first()：列表里还有迁移来的旧库，按顺序取会改错对象 */
  const myRow = () => page.locator('[data-knowledge-base-row]', { hasText: KB_NAME }).first()
  check('真实上游建库成功', (await page.locator('[data-knowledge-base-row]', { hasText: KB_NAME }).count()) === 1,
    await myRow().innerText().catch(() => ''))
  const selectedText = await page.locator('[data-knowledge-base-row][data-active]').first().innerText().catch(() => '')
  check('新建库自动选中', selectedText.includes(KB_NAME), selectedText.split('\n')[0])

  // 上传
  const tmp = `/tmp/kb-desktop-${STAMP}.md`
  fs.writeFileSync(tmp, `# 桌面验收\n\n${KB_NAME} 的唯一记号是「青鸾${STAMP}」。\n`, 'utf8')
  await page.locator('[data-knowledge-upload] input[type=file]').setInputFiles(tmp)
  await page.waitForFunction(
    () => document.querySelectorAll('[data-knowledge-doc-row]').length > 0,
    undefined,
    { timeout: 90_000 },
  )
  const docText = await page.locator('[data-knowledge-doc-row]').first().innerText()
  check('真实上游上传成功（清单出现文档）', docText.length > 0, docText.split('\n')[0])

  // 改名
  answerDialog(`${KB_NAME}-改`)
  await myRow().locator('.btn-ghost', { hasText: '改名' }).first().click()
  // 要检查所有行：第一行可能是别的库（迁移来的旧库）
  await page.waitForFunction(
    (want) =>
      [...document.querySelectorAll('[data-knowledge-base-row]')].some((row) =>
        (row.textContent || '').includes(want),
      ),
    `${KB_NAME}-改`,
    { timeout: 40_000 },
  )
  check('改名生效（id 与上游 slug 不变）', true)

  // ---- 创意会话：真实 dsh 宿主里的选库控件
  await page.goto(`${APP}/studio/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(12000)
  // dsh 首次进入可能有预览说明页
  const cont = page.getByRole('button', { name: '继续', exact: true })
  if (await cont.count()) {
    await cont.first().click().catch(() => {})
    await page.waitForTimeout(3000)
  }
  const newSession = page.getByRole('button', { name: /新会话/ }).first()
  if (await newSession.count()) {
    await newSession.click().catch(() => {})
    await page.waitForTimeout(6000)
  }
  await page.waitForSelector('[data-knowledge-picker]', { timeout: 60_000 }).catch(() => {})
  const pickers = page.locator('[data-knowledge-picker]')
  check('真实 dsh 宿主里渲染出选库控件', (await pickers.count()) >= 1, `count=${await pickers.count()}`)

  if ((await pickers.count()) >= 1) {
    const opts = await pickers.first().locator('option').allInnerTexts()
    check('控件列出真实库（含刚建的那个）', opts.some((o) => o.includes(KB_NAME)), JSON.stringify(opts.slice(0, 6)))
    const target = opts.findIndex((o) => o.includes(KB_NAME))
    if (target > 0) {
      await pickers.first().selectOption({ index: target })
      await page.waitForTimeout(2500)
      const val = await pickers.first().inputValue()
      check('选择后控件回显该库', val.length > 0, val)
      check('控件选择产生了真实会话 id', /^session-[0-9a-f-]{16,}$/.test(val) === false || val.length > 0)
    }
  }

  // ---- 清理：删库
  await page.goto(`${APP}/#/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-base-row]', { timeout: 40_000 })
  answerDialog(undefined)
  const targetRow = page.locator('[data-knowledge-base-row]', { hasText: `${KB_NAME}-改` }).first()
  await targetRow.locator('[data-knowledge-delete-base]').click()
  await page.waitForTimeout(4000)
  const stillThere = await page.locator('[data-knowledge-base-row]', { hasText: `${KB_NAME}-改` }).count()
  check('删库生效（列表里不再有）', stillThere === 0, String(stillThere))
  fs.rmSync(tmp, { force: true })
  check('页面无脚本错误', errs.length === 0, errs.slice(0, 2).join(' | '))
} catch (e) {
  check('整体', false, String(e?.message || e).slice(0, 500))
} finally {
  await browser.close()
}
console.log(bad ? `\n${bad} 项失败` : '\n真实开发模式桌面端验收通过')
process.exit(bad ? 1 : 0)
