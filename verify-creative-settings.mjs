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

// 桩 DTK 服务：只实现 parse_url 与 download_media，用来验证请求形状与鉴权头
const dtkSeen = []
const dtkServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    dtkSeen.push({ url: req.url, auth: req.headers.authorization || '', body })
    if (req.url === '/api/v1/parse_url') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { platform: 'douyin', aweme_id: '123', desc: '桩视频', video_url: `http://127.0.0.1:${dtkServer.address().port}/media.mp4` } }))
      return
    }
    if (req.url === '/api/v1/download_media') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: { url: `http://127.0.0.1:${dtkServer.address().port}/media.mp4` } }))
      return
    }
    if (req.url === '/media.mp4') {
      const buf = fs.readFileSync(SAMPLE)
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length })
      res.end(buf)
      return
    }
    res.writeHead(404)
    res.end()
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

  // 6) 用 DTK 摄取：请求形状与鉴权头
  const session = (await post('/api/creative/sessions', {})).session
  // 桩服务返回的是 127.0.0.1，会被 SSRF 防护拦下——这正好验证「服务端不信任下载来源」
  const ingest = await post('/api/creative/ingest', {
    sessionId: session.id,
    url: 'https://v.douyin.com/demo/',
    adapter: 'dtk',
  })
  check('DTK 请求已发出', dtkSeen.length >= 1, String(dtkSeen.length))
  check('DTK 带 Authorization', dtkSeen[0]?.auth === 'Bearer dtk-secret', dtkSeen[0]?.auth)
  check('先调 parse_url', dtkSeen[0]?.url === '/api/v1/parse_url', dtkSeen[0]?.url)
  check(
    '内网下载地址被拒绝（SSRF 防护）',
    ingest.ok === false && /内网|本机/.test(String(ingest.message)),
    String(ingest.message).slice(0, 120),
  )

  // 7) 已启用适配器失败时不静默回退
  const fallback = await post('/api/creative/ingest', {
    sessionId: session.id,
    url: 'https://v.douyin.com/demo/',
    adapter: 'dtk',
  })
  check('失败不回退到直链', fallback.ok === false && !/video\/mp4/.test(JSON.stringify(fallback)), String(fallback.message).slice(0, 80))

  // 8) 凭据不出现在错误与线程里
  const thread = await api(`/api/creative/sessions/${session.id}/thread`)
  check('线程不含凭据', !JSON.stringify(thread).includes('dtk-secret'))

  // 9) 设置页 UI：创意分组可打开并保存
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(APP, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.locator('.st-nav').waitFor({ timeout: 15000 })
    // 设置页分组里也有「创意」，限定在导航里点
    await page.locator('.st-nav').getByRole('button', { name: '创意', exact: true }).click()
    await page.locator('[data-settings-creative]').waitFor({ timeout: 10000 })
    const sec = page.locator('[data-settings-creative]')
    const text = await sec.innerText()
    check('设置页有创意分组', text.includes('下载与摄取') && text.includes('能力绑定'), text.slice(0, 120))
    check('yt-dlp 字段可见', (await sec.locator('[data-creative-ytdlp-bin]').count()) === 1)
    check('DTK 字段可见', (await sec.locator('[data-creative-dtk-url]').count()) === 1)
    check('能力绑定七项', (await sec.locator('[data-creative-binding]').count()) === 7)
    check('成本开关可见', (await sec.locator('[data-creative-confirm]').count()) === 1)

    // 能力绑定只列该能力的模型；当前种子设置里没有 vision 模型，下拉应只有「跟随全局」
    const visionOptions = await sec.locator('[data-creative-binding="vision"] select option').allInnerTexts()
    // 预设里已有视觉模型时下拉应有真实选项，但第一项始终是「跟随全局」
    check(
      '视觉绑定首项为跟随全局',
      visionOptions.length >= 1 && visionOptions[0].includes('跟随全局'),
      visionOptions.slice(0, 4).join(' | '),
    )

    // 改一个成本开关并保存（不依赖具体模型）
    await sec.locator('[data-creative-confirm]').selectOption('off')
    await page.getByRole('button', { name: /保存/ }).first().click()
    await page.waitForTimeout(1200)
    const afterSave = (await api('/api/settings')).settings
    check('设置页保存了成本开关', afterSave.creative?.confirmCost === false, String(afterSave.creative?.confirmCost))
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
