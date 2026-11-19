/**
 * 创意入口体感验收：骨架出现 → 外壳可见。
 *
 * 这条链路以前有两处不必要的等待，都会表现成「点创意后骨架一直转」：
 * 1. 每个 `/studio/*` 请求都顺带做全量配置同步（同步阻塞，串行化启动期请求）；
 * 2. 桌面端预热要等 2 秒才开始，而 Electron 恢复路由可能直接落在创意视图。
 *
 * 这里量的是**预热完成后**那一段：宿主已就绪，用户点进创意，
 * 从应用自己的骨架（`.studio-frame`）出现到宿主外壳可见（`data-state="ready"`）
 * 应该只花文档载入与插件树激活的时间，不含宿主冷启动。
 *
 * 前置：npm run build:server && npx vite build（或 npm run build）
 * 跑法：node verify-studio-entry-latency.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const ROOT = process.cwd()
const ENTRY = path.join(ROOT, 'server', 'index.mjs')
const BUNDLE = path.join(ROOT, 'server-build', 'app.mjs')
const DIST = path.join(ROOT, 'dist', 'index.html')
/** 验收线：骨架到外壳可见，预热完成后不应超过这个时长 */
const BUDGET_MS = 400

if (!fs.existsSync(BUNDLE)) {
  console.error('缺少 server-build/app.mjs，先运行 npm run build:server')
  process.exit(1)
}
if (!fs.existsSync(DIST)) {
  console.error('缺少 dist/index.html，先运行 npx vite build')
  process.exit(1)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-studio-entry-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME = `proj-entry-${Date.now()}`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

fs.mkdirSync(PROJECTS, { recursive: true })
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
createProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, { title: '入口时延夹具' })
writeProject(${JSON.stringify(PROJECTS)}, ${JSON.stringify(NAME)}, {
  source: '一场雨夜的戏',
  episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'E01-S01', seconds: 3, size: '中景', desc: '街口' }],
})
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS } })

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: PROJECTS,
    SB_STATE_ROOT: path.join(TMP, 'state'),
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    SB_CREATIVE_STUDIO: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`服务启动超时：${log.slice(-800)}`)), 120_000)
  child.stdout.on('data', (c) => {
    log += c.toString()
    const m = log.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  child.stderr.on('data', (c) => {
    log += c.toString()
  })
  child.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${log.slice(-800)}`))
  })
})
const APP = `http://127.0.0.1:${port}`

/** 等到宿主就绪：这条用例量的是「预热之后」的那一段，不含冷启动 */
async function waitHostReady(timeout = 180_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const s = await (await fetch(`${APP}/studio/_host/status`)).json().catch(() => ({}))
    if (s.state === 'ready') return s
    if (s.state === 'failed') throw new Error(`宿主启动失败：${s.error || ''}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`宿主未就绪：${log.slice(-800)}`)
}

/** 触发首次鉴权拉起（未带令牌时 303，属正常） */
await fetch(`${APP}/studio/`, { redirect: 'manual' }).catch(() => {})
const readyStatus = await waitHostReady()
check('预热完成：宿主已就绪', readyStatus.state === 'ready', `port=${readyStatus.port}`)

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
let measured = null
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  // 从「页面开始导航」计时；骨架出现与外壳可见都由页面自己记录
  await page.addInitScript(() => {
    window.__entryMarks = {}
    const watch = () => {
      const frame = document.querySelector('.studio-frame')
      if (frame && !window.__entryMarks.skeleton) {
        window.__entryMarks.skeleton = performance.now()
      }
      if (frame?.getAttribute('data-state') === 'ready' && !window.__entryMarks.shell) {
        window.__entryMarks.shell = performance.now()
      }
      if (!window.__entryMarks.shell) requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('.studio-frame[data-state="ready"]').waitFor({ state: 'visible', timeout: 60_000 })
  measured = await page.evaluate(() => window.__entryMarks)
} finally {
  await browser.close()
}

check('骨架与外壳都留下了时间戳', Boolean(measured?.skeleton && measured?.shell), JSON.stringify(measured))
const elapsed = measured?.skeleton && measured?.shell ? Math.round(measured.shell - measured.skeleton) : NaN
check(`骨架 → 外壳可见 ≤ ${BUDGET_MS}ms`, Number.isFinite(elapsed) && elapsed <= BUDGET_MS, `实测 ${elapsed}ms`)

console.log('\n实测数据（可写入 docs/creative-host.md 基线表）：')
console.log(`| 骨架 → 外壳可见（预热完成后进入） | ${elapsed}ms |`)

child.kill()
await new Promise((resolve) => {
  child.on('exit', resolve)
  setTimeout(resolve, 5000)
})
fs.rmSync(TMP, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
