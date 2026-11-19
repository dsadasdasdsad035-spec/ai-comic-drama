/**
 * 创意会话的「当前项目」推送验收。
 *
 * 宿主是一个进程服务所有创意会话，拿不到浏览器顶栏选了什么；应用侧必须在
 * 进入创意视图与切项目时把项目名推给 `/api/studio/project`，否则 32 个
 * 依赖项目的平台工具在会话里只会报「请先在顶栏选择项目」。
 *
 * 覆盖：
 * 1. 顶栏项目 A → 进创意视图 → `GET /api/studio/project` 返回 A
 * 2. 顶栏切到项目 B → 返回 B（同一视图，不重建创意页）
 * 3. 回到大厅（没有项目）→ 推送空串，服务端记录被清除
 * 4. 同一个项目只推一次（不因重渲染反复 POST）
 *
 * 为什么不用 vite dev server：`/api/studio/*` 与 `/studio/` 反代只在独立入口
 * （`server/index.mjs`）里存在，dev server 走的是 `server/app.ts` 的接口集合。
 *
 * 前置：npm run build:server && npx vite build（或 npm run build）
 * 跑法：node verify-studio-project-context.mjs
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

if (!fs.existsSync(BUNDLE)) {
  console.error('缺少 server-build/app.mjs，先运行 npm run build:server')
  process.exit(1)
}
if (!fs.existsSync(DIST)) {
  console.error('缺少 dist/index.html，先运行 npx vite build')
  process.exit(1)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-studio-project-'))
const PROJECTS = path.join(TMP, 'projects')
const NAME_A = `proj-ctx-a-${Date.now()}`
const NAME_B = `proj-ctx-b-${Date.now()}`

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---- 夹具：两个项目（顶栏切换需要至少两处落脚点） ----
fs.mkdirSync(PROJECTS, { recursive: true })
const seed = path.join(TMP, 'seed.mjs')
fs.writeFileSync(
  seed,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(ROOT, 'server', 'db.mjs'))}
for (const [name, title] of [[${JSON.stringify(NAME_A)}, '项目上下文 A'], [${JSON.stringify(NAME_B)}, '项目上下文 B']]) {
  createProject(${JSON.stringify(PROJECTS)}, name, { title })
  writeProject(${JSON.stringify(PROJECTS)}, name, {
    source: '一场雨夜的戏',
    episodes: [{ no: 1, title: '第一集', targetSeconds: 60 }],
    shots: [{ id: 'E01-S01', episode: 1, no: 'E01-S01', seconds: 3, size: '中景', desc: '街口' }],
  })
}
`,
)
execFileSync(process.execPath, [seed], { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: PROJECTS } })

/** 起独立入口：系统分配端口，从握手行读回 */
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
  const timer = setTimeout(() => reject(new Error(`服务启动超时：${log.slice(-800)}`)), 60_000)
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

/** 服务端记录的当前项目（本机单操作员模式，node 侧直接读即可） */
const readCurrent = async () => {
  const r = await fetch(`${APP}/api/studio/project`)
  const j = await r.json().catch(() => ({}))
  return String(j.name ?? '')
}

/** 轮询到期望值；失败时把最后读到的值带出去，便于看时序问题 */
async function waitCurrent(expected, timeout = 15000) {
  const until = Date.now() + timeout
  let last = ''
  while (Date.now() < until) {
    last = await readCurrent()
    if (last === expected) return { ok: true, last }
    await new Promise((r) => setTimeout(r, 200))
  }
  return { ok: false, last }
}

/** 只数页面自己发的 POST：GET 也会打到同一路径，不能一起数 */
const postCount = (requests) =>
  requests.filter((r) => r.method === 'POST' && r.url.includes('/api/studio/project')).length

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  const posts = []
  page.on('request', (r) => {
    if (r.url().includes('/api/studio/project')) posts.push({ method: r.method(), url: r.url() })
  })

  await page.goto(`${APP}/#/p/${encodeURIComponent(NAME_A)}/creative`, { waitUntil: 'domcontentloaded' })
  await page.locator('.studio-frame').waitFor({ state: 'visible', timeout: 30000 })

  const first = await waitCurrent(NAME_A)
  check('进创意视图后 GET /api/studio/project 返回顶栏项目', first.ok, `读到 ${first.last}`)

  const afterFirst = postCount(posts)
  // 给重渲染与宿主状态探测留一点时间：不该再多发
  await page.waitForTimeout(1200)
  check('同一项目不重复推送', postCount(posts) === afterFirst, `POST ${postCount(posts)} 次`)

  // 切到 B：走 hash（生产静态页同样只改路由），仍停在创意视图
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, `#/p/${encodeURIComponent(NAME_B)}/creative`)
  const second = await waitCurrent(NAME_B)
  check('切项目后 GET 反映新项目', second.ok, `读到 ${second.last}`)
  check(
    '切项目后创意页没有重建',
    (await page.locator('.studio-frame').count()) === 1,
    `.studio-frame ${await page.locator('.studio-frame').count()} 个`,
  )

  // 回大厅：没有项目，服务端记录应被清空
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  const cleared = await waitCurrent('')
  check('回到大厅推送空串并清除记录', cleared.ok, `读到 ${cleared.last}；POST ${postCount(posts)} 次`)
} finally {
  await browser.close()
  child.kill()
  await new Promise((resolve) => {
    child.on('exit', resolve)
    setTimeout(resolve, 5000)
  })
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} 项未通过` : '\n创意会话项目上下文推送验收全部通过')
process.exit(bad ? 1 : 0)
