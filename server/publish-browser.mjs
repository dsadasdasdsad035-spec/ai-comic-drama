/**
 * 本机浏览器会话：用 playwright-core 的 launchPersistentContext 打开有头 Chrome。
 *
 * 设计要点：
 * - 一次只允许一个浏览器任务（并发 1），内存可控、失败可归因，也不给平台刷请求。
 * - 登录必须由人在真实窗口完成；这里只负责打开、等待、轮询结果，不做验证码绕过/指纹伪造。
 * - 超时一定关闭浏览器；profile 留在磁盘上，下次复用。
 * - 判定函数可注入，验证脚本用本地静态页模拟登录页/后台/断网，无需真实平台。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { sanitizeError, resolveChrome, hasDisplay, NO_DISPLAY_HINT, chromiumSandboxArgs } from './publish-utils.mjs'
import { getPlatform } from './publish-platforms.mjs'
import { getAdapter } from './publish-adapters.mjs'

/** 登录态判定：默认看 URL 是否落在登录页，以及页面是否出现后台标志 */
export const DEFAULT_LOGIN_HEURISTIC = {
  loginUrlHints: ['login', 'passport', 'signin', 'auth'],
  loggedInSelector: '',
}

/**
 * 用平台适配器的 checkSession 作为登录判定。
 *
 * 为什么不能用「URL 不含 login 就算登录成功」：抖音、B 站、小红书的后台地址本身
 * 就不含 login/passport，而登录框常常是同一 URL 上的弹层。那种兜底会让窗口在
 * 第一轮轮询就判定成功并立刻关闭，用户根本没机会扫码。
 *
 * 为什么也不能只看 DOM：抖音扫码成功后页面未必立刻出现上传框，等它出现会让
 * 已经成功的登录一直停在「等待扫码」。登录态的权威信号是平台会话 cookie。
 *
 * 所以判定顺序是：先认 cookie（权威、与页面渲染无关），再退回适配器的 DOM 判定。
 * DOM 判定仍保留连续两次确认，滤掉页面切换过程中的瞬态结构。
 */
export function adapterLoginProbe(platformId, opts = {}) {
  const platform = (() => {
    try {
      return getPlatform(platformId)
    } catch {
      return null
    }
  })()
  const adapter = getAdapter(platformId)
  const sessionCookies = Array.isArray(platform?.sessionCookies) ? platform.sessionCookies : []
  const requiredChecks = Math.max(1, Math.floor(Number(opts.requiredChecks) || 2))
  const gapMs = Math.max(0, Number(opts.gapMs) || 1_200)
  let hits = 0
  let lastHitAt = 0

  const hasSessionCookie = async (page) => {
    if (!sessionCookies.length) return false
    try {
      const ctx = typeof page.context === 'function' ? page.context() : null
      const cookies = ctx ? await ctx.cookies() : []
      return cookies.some((c) => sessionCookies.includes(c.name) && (c.value || '').length > 0)
    } catch {
      return false
    }
  }

  return async (page) => {
    // 1) 会话 cookie：扫码成功后立刻成立，不依赖页面是否刷新出上传框
    if (await hasSessionCookie(page)) return true

    // 2) 退回适配器的真实后台元素判定（连续两次）
    if (!adapter || typeof adapter.checkSession !== 'function') {
      hits = 0
      return false
    }
    let connected = false
    try {
      connected = (await adapter.checkSession(page))?.status === 'connected'
    } catch {
      connected = false
    }
    if (!connected) {
      hits = 0
      return false
    }
    const now = Date.now()
    if (hits > 0 && now - lastHitAt < gapMs) return false
    hits += 1
    lastHitAt = now
    return hits >= requiredChecks
  }
}

/**
 * @typedef {object} SessionJob
 * @property {string} id
 * @property {string} platform
 * @property {string} accountId
 * @property {'opening'|'awaiting'|'done'|'timeout'|'error'|'cancelled'} status
 * @property {string} message
 * @property {number} startedAt
 */

const sessions = new Map()
let activeSession = null

export function newLoginId() {
  return `pl-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

export function getSession(id) {
  return sessions.get(String(id || '')) || null
}

export function listSessions() {
  return [...sessions.values()]
}

export function browserBusy() {
  return Boolean(activeSession)
}

/** 只有「明确是登录页」才判为失效；其它异常交给调用方判 unknown */
export function looksLikeLoginUrl(url, heuristic = DEFAULT_LOGIN_HEURISTIC) {
  const u = String(url || '').toLowerCase()
  return heuristic.loginUrlHints.some((hint) => u.includes(hint))
}

/**
 * 清掉上次异常退出的 Chromium 单例锁。
 * 浏览器进程被 kill -9 或崩溃时，SingletonLock 会留在 profile 目录里，
 * 之后每次 launchPersistentContext 都报 ProcessSingleton 失败，永久打不开登录窗口。
 */
export function clearStaleSingletonLocks(profileDir) {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const p = path.join(profileDir, name)
    try {
      fs.rmSync(p, { force: true })
    } catch {
      /* 删不掉就让 launch 自己报错 */
    }
  }
}

async function loadChromium() {
  const mod = await import('playwright-core')
  return mod.chromium
}

/**
 * 打开有头浏览器并等待人工登录。
 * @param {object} opts
 * @param {string} opts.profileDir
 * @param {string} opts.url              要打开的创作者后台地址
 * @param {number} opts.timeoutMs        等待人工完成登录的上限
 * @param {(page:any)=>Promise<boolean>} [opts.isLoggedIn] 可注入判定
 * @param {()=>boolean} [opts.shouldStop] 取消信号
 */
export async function openLoginWindow(opts) {
  // 扫码登录必须有真实屏幕；无头浏览器里没有人能扫码，早点给明确原因而不是等超时
  if (!hasDisplay()) {
    return { ok: false, status: 'no-display', message: NO_DISPLAY_HINT }
  }
  const chromium = await loadChromium()
  const exe = resolveChrome()
  const launchOpts = {
    headless: false,
    viewport: null,
    args: ['--no-first-run', '--no-default-browser-check', ...chromiumSandboxArgs()],
  }
  if (exe) launchOpts.executablePath = exe
  else launchOpts.channel = 'chrome'

  fs.mkdirSync(opts.profileDir, { recursive: true, mode: 0o700 })
  // 上次异常退出（进程被杀）会留下 Singleton 锁，导致永久无法再打开同一 profile
  clearStaleSingletonLocks(opts.profileDir)
  const ctx = await chromium.launchPersistentContext(opts.profileDir, launchOpts)
  const page = ctx.pages()[0] || (await ctx.newPage())
  // 浏览器被外力关闭（kill、崩溃）时也必须让等待循环退出，否则会话永远卡住
  let closed = false
  ctx.on?.('close', () => {
    closed = true
  })
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  try {
    opts.onOpened?.({ url: page.url() })
  } catch {
    /* 回调失败不影响登录等待 */
  }

  // 登录是人的事：扫码 + 可能的短信验证，默认给 5 分钟
  const deadline = Date.now() + Math.max(5_000, Number(opts.timeoutMs) || 300_000)
  let result = { ok: false, status: 'timeout', message: '等待登录超时' }
  try {
    for (;;) {
      if (opts.shouldStop?.()) {
        result = { ok: false, status: 'cancelled', message: '已取消' }
        break
      }
      if (Date.now() > deadline) break
      if (closed) {
        result = { ok: false, status: 'cancelled', message: '登录窗口已关闭' }
        break
      }
      let loggedIn = false
      if (typeof opts.isLoggedIn === 'function') {
        try {
          loggedIn = Boolean(await opts.isLoggedIn(page))
        } catch {
          loggedIn = false
        }
      } else if (DEFAULT_LOGIN_HEURISTIC.loggedInSelector) {
        loggedIn = await page
          .locator(DEFAULT_LOGIN_HEURISTIC.loggedInSelector)
          .first()
          .isVisible()
          .catch(() => false)
      }
      // 没有明确判定时一律视为「还没登录」，等到超时或用户取消；
      // 绝不能因为 URL 不像登录页就替用户宣布登录成功。
      if (loggedIn) {
        result = { ok: true, status: 'done', message: '登录成功', url: page.url() }
        break
      }
      await page.waitForTimeout(1_000)
    }
  } catch (e) {
    const msg = String(e?.message || e)
    // 用户手动关掉窗口是正常操作，不该报成错误
    result = /closed|Target page, context or browser/i.test(msg)
      ? { ok: false, status: 'cancelled', message: '登录窗口已关闭' }
      : { ok: false, status: 'error', message: sanitizeError(e) }
  } finally {
    try {
      await ctx.close()
    } catch {
      /* ignore */
    }
  }
  return result
}

/**
 * 检查会话：明确跳登录页 → expired；网络/结构异常 → unknown。
 * 不做「看起来像后台就算成功」的猜测。
 */
export async function checkSession(opts) {
  const chromium = await loadChromium()
  const exe = resolveChrome()
  const launchOpts = { headless: true, args: ['--no-first-run', ...chromiumSandboxArgs()] }
  if (exe) launchOpts.executablePath = exe
  else launchOpts.channel = 'chrome'

  let ctx = null
  try {
    ctx = await chromium.launchPersistentContext(opts.profileDir, launchOpts)
    const page = ctx.pages()[0] || (await ctx.newPage())
    const resp = await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    if (!resp) return { status: 'unknown', message: '没有拿到页面响应' }
    // 4xx/5xx 都不能证明已登录：可能是路径变了、被限流或平台故障
    if (resp.status() >= 400) return { status: 'unknown', message: `平台返回 ${resp.status()}` }
    if (looksLikeLoginUrl(page.url())) return { status: 'expired', message: '登录已失效，请重新登录' }
    if (typeof opts.isLoggedIn === 'function') {
      const ok = await opts.isLoggedIn(page).catch(() => false)
      return ok
        ? { status: 'connected', message: '会话有效' }
        : { status: 'unknown', message: '页面结构无法确认登录状态' }
    }
    // 没有明确判定时不能假装已登录：宁可报「未知」让用户复查
    return { status: 'unknown', message: '无法确认登录状态' }
  } catch (e) {
    return { status: 'unknown', message: sanitizeError(e) }
  } finally {
    if (ctx) {
      try {
        await ctx.close()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * 启动一个后台登录流程；调用方轮询 getSession 获取状态。
 * 这里保持 sessions 的内存态：登录是一次性交互，不需要跨重启恢复。
 *
 * 完成方式有两种：
 * - requireConfirm=false（默认，首次连接）：检测到登录态且窗口已停留 minDwellMs 就完成。
 *   用 cookie 判定，扫码成功即可，不依赖页面重新渲染出上传框。
 * - requireConfirm=true（重新登录）：窗口不会自己关，必须用户点「我已完成登录」。
 *   否则已登录账号的 cookie 会让窗口在 1 秒内自判成功并关闭，用户根本没机会扫码。
 *
 * onResult 让状态落库不依赖谁在轮询：聊天里发起的连接没人 GET 也能变成 connected。
 */
export function startLogin(opts = {}) {
  if (activeSession) {
    const stuck = sessions.get(activeSession)
    // 会话还活着就老实拒绝；已经结束或消失的残留不能挡住用户
    if (stuck && (stuck.status === 'opening' || stuck.status === 'awaiting')) {
      throw new Error('已有登录窗口在进行中，请先完成或取消')
    }
    sessions.delete(String(activeSession))
    activeSession = null
  }
  const platform = getPlatform(opts.platform)
  const id = newLoginId()
  const requireConfirm = opts.requireConfirm === true
  const minDwellMs = Math.max(0, Number(opts.minDwellMs) || 4000)
  const startedAt = Date.now()
  const verify = typeof opts.isLoggedIn === 'function' ? opts.isLoggedIn : adapterLoginProbe(platform.id)
  const job = {
    id,
    platform: platform.id,
    accountId: String(opts.accountId || ''),
    status: 'opening',
    message: '正在打开浏览器',
    startedAt,
    requireConfirm,
    detected: false,
  }
  sessions.set(id, job)
  activeSession = id

  const isLoggedIn = async (page) => {
    const cur = sessions.get(id)
    if (!cur) return true
    const detected = await verify(page).catch(() => false)
    cur.detected = detected

    if (cur.confirmRequested) {
      if (detected) return true
      // 用户点了完成但确实没测到登录：退回等待，并明确告诉他
      cur.confirmRequested = false
      cur.message = '还没检测到登录状态：请先完成扫码，再点「我已完成登录」'
      return false
    }

    if (requireConfirm) {
      cur.message = detected
        ? '已检测到登录状态，请点「我已完成登录」完成连接'
        : '等待扫码或窗口内登录'
      return false
    }

    // 自动模式也要让窗口露个脸，别一闪而过
    return detected && Date.now() - startedAt >= minDwellMs
  }

  ;(async () => {
    let result = { ok: false, status: 'error', message: '登录流程异常结束' }
    try {
      result = await openLoginWindow({
        profileDir: opts.profileDir,
        url: opts.url || platform.backendUrl,
        timeoutMs: opts.timeoutMs,
        isLoggedIn,
        onOpened: () => markSessionAwaiting(id, '等待扫码或窗口内登录'),
        shouldStop: () => Boolean(sessions.get(id)?.cancelRequested),
      })
      const cur = sessions.get(id)
      if (!cur) return
      cur.status = result.status
      cur.message = result.message
      cur.endedAt = Date.now()
    } catch (e) {
      result = { ok: false, status: 'error', message: sanitizeError(e) }
      const cur = sessions.get(id)
      if (cur) {
        cur.status = 'error'
        cur.message = result.message
        cur.endedAt = Date.now()
      }
    } finally {
      if (activeSession === id) activeSession = null
      try {
        opts.onResult?.(result, { id, platform: platform.id, accountId: job.accountId })
      } catch {
        /* 回调失败不影响登录结果 */
      }
    }
  })()

  return { ...job }
}

/** 用户在窗口里完成扫码后，点「我已完成登录」触发；真正判定仍由平台会话决定 */
export function confirmLogin(id) {
  const job = sessions.get(id)
  if (!job) return null
  if (job.status !== 'opening' && job.status !== 'awaiting') return { ...job }
  job.confirmRequested = true
  job.message = '正在确认登录状态…'
  return { ...job }
}

export function markSessionAwaiting(id, message = '等待扫码或窗口内登录') {
  const job = sessions.get(id)
  if (job) {
    job.status = 'awaiting'
    job.message = message
  }
  return job ? { ...job } : null
}

export function cancelLogin(id) {
  const job = sessions.get(id)
  if (!job) return null
  if (job.status === 'opening' || job.status === 'awaiting') {
    job.cancelRequested = true
    job.message = '正在取消'
  }
  return { ...job }
}

export function clearFinishedSessions(maxAgeMs = 10 * 60 * 1000) {
  const now = Date.now()
  for (const [id, job] of sessions) {
    if (job.endedAt && now - job.endedAt > maxAgeMs) sessions.delete(id)
  }
}

export function resetSessionsForTest() {
  sessions.clear()
  activeSession = null
}
