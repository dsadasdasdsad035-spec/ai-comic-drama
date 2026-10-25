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
import { sanitizeError, resolveChrome } from './publish-utils.mjs'
import { getPlatform } from './publish-platforms.mjs'

/** 登录态判定：默认看 URL 是否落在登录页，以及页面是否出现后台标志 */
export const DEFAULT_LOGIN_HEURISTIC = {
  loginUrlHints: ['login', 'passport', 'signin', 'auth'],
  loggedInSelector: '',
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
  const chromium = await loadChromium()
  const exe = resolveChrome()
  const launchOpts = {
    headless: false,
    viewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  }
  if (exe) launchOpts.executablePath = exe
  else launchOpts.channel = 'chrome'

  fs.mkdirSync(opts.profileDir, { recursive: true, mode: 0o700 })
  const ctx = await chromium.launchPersistentContext(opts.profileDir, launchOpts)
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  const deadline = Date.now() + Math.max(5_000, Number(opts.timeoutMs) || 180_000)
  let result = { ok: false, status: 'timeout', message: '等待登录超时' }
  try {
    for (;;) {
      if (opts.shouldStop?.()) {
        result = { ok: false, status: 'cancelled', message: '已取消' }
        break
      }
      if (Date.now() > deadline) break
      let loggedIn = false
      if (typeof opts.isLoggedIn === 'function') {
        try {
          loggedIn = Boolean(await opts.isLoggedIn(page))
        } catch {
          loggedIn = false
        }
      } else {
        // 默认判定：离开登录页且页面可交互即认为已登录；真实适配器会覆盖
        loggedIn = !looksLikeLoginUrl(page.url())
      }
      if (loggedIn) {
        result = { ok: true, status: 'done', message: '登录成功', url: page.url() }
        break
      }
      await page.waitForTimeout(1_000)
    }
  } catch (e) {
    result = { ok: false, status: 'error', message: sanitizeError(e) }
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
  const launchOpts = { headless: true, args: ['--no-first-run'] }
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
    return { status: 'connected', message: '会话有效' }
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
 */
export function startLogin(opts = {}) {
  if (activeSession) {
    throw new Error('已有登录窗口在进行中，请先完成或取消')
  }
  const platform = getPlatform(opts.platform)
  const id = newLoginId()
  const job = {
    id,
    platform: platform.id,
    accountId: String(opts.accountId || ''),
    status: 'opening',
    message: '正在打开浏览器',
    startedAt: Date.now(),
  }
  sessions.set(id, job)
  activeSession = id

  const stop = () => {
    const cur = sessions.get(id)
    if (cur && (cur.status === 'opening' || cur.status === 'awaiting')) cur.cancelRequested = true
  }

  ;(async () => {
    try {
      const result = await openLoginWindow({
        profileDir: opts.profileDir,
        url: opts.url || platform.backendUrl,
        timeoutMs: opts.timeoutMs,
        isLoggedIn: opts.isLoggedIn,
        shouldStop: () => Boolean(sessions.get(id)?.cancelRequested),
      })
      const cur = sessions.get(id)
      if (!cur) return
      cur.status = result.status
      cur.message = result.message
      cur.endedAt = Date.now()
    } catch (e) {
      const cur = sessions.get(id)
      if (cur) {
        cur.status = 'error'
        cur.message = sanitizeError(e)
        cur.endedAt = Date.now()
      }
    } finally {
      if (activeSession === id) activeSession = null
    }
  })()

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
