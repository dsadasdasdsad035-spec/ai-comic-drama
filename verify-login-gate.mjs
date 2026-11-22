/**
 * 登录闸门回归：账号页全局路由 + 未登录时的项目视图可达性。
 *
 * 用真实后端（临时项目目录 + 真计费库），不 mock 项目/设置接口：
 * 这个脚本要断言「真的被拦住、真的能写回、真的能回跳」，mock 掉这些
 * 链路就只剩一堆自说自话的断言。
 *
 * 跑法：node verify-login-gate.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { createCheck, makeProjectsDir, seed, startApp } from './verify-harness.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5351
const PROJECTS = makeProjectsDir('login-gate-')
const PROJECT = 'gate-proj'
const check = createCheck()

/* ---------------------------------------------------------------- 纯函数：路由 */

// bundle 必须落在仓库内：nav.ts 依赖 lucide-react，放在系统临时目录会解析不到
const tmp = fs.mkdtempSync(path.join(root, 'node_modules', '.verify-login-gate-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(path.join(root, 'src/shell/route.ts'))}`,
    `export * from ${JSON.stringify(path.join(root, 'src/shell/nav.ts'))}`,
  ].join('\n') + '\n',
)
const bundle = path.join(tmp, 'bundle.mjs')
execFileSync(path.join(root, 'node_modules', '.bin', 'esbuild'), [
  entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', '--external:react', '--external:lucide-react', `--outfile=${bundle}`,
])
const route = await import(bundle)

check('#/ 是项目大厅', route.parseHash('#/').kind === 'hub')
check('#/account 是账号页', route.parseHash('#/account').kind === 'account')
check(
  '#/account?next 带回目标',
  route.parseHash('#/account?next=%23%2Fp%2Fa%2Fboard').next === '#/p/a/board',
)
check(
  '旧项目内账号链接归一成账号页',
  route.parseHash('#/p/a/account').kind === 'account',
)
check('站外 next 被丢弃', route.parseHash('#/account?next=https%3A%2F%2Fevil.com').next === undefined)
check('自指的 next 被丢弃', route.parseHash('#/account?next=%23%2Faccount').next === undefined)
check('非法 next 编码不炸', route.parseHash('#/account?next=%23%252F').next === undefined)
check('accountHash 不带 target', route.accountHash() === '#/account')
check(
  'accountHash 带 target',
  route.accountHash('#/p/a/board') === '#/account?next=%23%2Fp%2Fa%2Fboard',
)
check('accountHash 丢弃站外 target', route.accountHash('https://evil.com') === '#/account')
check(
  '侧栏导航不含账号项',
  !route.NAV_ITEMS.some((i) => i.id === 'account'),
  route.NAV_ITEMS.map((i) => i.id).join(','),
)
check(
  '导航分组不含空账户组',
  !route.NAV_GROUPS.some((g) => g.id === 'account'),
)
check(
  'ViewId 白名单不含 account',
  !route.isViewId('account'),
)

/* ---------------------------------------------------------------- 真实后端 */

seed(
  PROJECTS,
  `import { createProject, writeProject } from ${JSON.stringify(path.join(root, 'server', 'db.mjs'))}
const rootDir = ${JSON.stringify(PROJECTS)}
createProject(rootDir, ${JSON.stringify(PROJECT)}, { title: 'gate-proj' })
writeProject(rootDir, ${JSON.stringify(PROJECT)}, {
  episodes: [{ no: 1, title: 'E1' }],
  shots: [{ id: 'E01-S01', episode: 1, no: 'S01', seconds: 3, desc: 'S01', dialogue: [], cast: [] }],
})
console.log('{}')
`,
)

/**
 * 计费库与项目库是两个库，临时目录里都要落到临时位置。
 * 必须在 startApp **之前**设好 BILLING_DB_PATH：dev server 是子进程，
 * 启动后再改环境变量它看不到，闸门会一直读到默认的 false。
 */
const billingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-gate-bill-'))
process.env.BILLING_DB_PATH = path.join(billingDir, 'billing.sqlite')

const { app, stop } = await startApp({ projectsDir: PROJECTS, port: PORT })

const { patchBillingSettings } = await import('./server/billing/settings.mjs')
const { openBillingDbFile } = await import('./server/billing/db.mjs')
const { registerUser, createVerifyToken, verifyEmail } = await import('./server/billing/auth.mjs')
// 脚本进程要读写同一个计费库：先打开，否则 patchBillingSettings 抛「DB 未打开」
openBillingDbFile(process.env.BILLING_DB_PATH)

async function setBillingEnabled(enabled) {
  patchBillingSettings({ billing_enabled: enabled })
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
/** dev server 没有 StudioToolBridge，canvas-context 404 是既有噪音 */
const NOISE = /canvas-context|Failed to load resource/
const attachLogs = (p) => {
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('console', (m) => {
    if (m.type() !== 'error') return
    if (NOISE.test(m.text())) return
    errors.push(m.text())
  })
}
attachLogs(page)

const hashOf = (p) => p.evaluate(() => window.location.hash)
const waitHash = async (p, re, timeout = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (re.test(await hashOf(p))) return true
    await p.waitForTimeout(120)
  }
  return false
}

try {
  /* -------------------------------------------------- 计费关闭：不拦 */

  await setBillingEnabled(false)
  await page.goto(`${app}/#/p/${PROJECT}/board`, { waitUntil: 'domcontentloaded' })
  // 画布先出分集目录，能停在这里就说明没被拦（不该出现账号页）
  await page.locator('.board-ep-card, [data-canvas-shots]').first().waitFor({ timeout: 20000 })
  check('计费关闭时未登录可进画布', /#\/p\/[^/]+\/board/.test(await hashOf(page)))
  check(
    '计费关闭时不渲染账号页',
    (await page.locator('[data-acct-logged-in]').count()) === 0,
  )

  /* -------------------------------------------------- 大厅账号入口 */

  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })
  await page.locator('[data-hub-account]').waitFor({ timeout: 10000 })
  check(
    '大厅有账号入口且未登录显示登录',
    (await page.locator('[data-hub-account]').innerText()).includes('登录'),
  )

  /* -------------------------------------------------- 计费开启：四条入口 */

  await setBillingEnabled(true)

  // 1) 深链接。开关是部署期配置：切换后必须重新加载，前端才会重新探会话
  await page.goto('about:blank')
  await page.goto(`${app}/#/p/${PROJECT}/board`, { waitUntil: 'domcontentloaded' })
  await waitHash(page, /^#\/account/, 12000)
  check('深链接被拦到账号页', /^#\/account/.test(await hashOf(page)))
  check('被拦时带回 next', /next=/.test(await hashOf(page)))
  check(
    '被拦时不渲染画布',
    (await page.locator('[data-canvas-shots], .board-ep-card').count()) === 0,
  )

  // 2) 大厅点项目
  await page.goto(`${app}/#/`, { waitUntil: 'networkidle' })
  await page.locator('[data-hub-account]').waitFor({ timeout: 10000 })
  await page.locator('.hub-card:not(.is-skeleton)').first().click()
  await waitHash(page, /^#\/account/, 12000)
  check('大厅点项目被拦到账号页', /^#\/account/.test(await hashOf(page)))

  // 3) 账号页必须能回大厅：它是独立整屏，没有面包屑
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    attachLogs(p)
    await p.goto(`${app}/#/account`, { waitUntil: 'domcontentloaded' })
    await p.locator('[data-acct-back]').waitFor({ timeout: 12000 })
    await p.locator('[data-acct-back]').click()
    const ok = await waitHash(p, /^#\/$/, 8000)
    check('未登录时账号页可回大厅', ok, await hashOf(p))
    await p.close()
  }

  // 3) 探测失败不拦：宁可放行，也不要把「后端挂了」渲染成「请登录」
  {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    attachLogs(p)
    await p.route('**/api/auth/me', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"message":"boom"}' }))
    await p.goto(`${app}/#/p/${PROJECT}/board`, { waitUntil: 'domcontentloaded' })
    await p.locator('.board-ep-card, [data-canvas-shots]').first().waitFor({ timeout: 20000 })
    check('身份探测失败时不跳登录页', /\/board$/.test(await hashOf(p)), await hashOf(p))
    await p.close()
  }

  // 3) 设置页放行
  await page.goto(`${app}/#/p/${PROJECT}/settings`, { waitUntil: 'domcontentloaded' })
  await page.locator('.settings').first().waitFor({ timeout: 15000 })
  check('设置页放行', /\/settings$/.test(await hashOf(page)))
  check('设置页不被渲染成账号页', (await page.locator('[data-acct-logged-in]').count()) === 0)
} finally {
  await browser.close()
  stop()
}

/* -------------------------------------------------- 登录后回跳 */

try {
  const file = process.env.BILLING_DB_PATH
  const { openBillingDbFile } = await import('./server/billing/db.mjs')
  openBillingDbFile(file)
  const { userId } = registerUser('gate@example.com', 'password123')
  verifyEmail(createVerifyToken(userId))

  const { stop: stop2, app: app2 } = await startApp({ projectsDir: PROJECTS, port: PORT + 1 })
  const b2 = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })
  const p2 = await b2.newPage({ viewport: { width: 1440, height: 900 } })
  attachLogs(p2)
  try {
    await setBillingEnabled(true)
    // 带 next 打开账号页并登录
    await p2.goto(
      `${app2}/#/account?next=${encodeURIComponent(`#/p/${PROJECT}/board`)}`,
      { waitUntil: 'domcontentloaded' },
    )
    await p2.locator('input[type=email]').waitFor({ timeout: 12000 })
    await p2.locator('input[type=email]').fill('gate@example.com')
    await p2.locator('input[type=password]').first().fill('password123')
    await p2.locator('.acct-submit').click()
    const back = await waitHash(p2, new RegExp(`#/p/${PROJECT}/board`), 15000)
    check('登录后回到原目标视图', back)

    // 目标项目已删除：登录后应落回大厅而不是白屏
    {
      const p3 = await b2.newPage({ viewport: { width: 1440, height: 900 } })
      attachLogs(p3)
      await p3.context().clearCookies()
      await p3.goto(
        `${app2}/#/account?next=${encodeURIComponent('#/p/does-not-exist/board')}`,
        { waitUntil: 'domcontentloaded' },
      )
      await p3.locator('input[type=email]').waitFor({ timeout: 12000 })
      await p3.locator('input[type=email]').fill('gate@example.com')
      await p3.locator('input[type=password]').first().fill('password123')
      await p3.locator('.acct-submit').click()
      await p3.waitForTimeout(2200)
      const h = await p3.evaluate(() => window.location.hash)
      check('目标项目已删除时回落大厅', h === '#/' || h === '', h)
      await p3.close()
    }

    // 登录后账号页仍是「余额 + 充值 + 流水」，充值面板未被全局化改造弄丢
    {
      const p4 = await b2.newPage({ viewport: { width: 1440, height: 900 } })
      attachLogs(p4)
      await p4.context().clearCookies()
      await p4.goto(`${app2}/#/account`, { waitUntil: 'domcontentloaded' })
      await p4.locator('input[type=email]').waitFor({ timeout: 12000 })
      await p4.locator('input[type=email]').fill('gate@example.com')
      await p4.locator('input[type=password]').first().fill('password123')
      await p4.locator('.acct-submit').click()
      await p4.locator('.acct-panel[aria-label="充值"]').waitFor({ timeout: 15000 })
      check('登录后账号页仍有充值面板', true)
      check(
        '充值面板不是禁用态',
        (await p4.locator('.acct-panel[aria-label="充值"]').getAttribute('aria-disabled')) !== 'true',
      )
      await p4.close()
    }

    // 已登录同样要能回大厅
    {
      const p5 = await b2.newPage({ viewport: { width: 1440, height: 900 } })
      attachLogs(p5)
      await p5.goto(`${app2}/#/account`, { waitUntil: 'domcontentloaded' })
      await p5.locator('[data-acct-back]').waitFor({ timeout: 12000 })
      await p5.locator('[data-acct-back]').click()
      const ok = await waitHash(p5, /^#\/$/, 8000)
      check('已登录时账号页可回大厅', ok, await hashOf(p5))
      await p5.close()
    }

    // 已登录再进项目视图不再被拦
    await p2.goto(`${app2}/#/p/${PROJECT}/assets`, { waitUntil: 'domcontentloaded' })
    await p2.waitForTimeout(1200)
    check('已登录不再被拦', /\/assets$/.test(await hashOf(p2)))
  } finally {
    await b2.close()
    stop2()
  }
} catch (e) {
  check('登录回跳链路', false, (e && e.message) || String(e))
}

console.log(check.bad() ? `\n❌ ${check.bad()} 项失败` : '\n✅ 全部通过')
process.exit(check.bad() ? 1 : 0)
