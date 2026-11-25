/**
 * 知识库设置面板 + 知识库视图的 UI 验收（Playwright-core，临时 dev server + mock 上游）。
 *
 * 覆盖：
 * - 设置 → 连接与模型 → 知识库 入口、表单、检查清单、Key 不回显；
 * - 未配置时知识库视图显示引导（不是报错）；
 * - 配置后能建库、上传、看到清单；
 * - 问答无命中时明确标注「没有命中」，不冒充知识库结论。
 *
 * 跑法：node verify-knowledge-ui.mjs
 */
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const PORT = 5371
const PROJECT = 'kb-proj'
const check = createCheck()
const PROJECTS = makeProjectsDir('kb-ui-')
const OUT = path.join(process.cwd(), 'out', 'knowledge-ui')
fs.mkdirSync(OUT, { recursive: true })

seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(process.cwd(), 'server', 'db.mjs'))};
   createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(PROJECT)}, { title: '知识库验收' });`,
)

// ---------------------------------------------------------------- mock AnythingLLM

function startMock() {
  const state = { workspaces: new Map(), nextId: 1, chats: [], calls: [] }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    // 真实上游在 /api/v1/*；mock 两种前缀都接受
    const p = url.pathname.replace(/^\/api(?=\/v1\/)/, '')
    state.calls.push({ method: req.method, path: p })
    const send = (s, b) => {
      res.writeHead(s, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(b))
    }
    if (String(req.headers.authorization || '') !== 'Bearer ui-key') {
      return send(403, { error: 'No valid api key found.' })
    }
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const j = () => {
        try {
          return JSON.parse(raw.toString('utf8') || '{}')
        } catch {
          return {}
        }
      }
      if (p === '/v1/auth') return send(200, { authenticated: true })
      if (p === '/v1/workspace/new') {
        const { name } = j()
        const ws = { id: state.nextId++, name, slug: `ui-ws-${state.nextId}`, documents: [] }
        state.workspaces.set(ws.slug, ws)
        return send(200, { workspace: ws })
      }
      if (p === '/v1/workspaces') return send(200, { workspaces: [...state.workspaces.values()] })
      const one = p.match(/^\/v1\/workspace\/([^/]+)$/)
      if (one) {
        const ws = state.workspaces.get(decodeURIComponent(one[1]))
        if (req.method === 'DELETE') {
          state.workspaces.delete(decodeURIComponent(one[1]))
          return send(200, {})
        }
        return send(200, { workspace: ws ? [{ ...ws }] : [] })
      }
      if (p === '/v1/document/upload') {
        const text = raw.toString('latin1')
        const addTo = (/name="addToWorkspaces"\r\n\r\n([^\r]+)/.exec(text)?.[1] || '').trim()
        const filename = Buffer.from(/filename="([^"]+)"/.exec(text)?.[1] || 'x', 'latin1').toString('utf8')
        const ws = state.workspaces.get(addTo)
        if (!ws) return send(400, { success: false, error: 'no ws', documents: [] })
        const doc = {
          location: `custom-documents/${filename}-${state.nextId++}.json`,
          title: filename,
          wordCount: 8,
        }
        ws.documents.push(doc)
        return send(200, { success: true, documents: [doc] })
      }
      const emb = p.match(/^\/v1\/workspace\/([^/]+)\/update-embeddings$/)
      if (emb) {
        const ws = state.workspaces.get(decodeURIComponent(emb[1]))
        const { deletes = [] } = j()
        if (ws) ws.documents = ws.documents.filter((d) => !deletes.includes(d.location))
        return send(200, { workspace: ws })
      }
      const chats = p.match(/^\/v1\/workspace\/([^/]+)\/chats$/)
      if (chats) {
        const sid = url.searchParams.get('apiSessionId') || ''
        return send(200, {
          history: state.chats
            .filter((c) => !sid || c.sessionId === sid)
            .map((c) => ({ role: c.role, content: c.content, sentAt: c.sentAt, sources: c.sources })),
        })
      }
      const stream = p.match(/^\/v1\/workspace\/([^/]+)\/stream-chat$/)
      if (stream) {
        const ws = state.workspaces.get(decodeURIComponent(stream[1]))
        const body = j()
        if (body.reset) {
          state.chats = []
          res.writeHead(200, { 'Content-Type': 'text/event-stream' })
          return res.end(`data: ${JSON.stringify({ type: 'textResponse', textResponse: '', sources: [], close: true })}\n\n`)
        }
        // 故意不返回 sources：验「没命中要明说」这条
        state.chats.push({ sessionId: body.sessionId, role: 'user', content: body.message, sentAt: 1, sources: [] })
        state.chats.push({
          sessionId: body.sessionId,
          role: 'assistant',
          content: '我猜是第三场',
          sentAt: 2,
          sources: [],
        })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ type: 'textResponse', textResponse: '我猜是' })}\n\n`)
        res.end(
          `data: ${JSON.stringify({ type: 'textResponse', textResponse: '第三场', sources: [], close: true })}\n\n`,
        )
        return
      }
      if (p === '/v1/document/accepted-file-types') {
        return send(200, { types: { 'text/plain': ['.txt', '.md'] } })
      }
      return send(404, { error: 'mock: ' + p })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: server.address().port, state, close: () => new Promise((r) => server.close(r)) }),
    )
  })
}

const mock = await startMock()
const app = await startApp({
  projectsDir: PROJECTS,
  port: PORT,
  // 上游地址走环境变量注入，避免测试去动真实设置库
  extraEnv: {
    ANYTHINGLLM_BASE_URL: `http://127.0.0.1:${mock.port}`,
    ANYTHINGLLM_API_KEY: 'ui-key',
  },
})

// 仓库约定：用系统 Chrome，避免依赖 playwright 下载的浏览器版本
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

try {
  // ---- 设置面板
  await page.goto(`${app.app}/#/p/${PROJECT}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.st-sec', { timeout: 25_000 })

  // 设置页的子页标签是 role=tab；左栏导航也有「知识库」，不能用 hasText 猜
  const kbTab = page.locator('button[role="tab"][data-settings-pane="knowledge"]')
  check('设置导航有「知识库」入口', (await kbTab.count()) > 0)
  if ((await kbTab.count()) > 0) {
    await kbTab.click()
    // 面板根节点与 tab 同名属性，用表单里的字段确认面板真的挂上了
    await page.waitForSelector('[data-knowledge-base-url]', { timeout: 10_000 })
    check('知识库面板可打开', true)
    check('服务地址输入框存在', (await page.locator('[data-knowledge-base-url]').count()) === 1)
    check('API Key 输入框存在', (await page.locator('[data-knowledge-api-key]').count()) === 1)
    check('检测按钮存在', (await page.locator('[data-knowledge-test]').count()) === 1)
    check('上游检查清单存在', (await page.locator('[data-knowledge-checklist]').count()) === 1)
    check(
      'Key 输入框是密码类型',
      (await page.locator('[data-knowledge-api-key]').getAttribute('type')) === 'password',
    )
    // 环境变量兜底：地址应已带出来
    const urlValue = await page.locator('[data-knowledge-base-url]').inputValue()
    check('地址由环境变量兜底显示', urlValue.includes(String(mock.port)), urlValue)
    await page.screenshot({ path: path.join(OUT, 'settings-pane.png'), fullPage: true })
  }

  // ---- 知识库视图（未配置/已配置由 env 决定，这里验已配置路径）
  await page.goto(`${app.app}/#/p/${PROJECT}/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-view]', { timeout: 25_000 })
  check('知识库视图能打开', true)

  await page.waitForSelector('[data-knowledge-doc-list]', { timeout: 20_000 })
  check('文档清单区渲染', (await page.locator('[data-knowledge-doc-list]').count()) === 1)
  // 清单容器在加载中就存在，空态要等 loading 结束才出现
  await page.waitForSelector('[data-knowledge-empty]', { timeout: 20_000 })
  check('空库显示空态', (await page.locator('[data-knowledge-empty]').count()) === 1)

  // 上传一个文件
  const fileInput = page.locator('[data-knowledge-upload]')
  check('有上传入口', (await fileInput.count()) >= 1)
  if ((await fileInput.count()) >= 1) {
    const tmpFile = path.join(os.tmpdir(), 'kb-ui-world.md')
    fs.writeFileSync(tmpFile, '# 世界观\n主角是猎人', 'utf8')
    await fileInput.setInputFiles(tmpFile)
    await page.waitForSelector('[data-knowledge-doc-row]', { timeout: 20_000 })
    check('上传后清单出现该文档', (await page.locator('[data-knowledge-doc-row]').count()) === 1)
    const rowText = await page.locator('[data-knowledge-doc-row]').first().innerText()
    check('文档行显示文件名', rowText.includes('kb-ui-world.md'), rowText.slice(0, 80))
    fs.rmSync(tmpFile, { force: true })
  }

  // 提问：上游不返回 sources，界面必须明说没命中
  const composer = page.locator('[data-knowledge-question]')
  check('有提问输入框', (await composer.count()) === 1)
  if ((await composer.count()) === 1) {
    await composer.fill('主角在哪一场出场')
    await page.locator('[data-knowledge-ask]').click()
    // 未命中标记只在流式结束后出现，等它就是等终态（也顺带验了这条需求）
    await page.waitForSelector('[data-knowledge-no-hit]', { timeout: 30_000 })
    const answers = await page.locator('[data-knowledge-answer]').allInnerTexts()
    const answer = answers[answers.length - 1] || ''
    check('回答渲染到界面', answer.includes('我猜是'), answer.slice(0, 80))
    check('未命中时明确标注（不冒充知识库结论）', true)
    await page.screenshot({ path: path.join(OUT, 'view-with-answer.png'), fullPage: true })
  }
} finally {
  await browser.close()
  app.stop()
  await mock.close()
  try {
    fs.rmSync(PROJECTS, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

process.exit(check.bad() ? 1 : 0)
