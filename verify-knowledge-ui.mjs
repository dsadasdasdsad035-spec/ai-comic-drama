/**
 * 知识库 UI 验收（Playwright-core，临时 dev server + mock 上游，零成本）。
 *
 * 覆盖：
 * - 设置 → 连接与模型 → 知识库 入口、表单、Key 不回显、env 兜底显示；
 * - 全局路由 `#/knowledge` 打得开（且旧链接 `#/p/<项目>/knowledge` 落到同一个全局页）；
 * - 未配置时显示引导（不是报错框）；
 * - 建库 → 上传 → 改名 → 删库的完整维护链路；
 * - **没有提问输入框、没有消息流**（问答只在创意会话里）；
 * - 删除库的确认文案说明「文档不会被从文档池删除」，取消则不删。
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
  const state = { workspaces: new Map(), nextId: 1, calls: [] }
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
        const slug = decodeURIComponent(one[1])
        const ws = state.workspaces.get(slug)
        if (req.method === 'DELETE') {
          state.workspaces.delete(slug)
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
      if (p === '/v1/system/remove-documents') {
        const { names = [] } = j()
        for (const ws of state.workspaces.values()) {
          ws.documents = ws.documents.filter((d) => !names.includes(d.location))
        }
        return send(200, { success: true })
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

// ---------------------------------------------------------------- 未配置态

const mockOff = await startApp({
  projectsDir: PROJECTS,
  port: PORT + 1,
  extraEnv: { ANYTHINGLLM_BASE_URL: '', ANYTHINGLLM_API_KEY: '' },
})
{
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(`${mockOff.app}/#/knowledge`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-knowledge-view]', { timeout: 25_000 })
    check('未配置时全局知识库页打得开', true)
    await page.waitForSelector('[data-knowledge-unconfigured]', { timeout: 20_000 })
    check('未配置显示引导（不是报错框）', (await page.locator('[data-knowledge-unconfigured]').count()) === 1)
    check(
      '引导里给出「去设置里填写」入口',
      (await page.locator('[data-knowledge-goto-settings]').count()) === 1,
    )
    await page.screenshot({ path: path.join(OUT, 'unconfigured.png'), fullPage: true })
  } finally {
    await browser.close()
    mockOff.stop()
  }
}

// ---------------------------------------------------------------- 已配置态

const mock = await startMock()
const app = await startApp({
  projectsDir: PROJECTS,
  port: PORT,
  // 上游地址走环境变量注入，避免测试去动真实设置库
  extraEnv: {
    ANYTHINGLLM_BASE_URL: `http://127.0.0.1:${mock.port}`,
    ANYTHINGLLM_API_KEY: 'ui-key',
    SB_BUILTIN_KNOWLEDGE: '1',
  },
})

// 仓库约定：用系统 Chrome，避免依赖 playwright 下载的浏览器版本
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

/** prompt/confirm 由 window 提供，Playwright 里必须显式接管，否则会一直挂着 */
const answerDialog = (value) =>
  page.once('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(value)
    else await d.accept()
  })

try {
  // ---- 设置面板
  await page.goto(`${app.app}/#/p/${PROJECT}/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.st-sec', { timeout: 25_000 })

  const kbTab = page.locator('button[role="tab"][data-settings-pane="knowledge"]')
  check('设置导航有「知识库」入口', (await kbTab.count()) > 0)
  if ((await kbTab.count()) > 0) {
    await kbTab.click()
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
    const urlValue = await page.locator('[data-knowledge-base-url]').inputValue()
    check('地址由环境变量兜底显示', urlValue.includes(String(mock.port)), urlValue)
    await page.screenshot({ path: path.join(OUT, 'settings-pane.png'), fullPage: true })
  }

  // ---- 旧项目内链接要落到全局页
  await page.goto(`${app.app}/#/p/${PROJECT}/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-knowledge-view]', { timeout: 25_000 })
  check('旧链接 #/p/<项目>/knowledge 落到全局知识库页', true)
  check('全局页不套项目外壳（没有左栏）', (await page.locator('.rail').count()) === 0)

  // ---- 维护链路：建库
  await page.waitForSelector('[data-knowledge-no-base]', { timeout: 20_000 })
  check('还没有库时显示空态', (await page.locator('[data-knowledge-no-base]').count()) === 1)

  answerDialog('运镜手册')
  await page.locator('[data-knowledge-create]').click()
  await page.waitForSelector('[data-knowledge-base-row]', { timeout: 20_000 })
  check('新建库后出现在列表', (await page.locator('[data-knowledge-base-row]').count()) === 1)
  const rowText = await page.locator('[data-knowledge-base-row]').first().innerText()
  check('列表显示库名', rowText.includes('运镜手册'), rowText.slice(0, 80))

  // ---- 没有问答界面
  check('没有提问输入框', (await page.locator('[data-knowledge-question]').count()) === 0)
  check('没有消息流', (await page.locator('.kb-messages, [data-knowledge-answer]').count()) === 0)

  // ---- 上传
  await page.waitForSelector('[data-knowledge-doc-list]', { timeout: 20_000 })
  const fileInput = page.locator('[data-knowledge-upload]')
  check('有上传入口', (await fileInput.count()) >= 1)
  if ((await fileInput.count()) >= 1) {
    const tmpFile = path.join(os.tmpdir(), 'kb-ui-world.md')
    fs.writeFileSync(tmpFile, '# 世界观\n主角是猎人', 'utf8')
    await fileInput.setInputFiles(tmpFile)
    await page.waitForSelector('[data-knowledge-doc-row]', { timeout: 20_000 })
    check('上传后文档出现在该库', (await page.locator('[data-knowledge-doc-row]').count()) === 1)
    const docText = await page.locator('[data-knowledge-doc-row]').first().innerText()
    check('文档行显示文件名', docText.includes('kb-ui-world.md'), docText.slice(0, 80))
    fs.rmSync(tmpFile, { force: true })
  }
  await page.screenshot({ path: path.join(OUT, 'view-with-docs.png'), fullPage: true })

  // ---- 改名
  answerDialog('运镜宝典')
  await page.locator('[data-knowledge-base-row] .btn-ghost', { hasText: '改名' }).first().click()
  /*
   * 改名后要等列表那一行真的换了字：`document.body.innerText` 里已经有
   * 「运镜宝典」（确认框关掉前就在 DOM 里），拿它当条件会立刻通过、
   * 断言到旧文案。
   */
  await page.waitForFunction(
    () => {
      const row = document.querySelector('[data-knowledge-base-row]')
      return Boolean(row && row.textContent && row.textContent.includes('运镜宝典'))
    },
    undefined,
    { timeout: 20_000 },
  )
  const renamed = await page.locator('[data-knowledge-base-row]').first().innerText()
  check('改名后列表显示新名字', renamed.includes('运镜宝典'), renamed.slice(0, 60))

  // ---- 删库：先取消，库要还在
  let dialogText = ''
  page.once('dialog', async (d) => {
    dialogText = d.message()
    await d.dismiss()
  })
  await page.locator('[data-knowledge-delete-base]').first().click()
  await page.waitForTimeout(600)
  check('删库确认文案说明文档不会被从文档池删除', /不会被从文档池删除/.test(dialogText), dialogText.slice(0, 120))
  check('取消后库仍在', (await page.locator('[data-knowledge-base-row]').count()) === 1)

  // ---- 删库：确认后列表即时刷新
  answerDialog(undefined)
  await page.locator('[data-knowledge-delete-base]').first().click()
  await page.waitForSelector('[data-knowledge-no-base]', { timeout: 20_000 })
  check('删库后列表即时刷新为空态', (await page.locator('[data-knowledge-base-row]').count()) === 0)
  check('删库后上游 workspace 也被清掉', mock.state.workspaces.size === 0, String(mock.state.workspaces.size))
  await page.screenshot({ path: path.join(OUT, 'after-delete.png'), fullPage: true })
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
