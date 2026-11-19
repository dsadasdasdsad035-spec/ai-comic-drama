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
import { expectedBundles as expectedProfileBundles } from './dsh-bundle.mjs'

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

/** 宿主源码子模块目录，以及两种入口在仓库内的相对位置 */
const SOURCE_DIR = 'deepseek-harness'
const SOURCE_ENTRY = ['apps', 'cli', 'lib', 'bin.js']
const PACKAGE_ENTRY = ['node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']
/** 宿主启动时跳过某个 bundle 的自述行（见 app-boot 的 reportSkippedBundles） */
const SKIPPED_BUNDLE_PATTERN = /skipping profile bundle "([^"]+)"/g

/** 三种入口来源：显式覆盖 / 本仓库源码产物 / 已安装包 */
export const DSH_SOURCES = Object.freeze({ override: 'override', source: 'source', package: 'package' })

/** 三种不可用原因的补救动作，文案与命令保持一致 */
export const DSH_REMEDIES = Object.freeze({
  'source-uninitialized': '执行 `git submodule update --init --recursive` 拉取宿主源码',
  'source-unbuilt': '执行 `npm run build:dsh` 构建宿主源码',
  missing: '执行 `git submodule update --init --recursive` 后运行 `npm run build:dsh`，或执行 `npm ci` 安装宿主包',
})

export function dshEntryPaths(root) {
  return {
    sourceDir: path.join(root, SOURCE_DIR),
    sourceEntry: path.join(root, SOURCE_DIR, ...SOURCE_ENTRY),
    packageEntry: path.join(root, ...PACKAGE_ENTRY),
  }
}

function isEmptyDir(dir) {
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return false
  }
}

/**
 * 解析宿主入口：显式覆盖 → 源码构建产物 → 已安装包。
 *
 * 三级都不可用时返回失败原因，而不是笼统的「没装」：
 * - `source-uninitialized`：子模块目录存在但为空（没 `submodule update --init`）
 * - `source-unbuilt`：源码在、产物不在（没跑 `npm run build:dsh`）
 * - `missing`：两者都没有
 */
export function resolveDshEntryInfo(root, env = process.env) {
  const paths = dshEntryPaths(root)
  const override = String(env.DSH_ENTRY || '').trim()
  if (override) {
    const entry = path.isAbsolute(override) ? override : path.resolve(root, override)
    return { entry, source: DSH_SOURCES.override, reason: null, note: null }
  }
  if (fs.existsSync(paths.sourceEntry)) {
    return { entry: paths.sourceEntry, source: DSH_SOURCES.source, reason: null, note: null }
  }
  const sourceDirExists = fs.existsSync(paths.sourceDir)
  // 源码有内容但没编译：回退到已安装包，同时留个提示，别让「忘了 build」变成静默行为
  const note = sourceDirExists && !isEmptyDir(paths.sourceDir) ? 'source-unbuilt-fallback' : null
  if (fs.existsSync(paths.packageEntry)) {
    return { entry: paths.packageEntry, source: DSH_SOURCES.package, reason: null, note }
  }
  let reason = 'missing'
  if (sourceDirExists) reason = isEmptyDir(paths.sourceDir) ? 'source-uninitialized' : 'source-unbuilt'
  return { entry: null, source: 'none', reason, note: null }
}

/** 只取入口路径；不可用时返回 null */
export function resolveDshEntry(root, env = process.env) {
  return resolveDshEntryInfo(root, env).entry
}

/** 宿主入口是否可用（任一来源） */
export function isDshInstalled(root, env = process.env) {
  return Boolean(resolveDshEntry(root, env))
}

/** 按失败原因给出可读中文说明，每种都带对应补救命令 */
export function dshEntryFailureMessage(root, info) {
  const paths = dshEntryPaths(root)
  const remedy = DSH_REMEDIES[info.reason] || DSH_REMEDIES.missing
  if (info.reason === 'source-uninitialized') {
    return `创意会话宿主源码未初始化：${paths.sourceDir} 为空。${remedy}`
  }
  if (info.reason === 'source-unbuilt') {
    return `创意会话宿主源码尚未构建：缺少 ${paths.sourceEntry}。${remedy}`
  }
  return `未安装创意会话宿主：既没有源码构建产物（${paths.sourceEntry}），也没有已安装包（${paths.packageEntry}）。${remedy}`
}

/** 读入口对应的包清单版本：源码是 apps/cli/package.json，安装包是 dsh/package.json */
export function readDshVersion(entry) {
  const manifestPath = path.join(path.dirname(entry), '..', 'package.json')
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return { version: typeof manifest.version === 'string' ? manifest.version : null, manifestPath }
  } catch {
    return { version: null, manifestPath }
  }
}

/** 应用声明的宿主版本：与 submodule 钉的 tag 必须一致 */
export function expectedDshVersion(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const declared = manifest?.dependencies?.['@deepseek-ai/dsh']
    return typeof declared === 'string' ? declared : null
  } catch {
    return null
  }
}

/**
 * 校验入口对应的宿主版本与应用声明一致。
 * @returns 不一致或读不到版本的说明；一致返回 null
 */
export function dshVersionIssue(entry, expected, { strict = true } = {}) {
  if (!expected) return null
  const { version, manifestPath } = readDshVersion(entry)
  if (!version) {
    return strict ? `无法确认创意会话宿主版本：读不到 ${manifestPath}` : null
  }
  if (version === expected) return null
  const detail = `创意会话宿主版本不一致：实际 ${version}，应用声明 ${expected}（${manifestPath}）`
  // 显式覆盖是操作员的选择，版本不符只提示不拦截
  return strict ? `${detail}。请切回钉定版本，或让应用声明跟随该版本` : null
}


/** 把引导令牌替换成占位符：状态接口与日志都用它 */
export function redactToken(text) {
  return String(text || '').replace(TOKEN_PATTERN, '$1***')
}

/** 从宿主输出里收集被跳过的 bundle 名（同一个只记一次） */
export function collectSkippedBundles(text) {
  const names = new Set()
  for (const match of String(text || '').matchAll(SKIPPED_BUNDLE_PATTERN)) names.add(match[1])
  return [...names]
}

/** 预期清单里、实际却被宿主跳过的 bundle：这些是必须报告出来的缺失项 */
export function missingExpectedBundles(expected, skipped) {
  const skippedNames = new Set(skipped || [])
  return (expected || []).filter((name) => skippedNames.has(name))
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

  function buildArgs(entry, listenPort) {
    // 启动器自己的旗标必须排在 profile 名之前：dsh 一旦遇到第一个不认识的位置参数
    // （这里是 `web`）就把后面的内容原样交给 app，`--patch` 到了 app 手里就是未知选项。
    const args = [entry, '--profile', 'web']
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

  /** 预期清单里被宿主跳过的层：这些必须报出来，否则只是「少了个插件」的静默状态 */
  function skippedMissing() {
    return missingExpectedBundles(expectedProfileBundles(dshHome), collectSkippedBundles(lastLog))
  }

  /** 失败信息后缀：把跳过的层附在原因后面，用户才看得出是哪个插件的问题 */
  function skippedSuffix() {
    const skipped = collectSkippedBundles(lastLog)
    if (!skipped.length) return ''
    const missing = skippedMissing()
    return missing.length
      ? `；缺少预期插件层：${missing.join('、')}`
      : `；宿主跳过了插件层：${skipped.join('、')}`
  }

  async function launch() {
    const info = resolveDshEntryInfo(root)
    if (!info.entry) {
      setState('failed', dshEntryFailureMessage(root, info))
      return false
    }
    if (info.note === 'source-unbuilt-fallback') {
      logSafe(`[creative-host] 宿主源码存在但未构建，已回退到已安装包；执行 npm run build:dsh 以使用源码产物`)
    }
    const versionIssue = dshVersionIssue(info.entry, expectedDshVersion(root), {
      // 显式覆盖是操作员的选择：版本不符只提示，不拦启动
      strict: info.source !== DSH_SOURCES.override,
    })
    if (versionIssue) {
      setState('failed', versionIssue)
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

    const proc = spawn(process.execPath, buildArgs(info.entry, port), {
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
      const reason = `创意会话宿主退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）${skippedSuffix()}`
      if (restarts < maxRestarts) {
        restarts += 1
        lastError = `${reason}，正在第 ${restarts} 次重启`
        logSafe(`[creative-host] ${lastError}`)
        // 崩溃后必须离开 ready：否则状态一直停在 ready，自动重启调用的 start()
        // 会被 ready 短路直接返回 true，宿主再也回不来（表现为「崩一次后入口永久空白」）。
        // 这里直接调 launch()，不走 start() —— start() 会把 restarts 清零，
        // 退避与重启上限就都失效了。
        setState('starting', lastError)
        setTimeout(() => {
          if (!stopping) void launch()
        }, RESTART_BACKOFF_MS * restarts).unref()
        return
      }
      setState('failed', `${reason}，已达重启上限（${maxRestarts} 次）`)
    })

    const ready = await waitReady(Date.now() + readyTimeoutMs)
    if (!ready) {
      setState(
        'failed',
        `${lastError || `创意会话宿主在 ${Math.round(readyTimeoutMs / 1000)} 秒内未就绪`}${skippedSuffix()}`,
      )
      // 没就绪的进程留着只会占端口，直接收掉；下一次 start 会重新拉起
      await stopChild()
      return false
    }
    // 宿主对「声明了但解析不到」的 bundle 只是跳过并打一行日志（不报错），
    // 所以这里按 profile 清单核一遍：缺了预期层就不能宣告就绪，否则用户只会觉得插件凭空消失。
    const missing = skippedMissing()
    if (missing.length) {
      setState(
        'failed',
        `创意会话宿主缺少预期插件层：${missing.join('、')}。启动日志里有 skipping profile bundle 的原因，`
          + '通常是依赖没装齐或源码未重新构建',
      )
      await stopChild()
      return false
    }
    const skipped = collectSkippedBundles(lastLog)
    if (skipped.length) {
      logSafe(`[creative-host] 宿主跳过了非预期插件层：${skipped.join('、')}`)
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
    const info = resolveDshEntryInfo(root)
    return {
      state,
      port,
      error: lastError,
      restarts,
      installed: Boolean(info.entry),
      entry: info.entry,
      entrySource: info.source,
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
