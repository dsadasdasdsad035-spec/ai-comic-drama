/**
 * 素材 · 视频：分享口令提取 → yt-dlp/DTK → 视频库 → UI 列表。
 * 跑法：node verify-asset-video-link-flow.mjs
 * 可选：REAL_BILIBILI=1 用 yt-dlp 拉一条公开 B 站短片（需外网）
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'
import { extractIngestUrl } from './server/ingest-url.mjs'
import { ingestShot3dReference } from './server/shot3d-ingest.mjs'
import { resolveRoot, readProject, createProject } from './server/db.mjs'

const PORT = 5379
const check = createCheck()
const PROJECTS = makeProjectsDir('asset-vid-flow-')
const PROJ = `vid-flow-${Date.now()}`
const ROOT = process.cwd()

const YTDLP = process.env.YTDLP_BIN || '/opt/homebrew/bin/yt-dlp'
const hasYtdlp = fs.existsSync(YTDLP)

// 桩 DTK：返回公网 fixture MP4（走 example.com 占位，实际用 files 子服务）
const SAMPLE = path.join(PROJECTS, 'sample.mp4')
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'color=c=blue:s=240x136:d=1.2:r=24',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SAMPLE,
])

const cdnServer = http.createServer((req, res) => {
  if (req.url === '/short.mp4' && req.method === 'GET') {
    const buf = fs.readFileSync(SAMPLE)
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': buf.length })
    res.end(buf)
    return
  }
  res.writeHead(404).end()
})
await new Promise((r) => cdnServer.listen(0, '0.0.0.0', r))
const CDN_PORT = cdnServer.address().port
/** 公网样本 MP4，避免 DTK 回 127.0.0.1 被 SSRF 拦 */
const CDN_URL =
  process.env.INGEST_FIXTURE_URL ||
  'https://www.learningcontainer.com/wp-content/uploads/2020/05/sample-mp4-file.mp4'

const dtkSeen = []
const dtkServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const pathname = String(req.url || '').split('?')[0]
    dtkSeen.push({ url: req.url, method: req.method, body })
    if (pathname === '/api/v1/parse' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          success: true,
          data: {
            /** 勿用 douyin：摄取会给 CDN 带抖音 Referer，公网 fixture 会 403 */
            platform: 'fixture',
            desc: '桩解析',
            media: { video: { url: CDN_URL } },
          },
        }),
      )
      return
    }
    res.writeHead(404).end()
  })
})
await new Promise((r) => dtkServer.listen(0, '127.0.0.1', r))
const DTK_PORT = dtkServer.address().port

seed(
  PROJECTS,
  `import { createProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
const root = ${JSON.stringify(PROJECTS)}
createProject(root, ${JSON.stringify(PROJ)}, { title: '视频链验收' })
console.log('{}')
`,
)

process.env.SB_PROJECTS_DIR = PROJECTS
const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })

const api = async (p, init) => {
  const r = await fetch(`${app}${p}`, init)
  return r.json()
}
const put = (p, body) =>
  api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// ---- 1) 口令提取 ----
const shareText =
  '7.48 复制打开抖音 https://v.douyin.com/flow-test/ 看看作品'
const extracted = extractIngestUrl(shareText)
check('口令提取抖音短链', extracted === 'https://v.douyin.com/flow-test/')
check(
  '口令提取 B 站',
  extractIngestUrl('【测试】 https://www.bilibili.com/video/BV1GJ411x7h7') ===
    'https://www.bilibili.com/video/BV1GJ411x7h7',
)

// ---- 2) 设置 yt-dlp + DTK ----
await put('/api/settings', {
  creative: {
    ingest: {
      ytdlp: { enabled: hasYtdlp, bin: hasYtdlp ? YTDLP : '', cookiesFromBrowser: '' },
      dtk: { enabled: true, baseUrl: `http://127.0.0.1:${DTK_PORT}`, apiKey: 'flow-test-key' },
    },
  },
})
const adapters = await api('/api/creative/adapters')
const ytdlp = (adapters.adapters || []).find((a) => a.id === 'ytdlp')
const dtk = (adapters.adapters || []).find((a) => a.id === 'dtk')
check('DTK 适配器可用', dtk?.ok === true, dtk?.reason)
if (hasYtdlp) check('yt-dlp 适配器可用', ytdlp?.ok === true, ytdlp?.reason)

// ---- 3) API：抖音分享链 → DTK → 视频库 ----
dtkSeen.length = 0
const douyinPhrase = shareText
const ing = await post('/api/shot-3d/ingest-reference', {
  projectName: PROJ,
  url: douyinPhrase,
})
check('抖音口令 API 摄取成功', ing.ok === true, ing.message)
check('DTK parse 被调用', dtkSeen.some((x) => String(x.url).includes('/api/v1/parse')), JSON.stringify(dtkSeen))
check('返回站内 URL', String(ing.videoUrl || '').startsWith('/project-assets/'))
const proj1 = readProject(resolveRoot(ROOT), PROJ)
check('project.assets 有视频', (proj1?.assets || []).some((a) => a.kind === 'video'), JSON.stringify(proj1?.assets))

// ---- 4) 可选：真实 B 站 yt-dlp ----
if (process.env.REAL_BILIBILI === '1' && hasYtdlp) {
  const bili = await post('/api/shot-3d/ingest-reference', {
    projectName: PROJ,
    url: 'https://www.bilibili.com/video/BV1GJ411x7h7',
  })
  check('B 站 yt-dlp 真网摄取', bili.ok === true, String(bili.message).slice(0, 200))
} else {
  check('B 站真网跳过', true, '设置 REAL_BILIBILI=1 可测真网')
}

// ---- 5) Playwright：素材 · 视频 Tab ----
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } })
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(`${app}/#/p/${encodeURIComponent(PROJ)}/assets`, { waitUntil: 'networkidle' })
  await page.locator('[data-asset-video-tab]').click()
  await page.locator('[data-asset-video-board]').waitFor({ timeout: 20000 })
  await page.locator('[data-asset-video-add]').click()
  await page.locator('[data-asset-link-ingest]').waitFor({ timeout: 10000 })
  check('解析器状态行', (await page.locator('[data-asset-ingest-adapters]').count()) === 1)
  const hint = await page.locator('[data-asset-ingest-adapters]').innerText()
  check('状态含 DTK', hint.includes('DTK'), hint)

  const listBefore = await page.locator('[data-asset-video-card]').count()
  check('列表已有 DTK 下载项', listBefore >= 1, String(listBefore))

  await page.locator('[data-asset-ingest-url]').fill(
    '推荐一个好物 https://v.douyin.com/ui-flow-test/ 打开看看',
  )
  await page.locator('[data-asset-ingest-submit]').click()
  await page.waitForTimeout(2500)
  const listAfter = await page.locator('[data-asset-video-card]').count()
  check('UI 口令下载后列表增加', listAfter > listBefore, `${listBefore}→${listAfter}`)

  const cards = await page.locator('[data-asset-video-card]').count()
  if (cards >= 1) {
    await page.locator('[data-asset-video-card]').first().getByRole('button', { name: '发布素材卡' }).click()
    await page.waitForTimeout(400)
  } else {
    check('可点发布素材卡', false, '前置摄取未产生视频卡片')
  }
  check('无前端脚本错误', errs.length === 0, errs.join(' | '))
} finally {
  await browser.close()
}

// ---- 6) 直连 ingest 模块（口令字段）----
const modProj = `ingest-mod-${Date.now()}`
createProject(resolveRoot(ROOT), modProj, { title: 'mod' })
const mod = await ingestShot3dReference(
  ROOT,
  {
    projectName: modProj,
    url: shareText,
  },
  {
    ingest: {
      dtk: { enabled: true, baseUrl: `http://127.0.0.1:${DTK_PORT}`, apiKey: 'flow-test-key' },
      ytdlp: { enabled: false, bin: '' },
    },
  },
)
check('ingest 模块口令路径', Boolean(mod.videoUrl), mod.videoUrl)

stop()
cdnServer.close()
dtkServer.close()
fs.rmSync(PROJECTS, { recursive: true, force: true })

const bad = check.bad()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 素材视频链接全流程验收通过')
process.exit(bad ? 1 : 0)