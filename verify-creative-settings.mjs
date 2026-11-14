/**
 * 创意设置与可选下载适配器验收：
 * 默认适配器状态、yt-dlp/DTK 保存与回读、Key 脱敏、适配器失败不回退、旧设置兼容。
 * 跑法：node verify-creative-settings.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const ROOT = process.cwd()
const PORT = 5348
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-settings-'))
const PROJECTS = path.join(TMP, 'projects')
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })
try {
  await fetch(`${APP}/api/health`, { signal: AbortSignal.timeout(800) })
  console.error(`端口 ${PORT} 已被占用，请先结束占用进程`)
  process.exit(1)
} catch {
  /* 空闲 */
}

// 桩 DTK 服务：按真实契约实现 POST /api/v1/parse 与 GET /api/v1/tasks/{id}，
// 用来验证请求形状、鉴权头与 media.video.url 的取值路径。
const dtkSeen = []
const dtkServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const pathname = String(req.url || '').split('?')[0]
    dtkSeen.push({ url: req.url, auth: req.headers.authorization || '', body })
    const mediaUrl = `http://127.0.0.1:${dtkServer.address().port}/media.mp4`
    if (pathname === '/api/v1/parse' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          success: true,
          data: {
            platform: 'douyin',
            content_id: '123',
            desc: '桩视频',
            author: { nickname: '桩作者' },
            media: { video: { url: mediaUrl } },
          },
          error: null,
        }),
      )
      return
    }
    // 任务轮询：桩里直接给 done，验证适配器的轮询分支
    if (pathname.startsWith('/api/v1/tasks/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          success: true,
          data: {
            state: 'done',
            data: { platform: 'douyin', content_id: '123', media: { video: { url: mediaUrl } } },
          },
          error: null,
        }),
      )
      return
    }
    if (pathname === '/media.mp4') {
      const buf = fs.readFileSync(SAMPLE)
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length })
      res.end(buf)
      return
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'no route' } }))
  })
})
await new Promise((r) => dtkServer.listen(0, '127.0.0.1', r))
const DTK_PORT = dtkServer.address().port

// 样例视频
const SAMPLE = path.join(TMP, 'sample.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=1:r=25',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SAMPLE,
])

// 旧设置：没有 creative 字段
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { dbPath, setSetting } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
dbPath(${JSON.stringify(PROJECTS)})
setSetting('app', {
  providers: [{ id: 'ark', label: 'Ark', kind: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '' }],
  models: [{ key: 'ark-text-lite', label: 'Ark Lite', cap: 'text', provider: 'ark', model: 'doubao-seed-2-0-lite-260428' }],
  defaults: { text: 'ark-text-lite' },
  stageModels: {},
  pricing: {},
  apiKey: '',
  rules: {},
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
const put = (p, body) =>
  api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

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
  dtkServer.close()
  process.exit(1)
}

try {
  // 1) 旧设置读取不报错，创意配置走默认
  const initial = await api('/api/settings')
  check('旧设置可读取', initial.ok === true && Boolean(initial.settings))
  check('缺省 creative 归一化', initial.settings?.creative?.confirmCost === true, JSON.stringify(initial.settings?.creative).slice(0, 120))
  check(
    '缺省分析档位为快速',
    initial.settings?.creative?.analysis?.depth === 'quick',
    String(initial.settings?.creative?.analysis?.depth),
  )

  // 2) 默认只有 upload / direct
  const adapters0 = await api('/api/creative/adapters')
  const okIds = (adapters0.adapters || []).filter((a) => a.ok).map((a) => a.id).sort()
  check('默认可用适配器只有上传与直链', okIds.join(',') === 'direct,upload', okIds.join(','))
  check('ffmpeg 就绪', adapters0.ffmpeg?.ok === true)

  // 3) 保存 yt-dlp（不可执行路径 → 仍不可用且给出原因）
  const withYtdlp = await put('/api/settings', {
    creative: {
      ...initial.settings.creative,
      ingest: {
        ytdlp: { enabled: true, bin: '/nonexistent/yt-dlp' },
        dtk: { enabled: false, baseUrl: '', apiKey: '' },
      },
    },
  })
  check('yt-dlp 配置已保存', withYtdlp.settings?.creative?.ingest?.ytdlp?.enabled === true)
  const adapters1 = await api('/api/creative/adapters')
  const ytdlp = (adapters1.adapters || []).find((a) => a.id === 'ytdlp')
  check('不存在的 yt-dlp 报告不可用', ytdlp?.ok === false && String(ytdlp?.reason).includes('不存在'), ytdlp?.reason)

  // 4) DTK：填地址与 Key，回读时 Key 脱敏
  const withDtk = await put('/api/settings', {
    creative: {
      ...initial.settings.creative,
      ingest: {
        ytdlp: { enabled: false, bin: '' },
        dtk: { enabled: true, baseUrl: `http://127.0.0.1:${DTK_PORT}`, apiKey: 'dtk-secret' },
      },
    },
  })
  check('DTK 配置已保存', withDtk.settings?.creative?.ingest?.dtk?.enabled === true)
  check('DTK Key 回读被脱敏', !String(JSON.stringify(withDtk.settings?.creative)).includes('dtk-secret'))
  check('DTK Key 存在性可读', withDtk.settings?.creative?.ingest?.dtk?.hasApiKey === true)

  const adapters2 = await api('/api/creative/adapters')
  const dtk = (adapters2.adapters || []).find((a) => a.id === 'dtk')
  check('DTK 已可用', dtk?.ok === true, dtk?.reason)

  // 5) 保存时留空不清掉已存 Key
  const keepKey = await put('/api/settings', {
    creative: {
      ...initial.settings.creative,
      ingest: { ytdlp: { enabled: false, bin: '' }, dtk: { enabled: true, baseUrl: `http://127.0.0.1:${DTK_PORT}`, apiKey: '' } },
    },
  })
  check('留空保存保留原 Key', keepKey.settings?.creative?.ingest?.dtk?.hasApiKey === true)

  // 6) 创意室不再用 URL 摄取
  const session = (await post('/api/creative/sessions', {})).session
  const creativeUrl = await post('/api/creative/ingest', {
    sessionId: session.id,
    url: 'https://v.douyin.com/demo/',
  })
  check('创意 ingest 拒绝 URL', creativeUrl.ok === false && /本地上传|3D/.test(String(creativeUrl.message)), creativeUrl.message)

  // 7) DTK 走 3D 参考摄取：请求形状与鉴权头（桩 CDN 为 127.0.0.1 → SSRF 拒绝）
  const projName = `settings-dtk-${Date.now()}`
  await api(`/api/project?create=1&name=${encodeURIComponent(projName)}`, { method: 'POST', body: '{}' })
  dtkSeen.length = 0
  const shot3dIngest = await post('/api/shot-3d/ingest-reference', {
    projectName: projName,
    url: 'https://v.douyin.com/demo/',
    adapter: 'dtk',
  })
  check('DTK 请求已发出', dtkSeen.length >= 1, String(dtkSeen.length))
  check('DTK 带 Authorization', dtkSeen[0]?.auth === 'Bearer dtk-secret', dtkSeen[0]?.auth)
  check('先调 parse 端点', String(dtkSeen[0]?.url || '').startsWith('/api/v1/parse'), dtkSeen[0]?.url)
  check('parse 请求体带 url', /"url"/.test(String(dtkSeen[0]?.body || '')), String(dtkSeen[0]?.body).slice(0, 80))
  check(
    '内网下载地址被拒绝（SSRF 防护）',
    shot3dIngest.ok === false && /内网|本机/.test(String(shot3dIngest.message)),
    String(shot3dIngest.message).slice(0, 120),
  )

  // 8) 已启用适配器失败时不静默回退（3D 摄取）
  dtkSeen.length = 0
  const fallback = await post('/api/shot-3d/ingest-reference', {
    projectName: projName,
    url: 'https://v.douyin.com/demo/',
    adapter: 'dtk',
  })
  check('失败不回退到直链', fallback.ok === false && !/video\/mp4/.test(JSON.stringify(fallback)), String(fallback.message).slice(0, 80))

  // 9) 凭据不出现在创意线程里
  const thread = await api(`/api/creative/sessions/${session.id}/thread`)
  check('线程不含凭据', !JSON.stringify(thread).includes('dtk-secret'))

  // 9) 设置页 UI：创意分组可打开并保存
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${APP}/#/p/${encodeURIComponent(projName)}/settings`, { waitUntil: 'networkidle' })
    await page.locator('.st-nav').waitFor({ timeout: 15000 })
    // 设置页分组里也有「创意」，限定在导航里点
    await page.locator('.st-nav').getByRole('button', { name: '创意', exact: true }).click()
    await page.locator('[data-settings-creative]').waitFor({ timeout: 10000 })
    const sec = page.locator('[data-settings-creative]')
    const text = await sec.innerText()
    check('创意分组为 Pi 说明', text.includes('创意（对话助手）') && !text.includes('yt-dlp 可执行文件'), text.slice(0, 160))
    check('创意分组不含 yt-dlp', (await sec.locator('[data-creative-ytdlp-bin]').count()) === 0)
    check('无旧能力绑定', (await sec.locator('[data-creative-binding]').count()) === 0)
    check('无成本开关', (await sec.locator('[data-creative-confirm]').count()) === 0)
    check('Pi 说明块可见', (await sec.locator('[data-creative-pi-doc]').count()) === 1)

    await page.locator('.st-nav').getByRole('button', { name: '素材库', exact: true }).click()
    await page.locator('[data-settings-stock]').waitFor({ timeout: 10000 })
    const stockSec = page.locator('[data-settings-stock]')
    const stockText = await stockSec.innerText()
    check('素材库有平台链接下载', stockText.includes('平台链接下载'), stockText.slice(0, 160))
    check('yt-dlp 字段可见', (await stockSec.locator('[data-creative-ytdlp-bin]').count()) === 1)
    check('DTK 字段可见', (await stockSec.locator('[data-creative-dtk-url]').count()) === 1)

    await page.locator('.st-nav').getByRole('button', { name: '创意', exact: true }).click()
    await page.locator('[data-settings-creative]').waitFor({ timeout: 10000 })
    await page.locator('[data-creative-goto-routing]').click()
    await page.locator('[data-settings-routing]').waitFor({ timeout: 10000 })
    check('可跳转默认路由', (await page.locator('[data-settings-routing]').innerText()).includes('创意（对话助手）'))
    check('页面无脚本错误', errors.length === 0, errors.slice(0, 160).join(' | '))
  } finally {
    await browser.close()
  }
} finally {
  child.kill()
  dtkServer.close()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
