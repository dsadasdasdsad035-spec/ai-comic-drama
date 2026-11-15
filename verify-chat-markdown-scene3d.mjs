/**
 * 4.3/5.1 回归：3D 调度会话（`SceneAgentChat`）的富文本与结构化 parts。
 *
 * 旧脚本 `verify-agent-chat-ui.mjs` 依赖已下线的「镜头表 / 3D 调度 / .s3d-card」，
 * 新壳路径是：素材 → 镜头语言 → 自定义白模 → 编辑 / 渲染 → 聊天侧栏。
 * 为绕开「新建白模」的异步落库时序，白模 sheet 与线程都用 API 预置，UI 只负责打开工作台。
 *
 * 断言：
 * - 工具卡仍是 `[data-chat-tool]` 结构化卡片，没有被 Markdown 化
 * - 文本部分与创意会话同样走 `ChatText`（h2 / 折叠代码块 / 表格滚动容器）
 * - 用户消息同样走同一渲染器
 *
 * 跑法：node verify-chat-markdown-scene3d.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { selectProject } from './verify-lib.mjs'

const ROOT = process.cwd()
const PORT = 5413
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-md-3d-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `md-3d-${Date.now()}`
const SHEET_ID = 'wb-regression'
const EVIDENCE = path.join(ROOT, 'openspec/changes/archive/2026-11-15-chat-markdown-render/evidence')

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

// 预置项目 + 一个白模 sheet（线程的 shotId 就是它）
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: '3D 会话回归' })
writeProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, {
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, size: '中景', desc: '雨夜街口', keyframe_prompt: 'a man', video_prompt: 'push in' }],
  lexiconWhitebox: [{ id: ${JSON.stringify(SHEET_ID)}, title: '回归白模', seconds: 4 }],
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
const pageErrors = []
try {
  // 线程先写好，聊天侧栏一打开就是完整对话
  const messages = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: '按这个白模调一下运镜\n- 推近\n- 环绕' }] },
    {
      id: 'a1',
      role: 'assistant',
      status: 'complete',
      parts: [
        { type: 'step', turn: 1, phase: 'end', text: '先读镜头上下文' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'get_shot_context', args: {}, result: { ok: true, shot: { id: 'E01-S01' } } },
        {
          type: 'text',
          text: '## 运镜方案\n\n**重点**：先推近再环绕\n\n```ts\ncamera.position.set(0, 2, 6)\n```\n\n| 段 | 时长 | 动作 | 景别 | 说明 |\n| --- | --- | --- | --- | --- |\n| 1 | 2s | 推近 | 中景 | 靠近人物 |',
        },
      ],
    },
  ]
  const saved = await api('/api/chat-thread', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: NAME, surface: 'lexicon', episode: 0, shotId: SHEET_ID, messages, activeSkills: [] }),
  })
  check('3D 线程写入成功', Boolean(saved?.thread), saved?.message || '')

  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1500, height: 980 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await selectProject(page, NAME)

  // 素材 → 镜头语言 → 自定义白模
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await page.locator('[data-asset-character-tab]').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '镜头语言', exact: true }).click()
  // 首次进入的一次性引导层会遮挡点击
  const ack = page.getByRole('button', { name: '知道了', exact: true })
  if (await ack.count()) await ack.first().click().catch(() => {})
  const customTab = page.getByRole('tab', { name: '自定义白模' })
  await customTab.waitFor({ timeout: 15000 })
  await customTab.click()

  // 预置的 sheet 已存在，直接打开工作台
  const openBtn = page.getByRole('button', { name: '编辑 / 渲染', exact: true }).first()
  await openBtn.waitFor({ timeout: 15000 })
  await openBtn.click()

  const panel = page.locator('[data-chat-scope="lexicon"]')
  await panel.waitFor({ state: 'attached', timeout: 30000 })
  check('3D 聊天面板已挂载', (await panel.count()) === 1)
  await panel.locator('[data-chat-tool]').first().waitFor({ timeout: 30000 })

  // 结构化 parts 保持卡片
  check('工具卡仍是 data-chat-tool 卡片', (await panel.locator('[data-chat-tool="get_shot_context"]').count()) >= 1)
  check('工具卡文字未被 Markdown 化', (await panel.locator('[data-chat-tool]').first().innerText()).includes('镜头上下文'))

  // 文本部分走同一套 Markdown
  check('3D 正文出现标题', (await panel.locator('[data-chat-md] h2').count()) >= 1)
  check('3D 正文出现折叠代码块', (await panel.locator('[data-chat-code][data-open="false"]').count()) >= 1)
  const tableWrap = panel.locator('[data-chat-md] .chat-md-table-wrap').first()
  check('3D 表格有滚动容器', (await tableWrap.count()) === 1)
  check(
    '3D 表格容器 overflow-x 生效',
    (await tableWrap.evaluate((el) => getComputedStyle(el).overflowX)) === 'auto',
  )
  const userList = panel.locator('[data-chat-message="user"] [data-chat-md] ul li')
  check('用户消息走同一渲染器', (await userList.count()) === 2, String(await userList.count()))
  check('无页面错误', pageErrors.length === 0, pageErrors.join('; '))

  await panel.screenshot({ path: path.join(EVIDENCE, 'scene3d-markdown-and-tools.png') })
  console.log('\n截图：openspec/changes/archive/2026-11-15-chat-markdown-render/evidence/scene3d-markdown-and-tools.png')
} catch (e) {
  bad++
  console.error(`❌ 运行异常：${e?.message || String(e)}`)
  try {
    if (browser) {
      const pages = browser.contexts()[0]?.pages() || []
      const p = pages[pages.length - 1]
      if (p) {
        await p.screenshot({ path: path.join(EVIDENCE, 'scene3d-debug.png') })
        console.log('调试截图：evidence/scene3d-debug.png')
        console.log('URL:', p.url())
        const scopes = await p.locator('[data-chat-scope]').evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect()
            return { scope: el.getAttribute('data-chat-scope'), w: Math.round(r.width), h: Math.round(r.height) }
          }),
        )
        console.log('chat scopes:', JSON.stringify(scopes))
        console.log('页面错误:', pageErrors.length ? pageErrors.join(' | ') : '无')
      }
    }
  } catch {
    /* ignore */
  }
} finally {
  if (browser) await browser.close()
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 3D 会话渲染断言通过')
process.exit(bad ? 1 : 0)
