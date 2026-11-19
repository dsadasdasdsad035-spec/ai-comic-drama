/**
 * 创意会话宿主（dsh）的 `/studio/` 反向代理。
 *
 * 为什么要有这一层，而不是让浏览器直连宿主：
 * - 宿主只监听 127.0.0.1，且用「URL 里的引导令牌」换取 cookie。令牌一旦出现在
 *   地址栏或页面源码就等同于把宿主完全交给任何能看到它的人。反代在服务端完成
 *   令牌注入与 303 换取，浏览器只拿到 HttpOnly cookie。
 * - 同源才能让主题变量、全局导航和 `/studio/` 前缀路由成立。
 * - 宿主的 `<base href="./">` 与 `--public-url` 都按 `/studio/` 前缀工作，
 *   所以转发时必须剥掉这个前缀，返回时必须把 Location / Set-Cookie 改回带前缀。
 *
 * 长连接：宿主的会话通道是 WebSocket（不是 SSE），升级请求必须原样透传到上游，
 * 不能用普通 HTTP 转发，否则页面上会出现「连不上」但没有任何报错的空壳。
 */
import http from 'node:http'

/** 挂在应用路径下的前缀；不带尾斜杠的请求会被重定向到带斜杠的形式 */
export const STUDIO_PREFIX = '/studio'
/** 宿主的鉴权 cookie 前缀（宿主按 authority 派生后缀，所以只能按前缀判断） */
const AUTH_COOKIE_PREFIX = 'dsh-auth-'
/** 这些头是逐跳头，不能原样转发 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const agent = new http.Agent({ keepAlive: true, maxSockets: 64 })

export function isStudioPath(url) {
  const pathname = String(url || '').split('?')[0]
  return pathname === STUDIO_PREFIX || pathname.startsWith(`${STUDIO_PREFIX}/`)
}

/** 把 `/studio/a?b` 变成 `/a?b`；`/studio` 变成 `/` */
export function stripStudioPrefix(url) {
  const raw = String(url || '')
  const queryAt = raw.indexOf('?')
  const pathname = queryAt >= 0 ? raw.slice(0, queryAt) : raw
  const search = queryAt >= 0 ? raw.slice(queryAt) : ''
  const rest = pathname.slice(STUDIO_PREFIX.length)
  return `${rest || '/'}${search}`
}

/** 浏览器是否已经持有宿主的鉴权 cookie */
export function hasHostCookie(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    if (part.trim().startsWith(AUTH_COOKIE_PREFIX)) return true
  }
  return false
}

/**
 * 给上游 URL 补上引导令牌。
 * 已有 cookie 的请求不再带令牌：令牌是「换 cookie」的一次性手段，不是每次请求的凭据。
 */
export function withBootstrapToken(pathWithQuery, token, cookieHeader) {
  if (!token || hasHostCookie(cookieHeader)) return pathWithQuery
  const url = new URL(pathWithQuery, 'http://placeholder.invalid')
  url.searchParams.set('token', token)
  return `${url.pathname}${url.search}`
}

/**
 * 把上游返回的 Location 改写成对外可见的路径。
 * 宿主自己的 303 是 `Location: ./`（相对上游根），不改写会把浏览器带回 `/`。
 */
export function rewriteLocation(location, { publicBase, upstreamOrigin }) {
  const raw = String(location || '')
  if (!raw) return raw
  let url
  try {
    // 相对地址按「对外前缀」解析，而不是按上游根：对外前缀才是浏览器实际所在的位置
    url = new URL(raw, `${publicBase}/`)
  } catch {
    return raw
  }
  if (url.origin === upstreamOrigin) {
    // 上游绝对地址 → 换回对外前缀，且不把引导令牌带进地址栏
    url.searchParams.delete('token')
    return `${STUDIO_PREFIX}${url.pathname}${url.search}${url.hash}`
  }
  if (raw.startsWith('.')) {
    // 相对地址解析后可能已经落在对外前缀里（例如 `./` → `/studio/`），别再叠一次
    const pathname = url.pathname.startsWith(STUDIO_PREFIX) ? url.pathname : `${STUDIO_PREFIX}${url.pathname}`
    return `${pathname}${url.search}${url.hash}`
  }
  return raw
}

/** 把宿主 cookie 的作用域收窄到 `/studio`，避免凭据被无关接口带上 */
export function rewriteSetCookie(cookie) {
  return String(cookie || '').replace(/;\s*Path=\/(?=;|$)/i, `; Path=${STUDIO_PREFIX}`)
}

function jsonError(res, status, message) {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ ok: false, message }))
}

/** 宿主不可用时给浏览器的可读错误页：说明原因 + 一个可点的重试入口 */
function hostErrorPage(status, message) {
  const safe = String(message || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>创意会话暂不可用</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px/1.7 system-ui,-apple-system,"PingFang SC",sans-serif;
background:Canvas;color:CanvasText}
main{max-width:520px;padding:32px}
h1{margin:0 0 12px;font-size:18px}
p{margin:0 0 10px;color:color-mix(in srgb,CanvasText 72%,Canvas)}
code{display:block;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,CanvasText 8%,Canvas);
white-space:pre-wrap;word-break:break-word;margin:12px 0}
button{font:inherit;padding:8px 18px;border-radius:8px;border:1px solid color-mix(in srgb,CanvasText 24%,Canvas);
background:color-mix(in srgb,CanvasText 6%,Canvas);color:inherit;cursor:pointer}
button:hover{background:color-mix(in srgb,CanvasText 12%,Canvas)}
#hint{margin-top:12px;font-size:13px}
</style></head>
<body><main>
<h1>创意会话暂不可用</h1>
<p>创意会话的宿主进程没有就绪，其它视图不受影响。</p>
<code>${safe}</code>
<button id="retry">重试</button>
<p id="hint"></p>
<script>
document.getElementById('retry').addEventListener('click', async (e) => {
  const hint = document.getElementById('hint')
  e.target.disabled = true
  hint.textContent = '正在重新启动宿主…'
  try {
    const res = await fetch('/studio/_host/restart', { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.ok) { location.reload(); return }
    hint.textContent = body.message || '重启失败，请稍后再试'
  } catch (err) {
    hint.textContent = '重启请求失败：' + (err && err.message ? err.message : String(err))
  } finally {
    e.target.disabled = false
  }
})
</script>
</main></body></html>`
}

function hostUnavailable(res, status, message, wantsHtml) {
  if (res.writableEnded || res.destroyed) return
  if (!wantsHtml) {
    jsonError(res, status, message)
    return
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(hostErrorPage(status, message))
}

/**
 * 创建代理。`host` 是 createCreativeHost 的返回值，`authorize` 是应用侧的访问控制回调
 * （返回 { ok, status, message, publicBase }），`ensureStarted` 负责按需拉起宿主
 * —— 只有在通过鉴权后才会触发启动，未认证的请求不会触达宿主。
 */
export function createStudioProxy({ host, authorize, ensureStarted, log = () => {} }) {
  function upstreamOrNull(res, wantsHtml) {
    const up = host.upstream()
    if (up) return up
    const status = host.status()
    const detail = status.error ? `：${status.error}` : ''
    hostUnavailable(res, 503, `创意会话宿主不可用${detail}`, wantsHtml)
    return null
  }

  function buildUpstreamHeaders(req, up, { forUpgrade = false } = {}) {
    const headers = {}
    for (const [k, v] of Object.entries(req.headers || {})) {
      if (v === undefined) continue
      const key = k.toLowerCase()
      // 升级握手必须保留 Connection/Upgrade，否则上游只会当成普通 GET 处理
      if (!forUpgrade && HOP_BY_HOP.has(key)) continue
      headers[key] = v
    }
    // Host 必须是上游 authority：宿主的浏览器信任围栏按它判定来源
    headers.host = up.origin.replace(/^https?:\/\//, '')
    return headers
  }

  function filterResponseHeaders(upstreamRes) {
    const headers = {}
    for (const [k, v] of Object.entries(upstreamRes.headers || {})) {
      if (v === undefined) continue
      const key = k.toLowerCase()
      if (HOP_BY_HOP.has(key)) continue
      if (key === 'location' || key === 'set-cookie') continue
      headers[key] = v
    }
    return headers
  }

  async function handle(req, res) {
    const wantsHtml = String(req.headers.accept || '').includes('text/html')
    const decision = await authorize(req)
    if (!decision.ok) {
      hostUnavailable(res, decision.status || 401, decision.message || '未通过认证', wantsHtml)
      return
    }

    // 不带尾斜杠时先规范化：相对资源与 cookie 的作用域都依赖这个斜杠
    const rawUrl = String(req.url || '')
    if (rawUrl.split('?')[0] === STUDIO_PREFIX) {
      res.statusCode = 308
      res.setHeader('Location', `${STUDIO_PREFIX}/${rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : ''}`)
      res.end()
      return
    }

    // 通过鉴权后才拉起宿主：未认证请求不触达宿主进程
    if (ensureStarted) await ensureStarted()

    const up = upstreamOrNull(res, wantsHtml)
    if (!up) return

    const upstreamPath = withBootstrapToken(stripStudioPrefix(rawUrl), up.token, req.headers.cookie)
    const publicBase = decision.publicBase || ''

    await new Promise((resolve) => {
      const upstreamReq = http.request(
        {
          agent,
          host: '127.0.0.1',
          port: Number(new URL(up.origin).port),
          method: req.method,
          path: upstreamPath,
          headers: buildUpstreamHeaders(req, up),
        },
        (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502
          for (const [k, v] of Object.entries(filterResponseHeaders(upstreamRes))) {
            res.setHeader(k, v)
          }
          const location = upstreamRes.headers.location
          if (location) res.setHeader('Location', rewriteLocation(location, { publicBase, upstreamOrigin: up.origin }))
          const cookies = upstreamRes.headers['set-cookie']
          if (cookies) res.setHeader('Set-Cookie', cookies.map(rewriteSetCookie))
          // 让前置 nginx 也不要缓冲：会话通道是流式的，缓冲会表现成「界面一直转圈」
          res.setHeader('X-Accel-Buffering', 'no')
          res.flushHeaders?.()
          upstreamRes.pipe(res)
          upstreamRes.on('end', resolve)
          upstreamRes.on('error', () => {
            if (!res.writableEnded) res.end()
            resolve()
          })
        },
      )
      // 长连接不设超时：会话流可能长时间空闲但仍是有效连接
      upstreamReq.setTimeout(0)
      upstreamReq.on('error', (e) => {
        log(`[studio] 上游请求失败：${e?.message || String(e)}`)
        hostUnavailable(res, 502, `创意会话宿主转发失败：${e?.message || String(e)}`, wantsHtml)
        resolve()
      })
      req.pipe(upstreamReq)
      req.on('aborted', () => upstreamReq.destroy())
    })
  }

  /** WebSocket 升级：原样透传，不做帧级处理 */
  function upgrade(req, socket, head) {
    if (!isStudioPath(req.url)) return false
    void ensureStarted?.()
    const up = host.upstream()
    if (!up) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n')
      return true
    }
    const upstreamPath = withBootstrapToken(stripStudioPrefix(req.url), up.token, req.headers.cookie)
    const upstreamReq = http.request({
      // 升级请求不能用复用连接的 agent：它会把 101 之后的字节当成普通响应
      agent: false,
      host: '127.0.0.1',
      port: Number(new URL(up.origin).port),
      method: req.method,
      path: upstreamPath,
      headers: buildUpstreamHeaders(req, up, { forUpgrade: true }),
    })
    upstreamReq.setTimeout(0)
    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ''}`]
      for (const [k, v] of Object.entries(upstreamRes.headers)) {
        if (v === undefined) continue
        if (Array.isArray(v)) for (const item of v) lines.push(`${k}: ${item}`)
        else lines.push(`${k}: ${v}`)
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead?.length) socket.write(upstreamHead)
      if (head?.length) upstreamSocket.write(head)
      socket.setNoDelay?.(true)
      upstreamSocket.setNoDelay?.(true)
      socket.pipe(upstreamSocket)
      upstreamSocket.pipe(socket)
      const close = () => {
        socket.destroy()
        upstreamSocket.destroy()
      }
      socket.on('error', close)
      upstreamSocket.on('error', close)
      socket.on('close', close)
      upstreamSocket.on('close', close)
    })
    upstreamReq.on('response', (upstreamRes) => {
      // 上游拒绝了升级（例如 cookie 无效）：把状态透给浏览器，别让它一直等
      socket.end(`HTTP/1.1 ${upstreamRes.statusCode || 502} Bad Gateway\r\n\r\n`)
      upstreamRes.resume()
    })
    upstreamReq.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
    upstreamReq.end()
    return true
  }

  return { handle, upgrade }
}
