/**
 * verify-desktop-host.mjs — 桌面端宿主行为验收
 *
 * 为什么用真 Electron 而不是 mock：这里要验的正是「进程能不能起来、端口会不会
 * 残留、崩溃后能不能恢复」这类只有真跑才看得见的行为。用 Playwright 的
 * `_electron.launch()` 驱动的是打包后同一份主进程代码。
 *
 * 覆盖：
 *   1. 正常启动进到应用界面（splash → 服务地址）
 *   2. 单实例：第二个实例立即退出，不新增服务进程
 *   3. 退出后无残留监听端口
 *   4. 服务崩溃 → 断连页 → 重启后回到原 hash 路由
 *   5. 主进程被 SIGKILL 后服务不会长期占端口
 *
 * 用法：node verify-desktop-host.mjs
 */
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { _electron as electron } from 'playwright-core'

const ROOT = process.cwd()
const results = []
const cleanup = []

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      results.push({ name, ok: true })
      console.log(`  ok   ${name}`)
    })
    .catch((e) => {
      results.push({ name, ok: false, message: e?.message || String(e) })
      console.log(`  FAIL ${name}\n       ${e?.message || e}`)
    })
}

function sh(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}

/** 该端口是否还有 LISTEN（TCP 连接探测，比依赖 lsof 的 PATH 更稳） */
function listening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    const done = (v) => {
      sock.destroy()
      resolve(v)
    }
    sock.once('connect', () => done(true))
    sock.once('error', () => done(false))
    sock.setTimeout(1500, () => done(false))
  })
}

/**
 * 当前由桌面端拉起的服务进程 pid 列表。
 * 入口已从 desktop/main/service-entry.mjs 移到 server/desktop-entry.mjs
 * （打包后 desktop/main 进 asar，spawn 出来的纯 Node 读不到）。
 */
function servicePids() {
  return sh('pgrep -f "desktop-entry.mjs"')
    .split('\n')
    .filter(Boolean)
}

const ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d+\//

// ---------------------------------------------------------------- 1. 正常启动

let app = null
let page = null
let origin = ''
let port = 0

await check('启动画面先行，握手后切到应用界面', async () => {
  app = await electron.launch({ args: ['.'], cwd: ROOT })
  cleanup.push(async () => {
    try {
      await app?.close()
    } catch {
      /* ignore */
    }
  })
  page = await app.firstWindow()

  // 尽早抓 splash：它存在时间很短，抓不到说明握手太快或页面跳错了
  const early = page.url()
  assert.ok(
    early.startsWith('file://') && early.includes('splash.html'),
    `首个页面应是本地 splash，实际：${early}`,
  )

  await page.waitForURL(ORIGIN_RE, { timeout: 60_000 })
  origin = new URL(page.url()).origin
  port = Number(new URL(page.url()).port)
  assert.ok(port > 0, `应拿到系统分配端口，实际：${port}`)

  // 真实界面：窗口里有应用外壳，而不是空 body
  await page.waitForSelector('.rail, #root > *', { timeout: 30_000 })
  assert.ok(await listening(port), `服务应正在监听 ${port}`)
})

// ---------------------------------------------------------------- 2. 单实例

await check('第二个实例立即退出且不新增服务进程', async () => {
  const before = servicePids()
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['node_modules/electron/cli.js', '.', '--no-sandbox'], {
      cwd: ROOT,
      stdio: 'ignore',
      env: process.env,
    })
    // 拿不到单实例锁时应当很快自己退出；10 秒还不退就是没拦住
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve('timeout')
    }, 10_000)
    child.once('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })
  assert.equal(code, 0, `第二个实例应以 0 退出，实际：${code}`)
  assert.deepEqual(servicePids(), before, '第二个实例不应拉起新的服务进程')
})

// ---------------------------------------------------------------- 3. 退出收尸

await check('正常退出后端口不再监听', async () => {
  const dyingPort = port
  await app.close()
  app = null
  // 给 SIGTERM 一点时间
  for (let i = 0; i < 20; i++) {
    if (!(await listening(dyingPort))) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.equal(await listening(dyingPort), false, `退出后 ${dyingPort} 仍在监听`)
})

// ---------------------------------------------------------------- 4. 崩溃恢复

await check('服务崩溃 → 断连页 → 重启后回到原路由', async () => {
  app = await electron.launch({ args: ['.'], cwd: ROOT })
  page = await app.firstWindow()
  await page.waitForURL(ORIGIN_RE, { timeout: 60_000 })
  await page.waitForSelector('.rail, #root > *', { timeout: 30_000 })

  // 先建一个探针项目，项目路由才会生效
  await page.evaluate(async () => {
    await fetch('/api/project?name=desktop-host-probe&create=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '桌面端验收探针' }),
    })
  })
  const route = '#/p/desktop-host-probe/shots'
  const base = page.url().replace(/#.*$/, '')
  await page.goto(`${base}${route}`)
  await page.waitForTimeout(1500)
  assert.equal(await page.evaluate(() => location.hash), route, '探针路由未生效')

  // 强杀服务，模拟崩溃（与主动停止要区分开）
  const pids = servicePids()
  assert.ok(pids.length >= 1, '应能找到服务进程')
  sh(`kill -9 ${pids[0]}`)

  await page.waitForSelector('#retry', { timeout: 30_000 })
  assert.match(await page.locator('#title').innerText(), /断开|失败/, '应显示断连/失败页')

  await page.click('#retry')
  await page.waitForURL(ORIGIN_RE, { timeout: 60_000 })
  await page.waitForTimeout(2000)
  assert.equal(await page.evaluate(() => location.hash), route, '重启后未回到原路由')
})

// ---------------------------------------------------------------- 5. 强杀主进程

await check('主进程被 SIGKILL 后服务不长期占端口', async () => {
  const dyingPort = Number(new URL(page.url()).port)
  assert.ok(await listening(dyingPort), '前置条件：端口应正在监听')
  const mainPid = await app.evaluate(() => process.pid)
  sh(`kill -9 ${mainPid}`)
  app = null
  // 看门狗每 2 秒探测一次，给 8 秒余量
  for (let i = 0; i < 32; i++) {
    if (!(await listening(dyingPort))) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.equal(await listening(dyingPort), false, `主进程被强杀后 ${dyingPort} 仍在监听`)
})

// ---------------------------------------------------------------- 清理

for (const fn of cleanup.reverse()) await fn().catch(() => {})

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
// 兜底：别把测试用的 electron 留在后台
sh('pkill -f "MacOS/Electron \\." || true')
fs.rmSync('/tmp/desktop-host-verify.log', { force: true })
process.exit(failed ? 1 : 0)
