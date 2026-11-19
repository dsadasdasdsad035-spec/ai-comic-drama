/**
 * `/studio/` 反代的行为测试（用假上游，不依赖 dsh）。
 *
 * 覆盖的都是「看起来能用、实际坏掉」的地方：
 * - 令牌只在服务端注入，浏览器地址栏与 Location 里不能出现明文；
 * - 前缀必须剥掉再转发，Location / Set-Cookie 必须改回带前缀；
 * - 流式响应必须按块到达（缓冲会把会话通道变成一直转圈）；
 * - WebSocket 升级必须原样透传（宿主的会话通道就是 WS）；
 * - 未通过鉴权的请求不能触达上游。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { createStudioProxy, hasHostCookie, hostCookieName, isStudioPath, rewriteLocation, rewriteSetCookie, staleHostCookies, stripStudioPrefix, withBootstrapToken } from '../server/studio-proxy.mjs'

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

// ---------------------------------------------------------------- 纯函数

await check('前缀判定与剥离', () => {
  assert.equal(isStudioPath('/studio'), true)
  assert.equal(isStudioPath('/studio/'), true)
  assert.equal(isStudioPath('/studio/a/b?x=1'), true)
  assert.equal(isStudioPath('/studiox'), false)
  assert.equal(isStudioPath('/api/studio'), false)
  assert.equal(stripStudioPrefix('/studio/a?b=1'), '/a?b=1')
  assert.equal(stripStudioPrefix('/studio'), '/')
  assert.equal(stripStudioPrefix('/studio/'), '/')
})

await check('令牌注入：只认当前 authority 派生的 cookie', () => {
  const authority = '127.0.0.1:6000'
  const fresh = `${hostCookieName(authority)}=v1.abc`
  assert.equal(withBootstrapToken('/a?b=1', 'T0K', ''), '/a?b=1&token=T0K')
  assert.equal(withBootstrapToken('/a', 'T0K', fresh, authority), '/a')
  assert.equal(withBootstrapToken('/a', '', ''), '/a')
  // 换端口前的旧 cookie 前缀也对，但名字不是当前 authority 派生的：必须重新注入令牌
  assert.equal(
    withBootstrapToken('/a', 'T0K', 'dsh-auth-stale=v1.abc', authority),
    '/a?token=T0K',
    '旧 cookie 被当成有效凭据，宿主会一直回 401',
  )
  assert.equal(hasHostCookie(fresh, authority), true)
  assert.equal(hasHostCookie('dsh-auth-stale=v1.abc', authority), false)
  // 只关心「有没有凭据」的调用方仍可退化成前缀判定
  assert.equal(hasHostCookie('dsh-auth-stale=v1.abc'), true)
})

await check('过期凭据会被列出来作废', () => {
  const authority = '127.0.0.1:6000'
  const fresh = `${hostCookieName(authority)}=v1.abc`
  assert.deepEqual(staleHostCookies(`${fresh}; dsh-auth-old=v1.abc`, authority), ['dsh-auth-old'])
  assert.deepEqual(staleHostCookies(fresh, authority), [])
  assert.deepEqual(staleHostCookies('sb_session=x; dsh-auth-old=v1', ''), [])
})

await check('Set-Cookie 作用域收窄到 /studio', () => {
  assert.equal(
    rewriteSetCookie('dsh-auth-x=v1.abc; Max-Age=60; Path=/; HttpOnly'),
    'dsh-auth-x=v1.abc; Max-Age=60; Path=/studio; HttpOnly',
  )
  assert.equal(rewriteSetCookie('a=b; Path=/only'), 'a=b; Path=/only')
})

await check('Location 改写：相对地址补前缀、绝对地址换前缀、外链不动', () => {
  const ctx = { publicBase: 'http://127.0.0.1:5273/studio', upstreamOrigin: 'http://127.0.0.1:6000' }
  assert.equal(rewriteLocation('./', ctx), '/studio/')
  assert.equal(rewriteLocation('./x?y=1', ctx), '/studio/x?y=1')
  assert.equal(rewriteLocation('http://127.0.0.1:6000/a?token=T', ctx), '/studio/a')
  assert.equal(rewriteLocation('https://example.com/z', ctx), 'https://example.com/z')
})

// ---------------------------------------------------------------- 假上游

function startFakeUpstream() {
  return new Promise((resolve) => {
    const state = { hits: 0, lastCookie: '', lastHost: '', lastUrl: '', lastOrigin: '', upgradeOrigin: '' }
    /** 与真实宿主一致：cookie 名由自己的 authority 派生 */
    const authCookie = () => {
      const a = `127.0.0.1:${server.address().port}`
      return `${hostCookieName(a)}=v1.abc; Max-Age=60; Path=/; HttpOnly; SameSite=Strict`
    }
    /** 真实宿主只认自己派生出来的那个名字，换端口前的旧 cookie 视同没有 */
    const hasValidCookie = (req) => {
      const expected = hostCookieName(`127.0.0.1:${server.address().port}`)
      return String(req.headers.cookie || '')
        .split(';')
        .some((part) => part.split('=')[0].trim() === expected)
    }
    const server = http.createServer((req, res) => {
      state.hits += 1
      state.lastCookie = String(req.headers.cookie || '')
      state.lastHost = String(req.headers.host || '')
      state.lastUrl = String(req.url || '')
      state.lastOrigin = String(req.headers.origin || '')
      if (req.url.startsWith('/stream')) {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
        res.write('chunk-1\n')
        setTimeout(() => res.write('chunk-2\n'), 120)
        setTimeout(() => {
          res.write('chunk-3\n')
          res.end()
        }, 240)
        return
      }
      if (req.url.startsWith('/redir')) {
        res.writeHead(303, { Location: './', 'Set-Cookie': authCookie() })
        res.end()
        return
      }
      // 与真实宿主一致：带正确令牌 → 303 + cookie；没有当前实例的 cookie 且没有令牌 → 401
      const hasToken = new URL(req.url, 'http://x').searchParams.get('token') === 'TOK-123'
      if (!hasValidCookie(req)) {
        if (hasToken) {
          res.writeHead(303, { Location: './', 'Set-Cookie': authCookie() })
          res.end()
          return
        }
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><head><base href="./"></head><body>壳</body></html>')
    })
    server.on('upgrade', (req, socket) => {
      state.upgradeOrigin = String(req.headers.origin || '')
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      socket.write('HELLO')
      socket.on('data', (chunk) => socket.write(`ECHO:${chunk.toString()}`))
    })
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, state, origin: `http://127.0.0.1:${port}` })
    })
  })
}

function startProxyHost({ upstream, authorize, ensureCalls }) {
  const host = {
    upstream: () => (upstream ? { origin: upstream.origin, token: 'TOK-123' } : null),
    status: () => ({ state: upstream ? 'ready' : 'failed', error: upstream ? '' : '模拟启动失败', port: 0, restarts: 0 }),
  }
  const proxy = createStudioProxy({
    host,
    authorize,
    ensureStarted: async () => {
      ensureCalls.calls += 1
    },
    log: () => {},
  })
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      proxy.handle(req, res).catch((e) => {
        res.statusCode = 500
        res.end(String(e?.message || e))
      })
    })
    server.on('upgrade', (req, socket, head) => {
      if (!proxy.upgrade(req, socket, head)) socket.destroy()
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

const allowAll = async () => ({ ok: true, publicBase: 'http://127.0.0.1:5273/studio' })

const upstream = await startFakeUpstream()
/** 当前上游实例的有效凭据：名字必须与它自己的 authority 派生结果一致 */
const sessionCookie = `${hostCookieName(upstream.origin.replace('http://', ''))}=v1.abc`
const ensureCalls = { calls: 0 }
const proxyServer = await startProxyHost({ upstream, authorize: allowAll, ensureCalls })

await check('/studio 重定向到 /studio/', async () => {
  const res = await fetch(`${proxyServer.base}/studio`, { redirect: 'manual' })
  assert.equal(res.status, 308)
  assert.equal(res.headers.get('location'), '/studio/')
})

await check('无 cookie：服务端注入令牌并跟随到壳页面', async () => {
  const res = await fetch(`${proxyServer.base}/studio/`, { redirect: 'manual' })
  // 假上游在没有 cookie 时返回 401；反代注入了令牌，所以应当拿到 303
  assert.equal(res.status, 303)
  assert.equal(res.headers.get('location'), '/studio/')
  assert.equal(String(res.headers.get('set-cookie')).includes('Path=/studio'), true)
  assert.equal(String(res.headers.get('location')).includes('token='), false)
  assert.equal(upstream.state.lastUrl.includes('token=TOK-123'), true, `上游收到的 URL：${upstream.state.lastUrl}`)
  assert.equal(upstream.state.lastHost, upstream.origin.replace('http://', ''))
})

await check('带 cookie：壳页面正常返回且不再带令牌', async () => {
  upstream.state.lastUrl = ''
  const res = await fetch(`${proxyServer.base}/studio/`, {
    headers: { cookie: sessionCookie },
    redirect: 'manual',
  })
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /<base href="\.\/">/)
  assert.equal(upstream.state.lastUrl.includes('token='), false, `上游收到的 URL：${upstream.state.lastUrl}`)
})

await check('Origin 围栏：转发时把 Origin 换成上游 authority', async () => {
  upstream.state.lastOrigin = ''
  const res = await fetch(`${proxyServer.base}/studio/`, {
    headers: { cookie: sessionCookie, origin: `http://127.0.0.1:${proxyServer.port}` },
    redirect: 'manual',
  })
  assert.equal(res.status, 200)
  // 宿主只认「Origin 等于 Host」：不改写的话真实宿主会中止升级，界面一直停在「重新连接中」
  assert.equal(upstream.state.lastOrigin, upstream.origin, `上游收到的 Origin：${upstream.state.lastOrigin}`)
})

await check('Origin 为 null（不透明来源）不改写', async () => {
  upstream.state.lastOrigin = ''
  await fetch(`${proxyServer.base}/studio/`, {
    headers: { cookie: sessionCookie, origin: 'null' },
    redirect: 'manual',
  })
  assert.equal(upstream.state.lastOrigin, 'null', '不透明来源必须原样交给宿主拒绝')
})

await check('换端口前的旧凭据：重新注入令牌并作废旧 cookie', async () => {
  upstream.state.lastUrl = ''
  // 模拟宿主重启换了端口：浏览器里留着旧 authority 派生的 dsh-auth-*
  const res = await fetch(`${proxyServer.base}/studio/`, {
    headers: { cookie: 'dsh-auth-stalePort=v1.abc' },
    redirect: 'manual',
  })
  assert.equal(res.status, 303, '旧 cookie 被误判为有效凭据，宿主会一直回 401')
  assert.equal(upstream.state.lastUrl.includes('token=TOK-123'), true, `上游收到的 URL：${upstream.state.lastUrl}`)
  const cookies = res.headers.getSetCookie?.() ?? []
  assert.ok(
    cookies.some((c) => c.startsWith('dsh-auth-stalePort=;') && /Max-Age=0/.test(c)),
    `没有作废旧 cookie：${cookies.join(' | ')}`,
  )
})


await check('流式响应按块到达而不是一次吐完', async () => {
  const started = Date.now()
  const res = await fetch(`${proxyServer.base}/studio/stream`, { headers: { cookie: sessionCookie } })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const arrivals = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    arrivals.push({ at: Date.now() - started, text: decoder.decode(value) })
  }
  const text = arrivals.map((a) => a.text).join('')
  assert.match(text, /chunk-3/)
  assert.ok(arrivals.length >= 2, `期望分块到达，实际 ${arrivals.length} 块`)
  assert.ok(arrivals[0].at < arrivals[arrivals.length - 1].at, '首块应早于末块到达')
})

await check('WebSocket 升级透传', async () => {
  const result = await new Promise((resolve, reject) => {
    const socket = net.connect(proxyServer.port, '127.0.0.1', () => {
      socket.write(
        [
          'GET /studio/ws HTTP/1.1',
          `Host: 127.0.0.1:${proxyServer.port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          `Cookie: ${sessionCookie}`,
          `Origin: http://127.0.0.1:${proxyServer.port}`,
          '',
          '',
        ].join('\r\n'),
      )
    })
    let buffer = ''
    let sent = false
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`升级超时，已收到：${buffer.slice(0, 200)}`))
    }, 5000)
    socket.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!sent && buffer.includes('HELLO')) {
        sent = true
        socket.write('PING')
      }
      if (buffer.includes('ECHO:PING')) {
        clearTimeout(timer)
        socket.destroy()
        resolve(buffer)
      }
    })
    socket.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
  assert.match(result, /HTTP\/1\.1 101/)
  assert.match(result, /ECHO:PING/)
  // 浏览器一定会带 Origin；宿主要求它等于 Host，否则整个会话通道起不来
  assert.equal(upstream.state.upgradeOrigin, upstream.origin, `升级时上游收到的 Origin：${upstream.state.upgradeOrigin}`)
})

await check('鉴权失败：401 且不拉起宿主', async () => {
  const denyCalls = { calls: 0 }
  const denied = await startProxyHost({
    upstream,
    authorize: async () => ({ ok: false, status: 401, message: '未登录', publicBase: '' }),
    ensureCalls: denyCalls,
  })
  try {
    const res = await fetch(`${denied.base}/studio/`, { redirect: 'manual' })
    assert.equal(res.status, 401)
    assert.equal(denyCalls.calls, 0, '未通过鉴权不应触发宿主启动')
  } finally {
    denied.server.close()
  }
})

await check('宿主不可用：503 带可读中文原因', async () => {
  const dead = await startProxyHost({ upstream: null, authorize: allowAll, ensureCalls: { calls: 0 } })
  try {
    const res = await fetch(`${dead.base}/studio/`, { redirect: 'manual' })
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.match(body.message, /创意会话宿主不可用/)
    assert.match(body.message, /模拟启动失败/)
  } finally {
    dead.server.close()
  }
})

await check('宿主不可用：浏览器请求得到带重试按钮的错误页', async () => {
  const dead = await startProxyHost({ upstream: null, authorize: allowAll, ensureCalls: { calls: 0 } })
  try {
    const res = await fetch(`${dead.base}/studio/`, {
      redirect: 'manual',
      headers: { accept: 'text/html,application/xhtml+xml' },
    })
    assert.equal(res.status, 503)
    assert.match(String(res.headers.get('content-type')), /text\/html/)
    const html = await res.text()
    assert.match(html, /创意会话暂不可用/)
    assert.match(html, /id="retry"/)
    assert.match(html, /\/studio\/_host\/restart/)
  } finally {
    dead.server.close()
  }
})

await check('鉴权通过才触发宿主启动', async () => {
  assert.ok(ensureCalls.calls > 0, '通过鉴权的请求应触发宿主启动')
})

proxyServer.server.close()
upstream.server.close()

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ `/studio/` 反代全部通过')
process.exit(bad ? 1 : 0)
