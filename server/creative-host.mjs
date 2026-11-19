/**
 * 创意会话宿主（dsh）进程托管。
 *
 * 设计要点：
 * - 宿主只监听 127.0.0.1：外部访问一律经应用自己的 `/studio/` 反代，
 *   这样鉴权、同源与主题注入都留在应用这一侧，宿主不直接面向浏览器。
 * - 端口由本模块先挑一个空闲端口再显式传给宿主，而不是让宿主自己挑：
 *   宿主挑端口时只能从它打印的 URL 里回读，启动期多一个解析竞态。
 * - 引导令牌从宿主打印的 URL 里取出后只留在服务端内存，由反代在转发时补齐；
 *   浏览器永远看不到明文令牌（见 specs/creative-dsh-host 的鉴权条款）。
 * - 崩溃重启有次数上限：宿主稳定崩溃时反复拉起只会把 CPU 打满而用户看不到原因，
 *   上限触发后保留最后一次失败信息供创意入口展示。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

/** 宿主在启动后打印的单行握手：`dsh web: http://127.0.0.1:PORT/?token=...` */
const READY_LINE = /dsh web:\s*(https?:\/\/\S+)/
/** 引导令牌出现在日志/状态里就等于把它交给任何能看到状态的人，输出前统一打码 */
const TOKEN_PATTERN = /([?&]token=)[^\s&"']+/g
/** 就绪探测间隔与总超时；宿主要加载插件组合，冷启动可能十几秒 */
const PROBE_INTERVAL_MS = 250
const DEFAULT_READY_TIMEOUT_MS = 60_000
const DEFAULT_STOP_TIMEOUT_MS = 8_000
/** 崩溃重启上限与退避基数 */
const DEFAULT_MAX_RESTARTS = 3
const RESTART_BACKOFF_MS = 1_000

/** 宿主包的入口（npm 包装的是启动器，真正的组合在 @deepseek-ai/dsh 里） */
export function resolveDshEntry(root) {
  return path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

export function isDshInstalled(root) {
  return fs.existsSync(resolveDshEntry(root))
}

/** 把引导令牌替换成占位符：状态接口与日志都用它 */
export function redactToken(text) {
  return String(text || '').replace(TOKEN_PATTERN, '$1***')
}

/** 挑一个 127.0.0.1 上的空闲端口 */
export function pickLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error('无法分配空闲端口'))))
    })
  })
}

/** 把监听地址与令牌拼成宿主根 URL */
function hostOrigin(port, token) {
  const base = `http://127.0.0.1:${port}/`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

/** 从宿主打印的这一行里取出根路径与引导令牌 */
export function parseReadyLine(line) {
  const match = READY_LINE.exec(line)
  if (!match) return null
  let url
  try {
    url = new URL(match[1])
  } catch {
    return null
  }
  return {
    origin: url.origin,
    token: url.searchParams.get('token') || '',
  }
}

/**
 * 创建一个宿主管理器。返回的对象持有当前子进程、令牌与失败信息，
 * 供反代与创意入口读取状态。
 */
export function createCreativeHost(options) {
  const root = options.root
  const dshHome = options.dshHome
  const publicUrl = options.publicUrl
  const trustedHosts = options.trustedHosts || []
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  const log = options.log || ((line) => console.log(line))
  /** 日志里也不能留明文令牌：控制台常被截图、也会进 issue */
  const logSafe = (line) => log(redactToken(line))

  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  let stopping = false
  let restarts = 0
  let port = 0
  let token = ''
  let state = 'idle' // idle | starting | ready | failed | stopped
  let lastError = ''
  let lastLog = ''
  /** 等待就绪的调用方 */
  let readyWaiters = []

  function setState(next, error) {
    state = next
    if (error !== undefined) lastError = error
    if (next === 'ready' || next === 'failed' || next === 'stopped') {
      const waiters = readyWaiters
      readyWaiters = []
      for (const w of waiters) w(next === 'ready')
    }
  }

  function buildArgs(listenPort) {
    // 启动器自己的旗标必须排在 profile 名之前：dsh 一旦遇到第一个不认识的位置参数
    // （这里是 `web`）就把后面的内容原样交给 app，`--patch` 到了 app 手里就是未知选项。
    const args = [resolveDshEntry(root), '--profile', 'web']
    // 专家 preset 是派生数据、每次启动都可能变，因此单独作为叠加层传入，
    // 不写进 profile 用户层（那里只能覆盖已有行，加不了新行）
    for (const patch of options.patches || []) {
      if (fs.existsSync(patch)) args.push('--patch', patch)
    }
    args.push('--no-open', '--host', '127.0.0.1', '--port', String(listenPort))
    if (publicUrl) args.push('--public-url', publicUrl)
    for (const host of trustedHosts) args.push('--trusted-host', host)
    return args
  }

  async function probe(url) {
    // 用 GET + 手动重定向探测壳页面：未带令牌时宿主会 303 到带令牌地址，也算就绪
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(2_000) })
      return res.status > 0
    } catch {
      return false
    }
  }

  async function waitReady(deadline) {
    while (Date.now() < deadline) {
      if (stopping) return false
      // 令牌是反代转发的必要条件，没抓到令牌就先不宣告就绪
      if (token && (await probe(hostOrigin(port, token)))) return true
      await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
    }
    return false
  }

  async function launch() {
    if (!isDshInstalled(root)) {
      setState('failed', `未安装创意会话宿主：缺少 ${resolveDshEntry(root)}`)
      return false
    }
    setState('starting', '')
    try {
      port = await pickLoopbackPort()
    } catch (e) {
      setState('failed', `无法为创意会话宿主分配端口：${e?.message || String(e)}`)
      return false
    }
    token = ''
    lastLog = ''

    const proc = spawn(process.execPath, buildArgs(port), {
      cwd: root,
      env: { ...process.env, DSH_HOME: dshHome, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child = proc

    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk) => {
      lastLog = (lastLog + chunk).slice(-4000)
      for (const line of String(chunk).split('\n')) {
        if (!line.trim()) continue
        logSafe(`[creative-host] ${line}`)
        const ready = parseReadyLine(line)
        if (ready && !token) {
          token = ready.token
        }
      }
    })
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (chunk) => {
      lastLog = (lastLog + chunk).slice(-4000)
      logSafe(`[creative-host] ${String(chunk).trimEnd()}`)
    })

    proc.on('exit', (code, signal) => {
      if (child !== proc) return
      child = null
      token = ''
      if (stopping) {
        setState('stopped')
        return
      }
      const reason = `创意会话宿主退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`
      if (restarts < maxRestarts) {
        restarts += 1
        lastError = `${reason}，正在第 ${restarts} 次重启`
        logSafe(`[creative-host] ${lastError}`)
        setTimeout(() => {
          if (!stopping) void start()
        }, RESTART_BACKOFF_MS * restarts).unref()
        return
      }
      setState('failed', `${reason}，已达重启上限（${maxRestarts} 次）`)
    })

    const ready = await waitReady(Date.now() + readyTimeoutMs)
    if (!ready) {
      setState('failed', lastError || `创意会话宿主在 ${Math.round(readyTimeoutMs / 1000)} 秒内未就绪`)
      // 没就绪的进程留着只会占端口，直接收掉；下一次 start 会重新拉起
      await stopChild()
      return false
    }
    setState('ready', '')
    logSafe(`[creative-host] 已就绪：127.0.0.1:${port}`)
    return true
  }

  async function stopChild() {
    const proc = child
    if (!proc) return
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* 已退出 */
        }
        resolve()
      }, stopTimeoutMs)
      timer.unref()
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        proc.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  async function start() {
    if (state === 'ready') return true
    if (state === 'starting') {
      return await new Promise((resolve) => readyWaiters.push(resolve))
    }
    // 显式启动：解除 stop() 留下的守卫，并把重启计数清零（这是新的一次生命周期）
    stopping = false
    restarts = 0
    return await launch()
  }

  /** 供反代使用：当前是否可转发、以及上游根地址与令牌 */
  function upstream() {
    if (state !== 'ready' || !port) return null
    return { origin: `http://127.0.0.1:${port}`, token }
  }

  function status() {
    return {
      state,
      port,
      error: lastError,
      restarts,
      installed: isDshInstalled(root),
      log: redactToken(lastLog),
    }
  }

  async function stop() {
    stopping = true
    await stopChild()
    setState('stopped')
  }

  return { start, stop, upstream, status, parseReadyLine }
}
