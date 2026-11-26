/**
 * 桌面端内置知识库（AnythingLLM）的生命周期管理。
 *
 * 为什么内置而不是让用户装 docker：桌面版要求「装上就能用」，让用户为知识库去装
 * Docker、拉 5GB 镜像不成立。产物由 `desktop/scripts/bundle-anythingllm.mjs` 生成。
 *
 * 与 `service.mjs`（本应用自己的服务）的差异：
 * - AnythingLLM 是**两个进程**：collector（文档解析）与 server（API）。必须一起拉起，
 *   只有 server 时上传会报「Document processing API is not online」。
 * - 它没有握手行。collector 只打印 `Document processor app listening on port 8888`，
 *   server 靠 HTTP 存活。所以就绪判定用「端口探测 + HTTP ping」，不用 stdout 解析。
 * - 产物是只读的（打包后在 .app 内），所有可写路径都通过环境变量指到用户数据目录。
 *
 * 环境变量契约（与 bundle 脚本的改写对应，改动其一必须同时改另一个）：
 *   DATABASE_URL        sqlite 文件绝对路径
 *   STORAGE_DIR         server 的存储根（<data>/server/storage）
 *   COLLECTOR_HOTDIR    collector 的上传暂存目录（<data>/collector/hotdir）
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { generateKeyPairSync } from 'node:crypto'

/** collector 的就绪超时：首次启动要加载 tokenizer 与 embedder 配置 */
const COLLECTOR_READY_MS = 60_000
/** server 的就绪超时：要跑 prisma 与迁移检查 */
const SERVER_READY_MS = 90_000
/** SIGTERM 后等待退出的上限 */
const KILL_GRACE_MS = 5_000
const LOG_TAIL_LINES = 40

/**
 * @typedef {object} AnythingLlmHandle
 * @property {string} origin        server 的 http://127.0.0.1:<port>
 * @property {string} apiKey        可直接给本应用用的 API Key
 * @property {string} dataDir       用户数据目录（便于排障）
 * @property {() => Promise<void>} stop
 * @property {() => boolean} running
 * @property {() => string} logTail
 */

/** 找一个空闲端口。用完即释放，交给子进程去 bind（有极小竞态，实测可接受）。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

async function httpOk(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

async function waitFor(check, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`${label} 在 ${Math.round(timeoutMs / 1000)} 秒内未就绪`)
}

/**
 * 从 AnythingLLM 自己的 SQLite 里读一个 API Key，没有就建一个。
 *
 * 为什么直接写它的库：它没有「无鉴权创建 key」的接口（创建 key 要走网页登录）。
 * 我们持有它的数据库文件，直接建一条是唯一能全自动完成的方式。
 * 库是 Prisma 建的，表结构简单，用 node:sqlite 直接插入即可 —— 不必为此拉起 prisma。
 */
function ensureApiKey(dbFile) {
  const db = new DatabaseSync(dbFile)
  try {
    const row = db.prepare('SELECT secret FROM api_keys ORDER BY id LIMIT 1').get()
    if (row?.secret) return String(row.secret)
    // uuid-apikey 的格式：8-7-7-7 位大写字母数字。- 不是鉴权要素，格式对就行
    const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789'
    const chunk = (n) =>
      Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
    const secret = `${chunk(8)}-${chunk(7)}-${chunk(7)}-${chunk(7)}`
    db.prepare('INSERT INTO api_keys (name, secret, createdAt) VALUES (?,?,?)').run(
      'desktop',
      secret,
      new Date().toISOString(),
    )
    return secret
  } finally {
    db.close()
  }
}

/**
 * 预置 server ↔ collector 的签名密钥对。
 *
 * 只写不覆盖：已有密钥就保留（用户升级时不该换密钥，虽然换了也能自愈）。
 */
function ensureComKey(storageDir) {
  const dir = path.join(storageDir, 'comkey')
  const priv = path.join(dir, 'ipc-priv.pem')
  const pub = path.join(dir, 'ipc-pub.pem')
  if (exists(priv) && exists(pub)) return
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(priv, privateKey)
  fs.writeFileSync(pub, publicKey)
}

/**
 * 启动内置知识库。
 *
 * @param {{
 *   bundleDir: string,       产物目录（含 server/ 与 collector/）
 *   dataDir: string,         用户数据目录（可写）
 *   nodeBin: string,         跑子进程用的 Node
 *   log?: (line: string) => void,
 * }} opts
 * @returns {Promise<AnythingLlmHandle>}
 */
export async function startAnythingLlm(opts) {
  const { bundleDir, dataDir, nodeBin } = opts
  const log = opts.log || (() => {})

  const serverEntry = path.join(bundleDir, 'server', 'index.js')
  const collectorEntry = path.join(bundleDir, 'collector', 'index.js')
  const templateDb = path.join(bundleDir, 'template.db')
  if (!exists(serverEntry) || !exists(collectorEntry)) {
    throw new Error(
      `内置知识库产物不完整：${bundleDir}\n先运行 node desktop/scripts/bundle-anythingllm.mjs`,
    )
  }

  // ---- 准备可写目录。产物在 .app 里是只读的，一切都落在 dataDir
  const storageDir = path.join(dataDir, 'server', 'storage')
  /** 上游存解析后文档 JSON 的目录（读单文档正文要用） */
  const documentsDir = path.join(storageDir, 'documents')
  const hotdir = path.join(dataDir, 'collector', 'hotdir')
  const outputs = path.join(dataDir, 'collector', 'outputs')
  const dbFile = path.join(dataDir, 'anythingllm.db')
  for (const dir of [storageDir, hotdir, outputs]) fs.mkdirSync(dir, { recursive: true })

  // ---- 首次启动：把预迁移好的空库复制过去
  if (!exists(dbFile)) {
    if (!exists(templateDb)) throw new Error(`缺少空库模板：${templateDb}`)
    fs.copyFileSync(templateDb, dbFile)
    log(`[anythingllm] 初始化数据库：${dbFile}`)
  }

  /*
   * 预置通信密钥（server ↔ collector 的签名密钥）。
   *
   * 为什么必须提前生成：server 启动时执行 `new CommunicationKey(true)`，**每次**都重新
   * 生成一对新的 RSA 密钥。而 collector 的 keyPath 是模块顶层常量，进程一起来就固定了。
   * 两者先后顺序或启动耗时稍有偏差，就会用到不同版本的密钥 —— 表现是上传报
   * 「Response could not be completed」，而 collector 侧只回 400 Failed integrity
   * signature check，日志里根本看不出根因（实测踩了很久）。
   *
   * 做法：在起任何子进程前先生成一份，两边都读它。server 会用自己新生成的那对覆盖，
   * 所以还要保证 collector 在 server 之后起（见下方顺序注释）。
   */
  ensureComKey(storageDir)

  const port = await freePort()
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SERVER_PORT: String(port),
    STORAGE_DIR: storageDir,
    DATABASE_URL: `file:${dbFile}`,
    COLLECTOR_HOTDIR: hotdir,
    // 关掉它的遥测与更新检查：桌面端离线也应该正常工作
    DISABLE_TELEMETRY: 'true',
    // 上游默认会尝试连远程模型清单，超时可达数十秒；桌面端不需要
    ...(opts.extraEnv || {}),
  }

  const lines = []
  const push = (tag, buf) => {
    for (const line of String(buf).split(/\r?\n/)) {
      const t = line.trimEnd()
      if (!t) continue
      lines.push(`[${tag}] ${t}`)
      if (lines.length > LOG_TAIL_LINES * 3) lines.splice(0, lines.length - LOG_TAIL_LINES * 3)
    }
  }
  const logTail = () => lines.slice(-LOG_TAIL_LINES).join('\n')

  const children = []
  let stopping = false

  const spawnOne = (name, entry, cwd, extra = {}) => {
    const child = spawn(nodeBin, [entry], {
      cwd,
      env: { ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (b) => push(name, b))
    child.stderr.on('data', (b) => push(name, b))
    children.push(child)
    return child
  }

  /*
   * 启动顺序：**必须 server 先起**。
   *
   * server 在 boot 时会执行 new CommunicationKey(true) —— 每次启动都重新生成一对
   * RSA 密钥（server/storage/comkey/ipc-*.pem），用它给发往 collector 的请求签名。
   * collector 用同一对密钥验签。若 collector 先起，它读到的是上一轮的旧公钥，
   * 于是所有 /process 请求都被判 400 Failed integrity signature check，
   * 表现成上传报「Response could not be completed」（实测踩过，且日志看不出根因）。
   *
   * server 启动时只是探测 collector 是否在线，离线不影响它自己起来；
   * 等 collector 起来后上传即可正常。
   */
  const server = spawnOne('server', serverEntry, path.join(bundleDir, 'server'))
  const origin = `http://127.0.0.1:${port}`
  await waitFor(() => httpOk(`${origin}/api/ping`), SERVER_READY_MS, '知识库服务').catch((e) => {
    throw new Error(`${e.message}\n${logTail()}`)
  })
  log(`[anythingllm] server 就绪：${origin}`)

  // 等密钥落盘再起 collector：读不到就等下一轮
  const comkeyDir = path.join(storageDir, 'comkey')
  await waitFor(
    () => exists(path.join(comkeyDir, 'ipc-priv.pem')) && exists(path.join(comkeyDir, 'ipc-pub.pem')),
    10_000,
    '通信密钥',
  ).catch(() => {
    /* 没有也能起，只是签名会失败；不在这里硬失败，留给上传时暴露 */
  })

  const collector = spawnOne('collector', collectorEntry, path.join(bundleDir, 'collector'), {
    // collector 固定用 8888（它没有端口配置项），已被占用时它自己会退出
    PORT: '8888',
  })
  await waitFor(
    async () =>
      (await httpOk(`http://127.0.0.1:8888/`)) || lines.some((l) => /listening on port 8888/.test(l)),
    COLLECTOR_READY_MS,
    '文档解析进程',
  ).catch((e) => {
    throw new Error(`${e.message}\n${logTail()}`)
  })
  log('[anythingllm] collector 就绪')

  const apiKey = ensureApiKey(dbFile)

  const running = () =>
    children.every((c) => c.exitCode === null && c.signalCode === null) && !stopping

  const stop = async () => {
    stopping = true
    await Promise.all(
      children.map((child) => {
        if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
        return new Promise((resolve) => {
          const done = () => resolve()
          child.once('exit', done)
          child.kill('SIGTERM')
          const killer = setTimeout(() => {
            try {
              child.kill('SIGKILL')
            } catch {
              /* 已经死了 */
            }
            resolve()
          }, KILL_GRACE_MS)
          killer.unref?.()
        })
      }),
    )
    void server
    void collector
  }

  return { origin, apiKey, dataDir, documentsDir, running, stop, logTail }
}
