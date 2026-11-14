/**
 * 本地服务进程的生命周期管理。
 *
 * 为什么用 child_process.spawn 而不是 Electron 的 utilityProcess（见 design.md 决策 2）：
 * 需求里有「服务崩溃后单独重启服务」与「退出后不留孤儿进程」，这要求服务是一个
 * 独立的普通 Node 进程，能被单独杀掉、单独拉起，且能在应用外调试。
 *
 * 握手协议：服务启动成功后在 stdout 打印单行
 *   [server] listening http://127.0.0.1:56719
 * 主进程解析这一行拿实际端口（SB_PORT=0 时端口由系统分配）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const HANDSHAKE_RE = /\[server\] listening http:\/\/([^\s:]+):(\d+)/
/** 握手超时：冷启动要读 SQLite 与媒体目录，30 秒足够；再久就是真故障 */
const HANDSHAKE_TIMEOUT_MS = 30_000
/** SIGTERM 后等待退出的上限，超时 SIGKILL */
const KILL_GRACE_MS = 5_000
/** 保留最后这么多行 stderr 用于错误页展示 */
const LOG_TAIL_LINES = 40

/**
 * @typedef {object} ServiceHandle
 * @property {number} port
 * @property {string} origin
 * @property {() => Promise<void>} stop  请求停止并等待退出
 * @property {() => boolean} running
 * @property {() => string} logTail
 */

/**
 * 启动本地服务并等待握手。
 * @param {{ root: string, env?: Record<string,string>, onExit?: (info: {code:number|null, signal:string|null}) => void }} opts
 * @returns {Promise<ServiceHandle>}
 */
export function startService(opts) {
  const { root, env = {}, onExit } = opts
  const entry = path.join(root, 'server', 'desktop-entry.mjs')
  if (!fs.existsSync(entry)) {
    return Promise.reject(new Error(`缺少服务入口：${entry}`))
  }

  const nodeBin = resolveNodeBinary(root)
  const lines = []
  let stopping = false
  let settled = false

  const child = spawn(nodeBin, [entry], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
      // 端口由系统分配，避免与用户已占用的 5273 冲突
      SB_PORT: '0',
      // 子进程据此判断父进程是否还在（强杀场景下由它自己收尸）
      SB_DESKTOP_PARENT_PID: String(process.pid),
      // 回退到 Electron 自带 Node 时，必须显式开启该标志才能当普通 node 用
      ...(isElectronBinary(nodeBin) ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const pushLine = (text) => {
    for (const line of String(text).split(/\r?\n/)) {
      const trimmed = line.trimEnd()
      if (!trimmed) continue
      lines.push(trimmed)
      if (lines.length > LOG_TAIL_LINES * 3) lines.splice(0, lines.length - LOG_TAIL_LINES * 3)
    }
  }
  child.stdout.on('data', (b) => pushLine(b.toString()))
  child.stderr.on('data', (b) => pushLine(b.toString()))

  const logTail = () => lines.slice(-LOG_TAIL_LINES).join('\n')

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`本地服务在 ${HANDSHAKE_TIMEOUT_MS / 1000} 秒内未就绪`))
    }, HANDSHAKE_TIMEOUT_MS)

    let buf = ''
    const onData = (b) => {
      buf += b.toString()
      const m = buf.match(HANDSHAKE_RE)
      if (!m || settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      const port = Number(m[2])
      resolve({
        port,
        origin: `http://${m[1]}:${port}`,
        running: () => child.exitCode === null && child.signalCode === null,
        logTail,
        stop: async () => {
          stopping = true
          if (child.exitCode !== null || child.signalCode !== null) return
          const exited = new Promise((done) => child.once('exit', done))
          child.kill('SIGTERM')
          const killer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
          killer.unref?.()
          await exited
          clearTimeout(killer)
        },
      })
    }
    child.stdout.on('data', onData)

    child.once('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })

    child.once('exit', (code, signal) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        const tail = logTail()
        reject(new Error(`本地服务启动失败（code=${code}, signal=${signal}）${tail ? `\n${tail}` : ''}`))
        return
      }
      // 已就绪后的退出：只有非主动停止才通知上层，避免退出流程里重复触发断连页
      if (!stopping) onExit?.({ code, signal })
    })
  })
}

/**
 * 定位用于跑服务进程的 Node 可执行文件。
 *
 * 优先使用随包 Node（desktop/bin/node），它保证 node:sqlite 可用且版本固定；
 * 开发环境没有下载随包 Node 时回退到 Electron 自带的 Node（ELECTRON_RUN_AS_NODE=1
 * 时 execPath 就是一个普通 Node），再回退到 PATH 里的 node。
 */
export function resolveNodeBinary(root) {
  const candidates = [
    process.env.SB_DESKTOP_NODE,
    // 打包后：<App>.app/Contents/Resources/bin/node
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'node') : '',
    // 开发时：<仓库>/desktop/bin/node
    path.join(root, 'desktop', 'bin', 'node'),
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    } catch {
      /* ignore */
    }
  }
  // 打包后没有随包 Node 时，用 Electron 自带的 Node 跑服务（需 ELECTRON_RUN_AS_NODE）
  return process.execPath
}

/** 是否需要用 ELECTRON_RUN_AS_NODE 启动（即用的是 Electron 自带 Node） */
export function isElectronBinary(nodeBin) {
  return path.basename(nodeBin).toLowerCase() === 'electron' || nodeBin.includes('Electron.app')
}

/**
 * 随包外部二进制的显式 env 注入。
 *
 * 虽然 `server/ffmpeg-host.mjs` 与 `server/blender.mjs` 也能从「Node 可执行文件同目录」
 * 推导出随包位置，这里仍然显式注入：env 优先级最高，出问题时能一眼看出服务实际用的是
 * 哪一份二进制（`/api/health` 会回显 ffmpegPath）。只在实际存在时才注入，避免把一个
 * 不存在的路径塞进 env 把候选链打断。
 */
export function bundledRuntimeEnv(root) {
  // 随包二进制与 node 同目录：打包后是 Resources/bin，开发时是 desktop/bin
  const dir = path.dirname(resolveNodeBinary(root))
  // Blender 体积大，单独放 Resources/blender（与 bin 同级），两条都试以兼顾开发与打包
  const blenderCandidates = [
    path.join(dir, 'blender', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
    path.join(dir, '..', 'blender', 'Blender.app', 'Contents', 'MacOS', 'Blender'),
  ]
  const env = {}
  const pick = (p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile() ? p : ''
    } catch {
      return ''
    }
  }
  const ffmpeg = pick(path.join(dir, 'ffmpeg'))
  const ffprobe = pick(path.join(dir, 'ffprobe'))
  const blender = blenderCandidates.map(pick).find(Boolean) || ''
  if (ffmpeg) env.FFMPEG_PATH = ffmpeg
  if (ffprobe) env.FFPROBE_PATH = ffprobe
  if (blender) env.BLENDER_BIN = blender
  return env
}
