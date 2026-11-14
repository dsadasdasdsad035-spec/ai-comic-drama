// 校验桌面端「共用线上账号」的转发层：
// 1. SB_BILLING_BASE 的解析与开关语义（空 / local / 非法值都回本地账本）
// 2. 只有 /api/auth/、/api/billing/ 会被转发，其余接口留在本机
// 3. 转发保留方法、请求体、Cookie，并把上游的 Set-Cookie / 状态码原样带回
// 4. 上游不可达时返回 502 remote-unreachable，而不是挂死或 500
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  proxyRemoteBilling,
  proxyRemoteMedia,
  remoteBillingBase,
  shouldProxyRemoteBilling,
  shouldProxyRemoteMedia,
} from './server/remote-billing.mjs'

const cases = []
function record(name, ok, message) {
  cases.push({ name, ok, message })
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ' → ' + message}`)
}
function check(name, fn) {
  try {
    fn()
    record(name, true)
  } catch (e) {
    record(name, false, e.message)
  }
}
async function checkAsync(name, fn) {
  try {
    await fn()
    record(name, true)
  } catch (e) {
    record(name, false, e.message)
  }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}
function withEnv(pairs, fn) {
  const backup = {}
  for (const [k, v] of Object.entries(pairs)) {
    backup[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  const restore = () => {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  let out
  try {
    out = fn()
  } catch (e) {
    restore()
    throw e
  }
  // 异步断言要等请求跑完再还原 env，否则转发时读到的是空地址
  if (out && typeof out.then === 'function') return out.finally(restore)
  restore()
  return out
}

// ---- 1. 开关语义 ----
check('未配置时用本地账本', () => {
  withEnv({ SB_BILLING_BASE: undefined }, () => {
    eq(remoteBillingBase(), '', 'base')
    eq(shouldProxyRemoteBilling('/api/auth/login'), false, 'shouldProxy')
  })
})
for (const off of ['local', 'LOCAL', 'off', '0', 'false', '   ']) {
  check(`SB_BILLING_BASE=${JSON.stringify(off)} 视为本地`, () => {
    withEnv({ SB_BILLING_BASE: off }, () => eq(remoteBillingBase(), '', 'base'))
  })
}
check('规范化地址（去尾斜杠、丢路径尾）', () => {
  withEnv({ SB_BILLING_BASE: 'https://rechargeai.cn/' }, () => eq(remoteBillingBase(), 'https://rechargeai.cn', 'base'))
})
check('带子路径的地址保留前缀', () => {
  withEnv({ SB_BILLING_BASE: 'https://example.com/sb/' }, () => eq(remoteBillingBase(), 'https://example.com/sb', 'base'))
})
check('非 http(s) 协议忽略', () => {
  withEnv({ SB_BILLING_BASE: 'ftp://example.com' }, () => eq(remoteBillingBase(), '', 'base'))
})

// ---- 2. 白名单 ----
withEnv({ SB_BILLING_BASE: 'https://rechargeai.cn' }, () => {
  for (const url of [
    '/api/auth/login',
    '/api/auth/me',
    '/api/billing/packs',
    '/api/billing/order?trade_order_id=x',
    '/api/text',
    '/api/seedream',
    '/api/seedance',
    '/api/seedance?id=v-1',
    '/api/seedance/recover',
  ]) {
    check(`转发 ${url}`, () => eq(shouldProxyRemoteBilling(url), true, 'shouldProxy'))
  }
  for (const url of ['/api/settings', '/api/project', '/generated/a.jpg', '/api/billingx', '/api/vision', '/api/voice']) {
    check(`本地保留 ${url}`, () => eq(shouldProxyRemoteBilling(url), false, 'shouldProxy'))
  }
  for (const url of ['/generated/a.jpg', '/videos/a.mp4', '/voices/a.mp3', '/exports/a.mp4', '/publish-packages/a.zip']) {
    check(`媒体回源 ${url}`, () => eq(shouldProxyRemoteMedia(url), true, 'shouldProxyRemoteMedia'))
  }
  for (const url of ['/project-assets/p/a.png', '/api/text', '/presets/a.json']) {
    check(`媒体不回源 ${url}`, () => eq(shouldProxyRemoteMedia(url), false, 'shouldProxyRemoteMedia'))
  }
})

// ---- 3/4. 真实转发 ----
async function withServers(fn, extraEnv = {}) {
  const seen = []
  const upstream = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        cookie: req.headers.cookie || '',
        auth: req.headers.authorization || '',
        body,
      })
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Set-Cookie', 'sb_session=abc; Path=/; HttpOnly; SameSite=Lax')
      res.end(JSON.stringify({ ok: true, upstream: true, echo: body }))
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const upstreamPort = upstream.address().port

  const local = http.createServer((req, res) => {
    void proxyRemoteBilling(req, res, req.url || '/')
  })
  await new Promise((r) => local.listen(0, '127.0.0.1', r))
  const localPort = local.address().port

  try {
    await withEnv(
      { SB_BILLING_BASE: `http://127.0.0.1:${upstreamPort}`, SB_BILLING_AUTH: undefined, ...extraEnv },
      () => fn({ localPort, seen }),
    )
  } finally {
    await new Promise((r) => local.close(r))
    await new Promise((r) => upstream.close(r))
  }
}

await checkAsync('POST 请求体与 Cookie 转发到上游', async () => {
  await withServers(async ({ localPort, seen }) => {
    const r = await fetch(`http://127.0.0.1:${localPort}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: 'sb_session=old' },
      body: JSON.stringify({ email: 'a@b.c', password: 'p' }),
    })
    const j = await r.json()
    eq(r.status, 200, 'status')
    eq(j.upstream, true, 'body 来自上游')
    eq(seen[0].method, 'POST', 'method')
    eq(seen[0].url, '/api/auth/login', 'url')
    eq(seen[0].cookie, 'sb_session=old', 'cookie')
    eq(JSON.parse(seen[0].body), { email: 'a@b.c', password: 'p' }, 'body')
  })
})

await checkAsync('上游 Set-Cookie 原样回到浏览器', async () => {
  await withServers(async ({ localPort }) => {
    const r = await fetch(`http://127.0.0.1:${localPort}/api/auth/me`)
    const cookie = r.headers.get('set-cookie') || ''
    eq(cookie.includes('sb_session=abc'), true, 'set-cookie')
  })
})

await checkAsync('查询参数不丢', async () => {
  await withServers(async ({ localPort, seen }) => {
    await fetch(`http://127.0.0.1:${localPort}/api/billing/order?trade_order_id=sb_1_x`)
    eq(seen[0].url, '/api/billing/order?trade_order_id=sb_1_x', 'url')
  })
})

await checkAsync('未配置口令时不自作主张加 Authorization', async () => {
  await withServers(async ({ localPort, seen }) => {
    await fetch(`http://127.0.0.1:${localPort}/api/billing/packs`)
    eq(seen[0].auth, '', 'authorization')
  })
})

await checkAsync('配置 SB_BILLING_AUTH 时替换为服务端口令', async () => {
  await withServers(
    async ({ localPort, seen }) => {
      await fetch(`http://127.0.0.1:${localPort}/api/billing/packs`, {
        headers: { Authorization: 'Basic old-browser-credential' },
      })
      eq(seen[0].auth, `Basic ${Buffer.from('storyboard:pass').toString('base64')}`, 'authorization')
    },
    { SB_BILLING_AUTH: 'storyboard:pass' },
  )
})

await checkAsync('上游不可达返回 502 remote-unreachable', async () => {
  const dead = http.createServer()
  await new Promise((r) => dead.listen(0, '127.0.0.1', r))
  const deadPort = dead.address().port
  await new Promise((r) => dead.close(r))

  const local = http.createServer((req, res) => {
    void proxyRemoteBilling(req, res, req.url || '/')
  })
  await new Promise((r) => local.listen(0, '127.0.0.1', r))
  const localPort = local.address().port
  try {
    await withEnv({ SB_BILLING_BASE: `http://127.0.0.1:${deadPort}` }, async () => {
      const r = await fetch(`http://127.0.0.1:${localPort}/api/auth/me`)
      const j = await r.json()
      eq(r.status, 502, 'status')
      eq(j.kind, 'remote-unreachable', 'kind')
      eq(j.ok, false, 'ok')
    })
  } finally {
    await new Promise((r) => local.close(r))
  }
})

// ---- 5. 媒体回源：第一次从线上拉，之后走本地文件 ----
async function withMediaServers(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-media-'))
  const hits = []
  const upstream = http.createServer((req, res) => {
    hits.push(req.url)
    if (req.url === '/generated/missing.jpg') {
      res.statusCode = 404
      res.end('not found')
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/jpeg')
    res.end(Buffer.from('JPEGDATA'))
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const local = http.createServer(async (req, res) => {
    const handled = await proxyRemoteMedia(req, res, req.url || '/', tmp)
    if (handled) return
    // 模拟 app.ts 的本地静态处理器：文件已回源就直接读盘
    const file = path.join(tmp, decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, ''))
    if (!fs.existsSync(file)) {
      res.statusCode = 404
      res.end('local missing')
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/jpeg')
    res.end(fs.readFileSync(file))
  })
  await new Promise((r) => local.listen(0, '127.0.0.1', r))
  try {
    await withEnv(
      {
        SB_BILLING_BASE: `http://127.0.0.1:${upstream.address().port}`,
        SB_MEDIA_ROOT: tmp,
        SB_BILLING_AUTH: undefined,
      },
      () => fn({ port: local.address().port, tmp, hits }),
    )
  } finally {
    await new Promise((r) => local.close(r))
    await new Promise((r) => upstream.close(r))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

await checkAsync('首次访问从线上拉回并落盘', async () => {
  await withMediaServers(async ({ port, tmp }) => {
    const r = await fetch(`http://127.0.0.1:${port}/generated/x.jpg`)
    eq(r.status, 200, 'status')
    eq(await r.text(), 'JPEGDATA', 'body')
    eq(fs.existsSync(path.join(tmp, 'generated', 'x.jpg')), true, '本地已落盘')
  })
})

await checkAsync('第二次访问不再打线上', async () => {
  await withMediaServers(async ({ port, hits }) => {
    await (await fetch(`http://127.0.0.1:${port}/generated/y.jpg`)).text()
    await (await fetch(`http://127.0.0.1:${port}/generated/y.jpg`)).text()
    eq(hits.filter((h) => h === '/generated/y.jpg').length, 1, '上游命中次数')
  })
})

await checkAsync('线上 404 时不写盘并返回 404', async () => {
  await withMediaServers(async ({ port, tmp }) => {
    const r = await fetch(`http://127.0.0.1:${port}/generated/missing.jpg`)
    const j = await r.json()
    eq(r.status, 404, 'status')
    eq(j.kind, 'remote-media', 'kind')
    eq(fs.existsSync(path.join(tmp, 'generated', 'missing.jpg')), false, '不应落盘')
  })
})

await checkAsync('并发访问同一个文件只回源一次', async () => {
  await withMediaServers(async ({ port, hits }) => {
    await Promise.all([1, 2, 3].map(() => fetch(`http://127.0.0.1:${port}/generated/z.jpg`).then((r) => r.text())))
    eq(hits.filter((h) => h === '/generated/z.jpg').length, 1, '上游命中次数')
  })
})

await checkAsync('路径越界直接拒绝（不写盘）', async () => {
  await withMediaServers(async ({ port, tmp }) => {
    const r = await fetch(`http://127.0.0.1:${port}/generated/..%2F..%2Fetc%2Fpasswd`)
    eq(r.status, 404, 'status')
    eq(fs.existsSync(path.join(tmp, '..', '..', 'etc', 'passwd')), false, '不应写盘')
  })
})

const failed = cases.filter((c) => !c.ok)
if (failed.length) {
  console.error(`线上账号转发层校验失败：${failed.length}/${cases.length}`)
  process.exit(1)
}
console.log(`线上账号转发层校验通过（${cases.length} 项）`)
