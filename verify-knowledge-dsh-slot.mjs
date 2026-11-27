/**
 * 知识库选择器 × 真实 dsh 宿主验收（零成本，不联网、不调用任何模型）。
 *
 * 为什么必须有这一份：插槽 API 有两层容易踩空的契约，静态检查看不出来。
 * 1. **必须 `ctx.slots.inject(key, cb)`**，直接 `ctx.slots.register()` 会在插件
 *    激活时抛 `slot ... is not declared (a parent entry's children table must
 *    declare it)` —— 只有真实宿主才会把它报出来。
 * 2. **空白会话不渲染头部**：`conversation.session.header` 在 `session.blank`
 *    时收到 `hideChrome`，所以选择器还必须挂在 hero 的选项区。
 *
 * 做法：临时 profile + 真实宿主 + 内存桩反代（只拦截 `/api/knowledge/*`），
 * 用 Chrome 打开宿主页面，断言选择器渲染、列库、写会话选库。
 *
 * 跑法：node verify-knowledge-dsh-slot.mjs
 */
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { installCreativeToolsBundle } from './server/dsh-bundle.mjs'
import { writeStudioProfile } from './server/studio-profile.mjs'

const ROOT = process.cwd()
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad += 1
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-slot-'))
installCreativeToolsBundle({ dshHome: home, root: ROOT, log: () => {} })
/*
 * 写一条模型路由：没有可用渠道时宿主停在 onboarding 页，会话头部与 hero 都不渲染，
 * 选择器自然也就没有位置可挂。`SB_STUDIO_GATEWAY_KEY` 是宿主判定渠道可用的依据。
 */
writeStudioProfile({
  dshHome: home,
  gatewayBaseUrl: 'http://127.0.0.1:9/v1',
  routes: [{ id: 'kb-slot-test', label: '桩渠道', models: [{ id: 'stub-model', label: '桩模型' }] }],
  defaultModelId: 'stub-model',
  log: () => {},
})

const hostPort = await freePort()
const proxyPort = await freePort()
const host = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--port', String(hostPort)],
  {
    cwd: path.join(home, 'profiles', 'web'),
    env: { ...process.env, DSH_HOME: home, SB_STUDIO_GATEWAY_KEY: 'test-gateway-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let hostLog = ''
host.stdout.on('data', (b) => {
  hostLog += b
})
host.stderr.on('data', (b) => {
  hostLog += b
})
let ready = null
for (let i = 0; i < 300; i++) {
  ready = hostLog.match(/dsh web:\s*(https?:\/\/\S+)/)
  if (ready) break
  await new Promise((r) => setTimeout(r, 400))
}

// ---- 内存桩：知识库接口自己答，其余原样转发给宿主
const bases = [
  { id: 'kb_a', name: '运镜手册', upstreamSlug: 'ws-1', createdAt: 'x', docCount: 3 },
  { id: 'kb_b', name: '通用资料', upstreamSlug: 'ws-2', createdAt: 'x', docCount: 0 },
]
const picked = new Map()
const kbCalls = []
const proxy = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x')
  if (url.pathname.startsWith('/api/knowledge/')) {
    kbCalls.push({ method: req.method, path: url.pathname })
    const json = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/api/knowledge/bases') return json({ ok: true, bases })
    if (url.pathname === '/api/knowledge/session-kb') {
      if (req.method === 'GET') {
        const sid = url.searchParams.get('sessionId') || ''
        const kbId = picked.get(sid) || ''
        return json({
          ok: true,
          sessionId: sid,
          kbId,
          base: bases.find((b) => b.id === kbId) || null,
          gone: false,
        })
      }
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        picked.set(String(body.sessionId || ''), String(body.kbId || ''))
        json({ ok: true })
      })
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: false, message: 'stub: ' + url.pathname }))
  }
  const up = http.request(
    { host: '127.0.0.1', port: hostPort, path: req.url, method: req.method, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode || 500, r.headers)
      r.pipe(res)
    },
  )
  up.on('error', () => res.destroy())
  req.pipe(up)
})
// 宿主的 RPC 走 WebSocket：不隧道 upgrade 的话界面永远停在空态
proxy.on('upgrade', (req, socket, head) => {
  const up = net.connect(hostPort, '127.0.0.1', () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n')
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head?.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('error', () => up.destroy())
})
await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r))
const proxyBase = `http://127.0.0.1:${proxyPort}/`

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`)
})

try {
  check('宿主启动（无跳过插件层）', Boolean(ready) && !/skipping profile bundle/.test(hostLog),
    /skipping profile bundle[^\n]*/.exec(hostLog)?.[0] || '')
  if (!ready) throw new Error('宿主没启动：\n' + hostLog.slice(-1500))

  // 用带 token 的地址换 auth cookie，之后全部走反代
  const tokenUrl = ready[1].replace(`127.0.0.1:${hostPort}`, `127.0.0.1:${proxyPort}`)
  const r1 = await fetch(tokenUrl, { redirect: 'manual' })
  const cookie = String(r1.headers.get('set-cookie') || '').split(';')[0]
  await page.context().addCookies([
    {
      name: cookie.split('=')[0],
      value: cookie.split('=').slice(1).join('='),
      url: proxyBase,
    },
  ])
  await page.goto(proxyBase, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  // 预览版说明页
  const cont = page.getByRole('button', { name: '继续', exact: true })
  if (await cont.count()) {
    await cont.first().click().catch(() => {})
    await page.waitForTimeout(2000)
  }
  // 开一个会话（选择器也要在有内容的会话里工作）
  const newSession = page.getByRole('button', { name: /新会话/ }).first()
  if (await newSession.count()) {
    await newSession.click().catch(() => {})
    await page.waitForTimeout(3500)
  }

  const clientLoaded = await page.evaluate(() =>
    Boolean(document.querySelector('style[data-plugin="dsh-plugin-knowledge-ui"]')),
  )
  check('client.js 在宿主里执行了', clientLoaded)

  await page.waitForSelector('[data-knowledge-picker]', { timeout: 30_000 }).catch(() => {})
  const picker = page.locator('[data-knowledge-picker]').first()
  check('选择器渲染进了会话头部 / hero', (await page.locator('[data-knowledge-picker]').count()) >= 1)
  check('没有插槽注册错误', !consoleErrors.some((e) => /is not declared/.test(e)),
    consoleErrors.find((e) => /is not declared/.test(e)) || '')

  const options = await picker.locator('option').allInnerTexts().catch(() => [])
  check('下拉列出两个库 + 未选占位', options.length === 3, JSON.stringify(options))
  check('库名带文档数', options.join('|').includes('运镜手册（3 份）'), JSON.stringify(options))

  await picker.selectOption('kb_a')
  await page.waitForTimeout(1500)
  const sessionIds = [...picked.keys()]
  check('选择后写入了会话选库', picked.get(sessionIds[0]) === 'kb_a', JSON.stringify([...picked]))
  check('写的是 dsh 会话 id（不是随便一个字符串）', /^session-[0-9a-f-]{16,}$/.test(sessionIds[0] || ''), sessionIds[0] || '')
  check('选择后下拉回显', (await picker.inputValue()) === 'kb_a')
  check('读选库时带上了 sessionId', kbCalls.some((c) => c.path === '/api/knowledge/session-kb'), JSON.stringify(kbCalls.slice(0, 4)))
} catch (e) {
  check('整体', false, String(e?.message || e).slice(0, 500))
} finally {
  await browser.close()
  proxy.close()
  host.kill('SIGKILL')
  fs.rmSync(home, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} 项失败` : '\n知识库选择器 × 真实 dsh 宿主验收通过')
process.exit(bad ? 1 : 0)
