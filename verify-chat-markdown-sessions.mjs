/**
 * 4.1/4.4 回归：创意会话的轮次前缀分支与用户消息渲染。
 *
 * 用临时项目目录起一个独立 dev server，直接通过会话接口写入一条线程，
 * 再打开创意视图核对：
 * - `第 N 轮 · 模型说明：…` 仍走 ChatStep 专用渲染，前缀文本不被 Markdown 化
 * - 说明正文按 Markdown 渲染（出现 strong）
 * - `已取消` / `失败：` 分支仍是专用文案
 * - 用户消息与助手消息共用同一渲染器（用户侧的 `- 项` 变成列表）
 *
 * 跑法：node verify-chat-markdown-sessions.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const PORT = 5411
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-md-sessions-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `md-seed-${Date.now()}`
const EVIDENCE = path.join(ROOT, 'openspec/changes/chat-markdown-render/evidence')

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })
fs.mkdirSync(EVIDENCE, { recursive: true })

try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 预置项目
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: 'MD 渲染回归' })
writeProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, {
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜街口', keyframe_prompt: 'a man', video_prompt: 'push in' }],
})
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'inherit' })

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  try {
    return await r.json()
  } catch {
    return {}
  }
}

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

let browser
try {
  // ---- 写入线程 ----
  const created = await api('/api/creative/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Markdown 渲染回归', project: NAME }),
  })
  const sessionId = created?.session?.id
  if (!sessionId) throw new Error(`会话创建失败：${JSON.stringify(created)}`)

  const messages = [
    {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: '给三个方向\n- 悬疑\n- 温情' }],
    },
    {
      id: 'a1',
      role: 'assistant',
      status: 'complete',
      parts: [
        { type: 'step', turn: 1, phase: 'end', text: '**重点** 先盘点物料' },
        { type: 'text', text: '## 方向清单\n\n**重点**：先看 `read_asset_inventory`\n\n```ts\nconst a = 1\n```\n\n| 镜头 | 时长 | 景别 | 运镜 | 画面 |\n| --- | --- | --- | --- | --- |\n| S01 | 4s | 全景 | 环绕 | 山顶对打 |' },
        { type: 'step', turn: 2, phase: 'error', text: '上游超时' },
        { type: 'text', text: '已取消' },
        { type: 'text', text: '失败：模型未配置' },
      ],
    },
  ]
  const saved = await api(`/api/creative/sessions/${encodeURIComponent(sessionId)}/thread`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  check('线程写入成功', Boolean(saved?.thread), saved?.message || '')

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-creative-studio]').waitFor({ timeout: 20000 })

  // 选中刚写入的会话
  const card = page.locator(`[data-creative-session="${sessionId}"]`)
  await card.waitFor({ timeout: 20000 })
  await card.locator('.creative-session-card-main').click()
  await page.locator('[data-chat-step]').first().waitFor({ timeout: 20000 })

  // 1) 轮次前缀走 ChatStep，不进入 Markdown 渲染
  const step1 = page.locator('[data-chat-step="1"]')
  const step1Text = await step1.innerText()
  check('step 前缀渲染为 ChatStep', (await step1.count()) === 1, step1Text.replace(/\n/g, ' '))
  check('step 前缀不残留 ** 源符号', !step1Text.includes('**'), step1Text.replace(/\n/g, ' '))
  check('step 前缀里没有 Markdown strong', (await step1.locator('strong').count()) === 0)
  check('step 说明尾缀为 完成', step1Text.includes('完成'))

  // 2) 说明正文按 Markdown 渲染
  const mdStrong = await page.locator('[data-chat-md] strong').first().innerText()
  check('说明正文渲染出 strong', mdStrong.includes('重点'), mdStrong)

  // 3) 错误分支
  const step2 = page.locator('[data-chat-step="2"]')
  check('错误轮次保留专用文案', (await step2.innerText()).includes('上游超时'), await step2.innerText())

  // 4) 取消与失败分支
  const bodyText = await page.locator('[data-chat-root]').innerText()
  check('已取消分支保留专用文案', bodyText.includes('已取消本轮。'))
  check('失败分支保留原文', bodyText.includes('失败：模型未配置'))

  // 5) 助手正文的富文本结构
  check('助手正文出现标题', (await page.locator('[data-chat-md] h2').count()) >= 1)
  check('助手正文出现折叠代码块', (await page.locator('[data-chat-code][data-open="false"]').count()) >= 1)
  const tableWrap = page.locator('[data-chat-md] .chat-md-table-wrap').first()
  check('助手正文表格有滚动容器', (await tableWrap.count()) === 1)
  check(
    '表格容器 overflow-x 生效',
    (await tableWrap.evaluate((el) => getComputedStyle(el).overflowX)) === 'auto',
  )

  // 6) 用户消息同样走 Markdown
  const userMsg = page.locator('[data-chat-message="user"]').first()
  check('用户消息出现列表', (await userMsg.locator('ul li').count()) === 2, await userMsg.innerText())
  check('用户消息也被 .chat-md 包裹', (await userMsg.locator('[data-chat-md]').count()) === 1)

  check('无页面错误', errors.length === 0, errors.join('; '))

  await page.locator('[data-chat-root]').screenshot({ path: path.join(EVIDENCE, 'creative-prefix-and-markdown.png') })
  console.log(`\n截图：openspec/changes/chat-markdown-render/evidence/creative-prefix-and-markdown.png`)
} catch (e) {
  bad++
  console.error(`❌ 运行异常：${e?.message || String(e)}`)
} finally {
  if (browser) await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部会话渲染断言通过')
process.exit(bad ? 1 : 0)
