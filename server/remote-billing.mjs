/**
 * 桌面端「共用线上账号」的转发层。
 *
 * 背景：桌面端默认自带一套本地账本（`<state>/data/billing.sqlite`），
 * 与公网部署的 rechargeai.cn 是两套互不相通的数据。用户希望桌面端用同一个
 * 账号充值、同一份积分，于是把「账号 + 钱包」这类接口整体转给线上服务。
 *
 * 为什么在本机进程里做反向代理，而不是让前端直连线上：
 * 1. 前端只认同源相对路径（`/api/auth/*`、`/api/billing/*`），页面 origin 是
 *    `http://127.0.0.1:<随机端口>`；直连线上属于跨站，`SameSite=Lax` 的会话
 *    Cookie 不会被发送，得改 `SameSite=None; Secure` 并给线上加 CORS 白名单。
 * 2. 线上还挂着 Basic Auth 口令，桌面端没法弹口令框；由本进程代填 `Authorization`
 *    头（或线上对这两个前缀放开口令）最省事。
 * 3. `Set-Cookie` 原样回给浏览器，浏览器按 127.0.0.1 存，后续请求再由本进程转发，
 *    会话链路完全不用改前端。
 *
 * 配置（环境变量）：
 * - `SB_BILLING_BASE`  线上计费服务地址，如 `https://rechargeai.cn`。
 *                      留空或填 `local` / `off` 表示继续用本地账本。
 * - `SB_BILLING_AUTH`  可选，`user:pass`，转发时作为 Basic Auth 发送。
 *                      线上若已对 `/api/auth/`、`/api/billing/` 放开口令，可不填。
 */
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { URL } from 'node:url'
import { mediaPath } from './paths.mjs'

/** 需要转给线上服务的账号与钱包接口前缀 */
const REMOTE_PREFIXES = ['/api/auth/', '/api/billing/']

/** 会产生积分消费的模型接口：桌面端没有平台 Key 时也要转给线上，才能扣线上积分 */
const REMOTE_MODEL_ROUTES = ['/api/text', '/api/seedream', '/api/seedance']

/**
 * 线上产出的媒体目录。
 *
 * 这些路径由线上生成后返回给前端（如 `/generated/shot-x.jpg`），桌面端必须能显示，
 * 而它实际躺在线上磁盘里。做法是「首次访问时回源下载到本机媒体根」，
 * 之后与本地产出一模一样（导出、保存到项目都能直接读文件）。
 */
const REMOTE_MEDIA_PREFIXES = [
  '/generated/',
  '/videos/',
  '/voices/',
  '/exports/',
  '/publish-packages/',
]

/** 上游无响应时的挂起上限，避免登录请求像死了一样 */
const UPSTREAM_IDLE_TIMEOUT_MS = 60_000
/**
 * 模型接口的挂起上限。
 *
 * 出图/出片是同步等待上游返回的，期间 nginx 与 Node 都不会发任何字节，
 * 30 秒的默认值会把正常的 Seedream 请求判死（实测一张图约 35 秒），
 * 而且连接被掐断会让线上的预扣积分变成悬空冻结。
 */
const MODEL_IDLE_TIMEOUT_MS = 10 * 60_000
/** 媒体回源没有幂等重试，给更长的时间窗（大视频） */
const MEDIA_IDLE_TIMEOUT_MS = 10 * 60_000
/** 回源媒体大小上限，防止把本机磁盘写满 */
const MEDIA_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** 线上计费服务地址；返回空串表示用本地账本 */
export function remoteBillingBase() {
  const raw = String(process.env.SB_BILLING_BASE || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'local' || lower === 'off' || lower === 'false' || lower === '0') return ''
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    // 只保留 origin + 可能的子路径前缀，避免拼出 `//api/auth/login`
    const prefix = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host}${prefix}`
  } catch {
    return ''
  }
}

/** 转发时附带的 Basic Auth 头；未配置返回空串 */
export function remoteBillingAuthHeader() {
  const raw = String(process.env.SB_BILLING_AUTH || '').trim()
  if (!raw) return ''
  const user = String(process.env.SB_BILLING_USER || '').trim()
  const pass = String(process.env.SB_BILLING_PASS || '')
  const pair = raw.includes(':') ? raw : user ? `${user}:${pass}` : ''
  if (!pair) return ''
  return `Basic ${Buffer.from(pair).toString('base64')}`
}

/** 这个 URL 是否该转给线上（未配置线上地址时恒为 false） */
export function shouldProxyRemoteBilling(url) {
  if (!remoteBillingBase()) return false
  const path = String(url || '').split('?')[0]
  // /api/seedance 还有 /recover 这类子路径，按前缀判断
  if (REMOTE_MODEL_ROUTES.some((r) => path === r || path.startsWith(`${r}/`))) return true
  return REMOTE_PREFIXES.some((p) => path.startsWith(p))
}

/** 这个 URL 是否为「线上产出、本机可能还没有」的媒体 */
export function shouldProxyRemoteMedia(url) {
  if (!remoteBillingBase()) return false
  const p = String(url || '').split('?')[0]
  return REMOTE_MEDIA_PREFIXES.some((x) => p.startsWith(x))
}

/** 当前计费模式，给 /api/health 与日志用 */
export function billingModeInfo() {
  const base = remoteBillingBase()
  return { mode: base ? 'remote' : 'local', base }
}

function jsonError(res, status, kind, message) {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, kind, message }))
}

/** 复制请求头，跳过逐跳头与需要改写的 Host/Authorization */
function forwardedRequestHeaders(req, base, authHeader) {
  const headers = {}
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v === undefined) continue
    const key = k.toLowerCase()
    if (key === 'host' || key === 'connection' || key === 'keep-alive') continue
    if (key === 'authorization' && authHeader) continue
    headers[k] = v
  }
  const u = new URL(base)
  headers.host = u.host
  if (authHeader) headers.authorization = authHeader
  // 线上若挂了网站在反向代理后面，保留原始客户端信息便于排障
  headers['x-forwarded-host'] = String(req.headers?.host || '')
  return headers
}

/**
 * 把请求转发到线上计费服务。
 * 返回 Promise：调用方 await 后直接 return，不再走本机路由。
 */
export function proxyRemoteBilling(req, res, url) {
  const base = remoteBillingBase()
  if (!base) {
    // 调用方本应先问 shouldProxyRemoteBilling；这里兜底，避免请求挂着没人回
    jsonError(res, 500, 'no-remote-base', '未配置线上计费服务地址（SB_BILLING_BASE）')
    return Promise.resolve(true)
  }

  const target = new URL(base + (url || '/'))
  const client = target.protocol === 'https:' ? https : http
  const authHeader = remoteBillingAuthHeader()
  const pathOnly = String(url || '').split('?')[0]
  const idleTimeout = REMOTE_MODEL_ROUTES.some((r) => pathOnly === r || pathOnly.startsWith(`${r}/`))
    ? MODEL_IDLE_TIMEOUT_MS
    : UPSTREAM_IDLE_TIMEOUT_MS

  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    const upstream = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers: forwardedRequestHeaders(req, base, authHeader),
      },
      (up) => {
        res.statusCode = up.statusCode || 502
        for (const [k, v] of Object.entries(up.headers)) {
          const key = k.toLowerCase()
          // 逐跳头交给本机 Node 重新生成，照抄会让响应体错乱
          if (key === 'connection' || key === 'transfer-encoding' || key === 'keep-alive') continue
          if (v !== undefined) res.setHeader(k, v)
        }
        up.pipe(res)
        up.on('end', () => done(true))
        up.on('error', () => done(true))
      },
    )

    upstream.setTimeout(idleTimeout, () => {
      upstream.destroy(new Error('timeout'))
    })

    upstream.on('error', (e) => {
      console.warn(`[billing] 转发线上失败 ${url}：${e?.message || e}`)
      if (res.headersSent) {
        res.destroy()
        done(true)
        return
      }
      jsonError(res, 502, 'remote-unreachable', `无法连接线上计费服务（${target.origin}），请检查网络后重试`)
      done(true)
    })

    // 客户端提前断开时别把上游连接留着
    res.on('close', () => {
      if (!res.writableEnded) upstream.destroy()
    })

    req.pipe(upstream)
    req.on('error', () => upstream.destroy())
  })
}

// ---------------------------------------------------------------- 媒体回源

/** 同一个文件被并发访问时只下载一次 */
const inflightDownloads = new Map()

/** 从线上把一个媒体文件拉到本地路径（先写 .part 再原子改名） */
function downloadToFile(base, urlPath, file, cookie = '') {
  return new Promise((resolve, reject) => {
    const target = new URL(base + urlPath)
    const client = target.protocol === 'https:' ? https : http
    const authHeader = remoteBillingAuthHeader()
    const headers = { accept: '*/*', 'accept-encoding': 'identity' }
    if (authHeader) headers.authorization = authHeader
    // 线上静态媒体对「已登录会话」放行，桌面端因此必须带上用户自己的 Cookie
    if (cookie) headers.cookie = cookie

    const fail = (e) => reject(e)
    const req = client.get(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (up) => {
        if (up.statusCode !== 200) {
          up.resume()
          const err = new Error(`上游返回 ${up.statusCode}`)
          err.status = up.statusCode
          fail(err)
          return
        }
        const declared = Number(up.headers['content-length'] || 0)
        if (declared > MEDIA_MAX_BYTES) {
          up.destroy()
          const err = new Error(`文件超过 ${MEDIA_MAX_BYTES} 字节上限`)
          err.status = 413
          fail(err)
          return
        }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = `${file}.part-${process.pid}-${Date.now()}`
        const out = fs.createWriteStream(tmp)
        let bytes = 0
        const drop = (e) => {
          up.destroy()
          out.destroy()
          try {
            fs.unlinkSync(tmp)
          } catch {
            /* 临时文件可能还没建出来 */
          }
          fail(e)
        }
        up.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > MEDIA_MAX_BYTES) drop(new Error('文件超过本机缓存上限'))
        })
        up.on('error', drop)
        out.on('error', drop)
        out.on('finish', () => {
          fs.rename(tmp, file, (e) => (e ? drop(e) : resolve()))
        })
        up.pipe(out)
      },
    )
    req.setTimeout(MEDIA_IDLE_TIMEOUT_MS, () => req.destroy(new Error('回源超时')))
    req.on('error', fail)
  })
}

/**
 * 线上产出的媒体：本机没有就先回源下载。
 *
 * 返回值语义：true = 已经写过响应，不要再走本地路由；
 * false = 文件已就绪（或本来就该由本地处理器负责），交给调用方继续。
 */
export async function proxyRemoteMedia(req, res, url, root) {
  const base = remoteBillingBase()
  if (!base) return false
  const method = String(req.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return false

  const urlPath = String(url || '').split('?')[0]
  let rel = ''
  try {
    rel = decodeURIComponent(urlPath).replace(/^\/+/, '')
  } catch {
    return false
  }
  let file = ''
  try {
    file = mediaPath(root, rel)
  } catch {
    // 越界路径交给本地处理器去报 400
    return false
  }
  try {
    if (fs.statSync(file).isFile()) return false
  } catch {
    /* 不存在才继续回源 */
  }

  const pending = inflightDownloads.get(file)
  if (pending) {
    try {
      await pending
    } catch (e) {
      jsonError(res, e?.status === 404 ? 404 : 502, 'remote-media', `线上素材不可用：${e?.message || e}`)
      return true
    }
    return false
  }

  const job = downloadToFile(base, urlPath, file, String(req.headers?.cookie || ''))
  inflightDownloads.set(file, job)
  try {
    await job
    return false
  } catch (e) {
    console.warn(`[billing] 线上素材回源失败 ${urlPath}：${e?.message || e}`)
    jsonError(
      res,
      e?.status === 404 ? 404 : 502,
      'remote-media',
      e?.status === 404 ? '线上素材不存在' : `无法从线上取回素材（${e?.message || e}）`,
    )
    return true
  } finally {
    inflightDownloads.delete(file)
  }
}
