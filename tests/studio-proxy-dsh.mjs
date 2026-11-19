/**
 * `/studio/` 反代 + 真实宿主的集成测试。
 *
 * 与 studio-proxy.mjs 的分工：那个用假上游把改写规则钉死，这个用真实 dsh 证明
 * 「壳页面真能打开、子路径资源真能取到、令牌真没漏给浏览器」。
 * 依赖本机已安装 `@deepseek-ai/dsh`；未安装时跳过。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createCreativeHost, isDshInstalled } from '../server/creative-host.mjs'
import { createStudioProxy } from '../server/studio-proxy.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')

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

if (!isDshInstalled(ROOT)) {
  console.log('⚠️  跳过真实宿主集成测试：未安装 @deepseek-ai/dsh')
  process.exit(0)
}

const dshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-studio-'))
const host = createCreativeHost({
  root: ROOT,
  dshHome,
  publicUrl: 'http://127.0.0.1:5273/studio/',
  trustedHosts: ['127.0.0.1:5273'],
  readyTimeoutMs: 90_000,
  log: () => {},
})

const proxy = createStudioProxy({
  host,
  authorize: async () => ({ ok: true, publicBase: 'http://127.0.0.1:5273/studio' }),
  ensureStarted: () => host.start(),
  log: () => {},
})

const server = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    proxy.handle(req, res).catch((e) => {
      res.statusCode = 500
      res.end(String(e?.message || e))
    })
  })
  s.on('upgrade', (req, socket, head) => {
    if (!proxy.upgrade(req, socket, head)) socket.destroy()
  })
  s.listen(0, '127.0.0.1', () => resolve(s))
})
const base = `http://127.0.0.1:${server.address().port}`
let cookie = ''
let shellHtml = ''

await check('首次访问完成令牌换取并落到壳页面', async () => {
  const first = await fetch(`${base}/studio/`, { redirect: 'manual' })
  assert.equal(first.status, 303, `期望 303，实际 ${first.status}`)
  const setCookie = first.headers.getSetCookie().join('; ')
  assert.match(setCookie, /Path=\/studio/)
  assert.equal(first.headers.get('location'), '/studio/')
  cookie = first.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

  const second = await fetch(`${base}/studio/`, { redirect: 'manual', headers: { cookie } })
  assert.equal(second.status, 200, `期望 200，实际 ${second.status}`)
  shellHtml = await second.text()
  assert.ok(shellHtml.length > 5_000, `壳页面太小：${shellHtml.length}`)
  assert.match(shellHtml, /__DSH_BOOT__|__ModuleLoader__/)
})

await check('壳页面与地址中不含引导令牌明文', async () => {
  const token = host.upstream()?.token || ''
  assert.ok(token.length > 8)
  assert.equal(shellHtml.includes(token), false, '壳页面里出现了引导令牌')
})

await check('子路径脚本与样式资源可访问', async () => {
  const refs = [...shellHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const assets = refs.filter((u) => /\.(js|mjs|css)(\?|$)/.test(u)).slice(0, 6)
  assert.ok(assets.length > 0, `壳页面里没有找到脚本/样式引用：${refs.slice(0, 5).join(', ')}`)
  for (const ref of assets) {
    const url = new URL(ref, `${base}/studio/`)
    const res = await fetch(url, { headers: { cookie }, redirect: 'manual' })
    assert.equal(res.status, 200, `${ref} 返回 ${res.status}`)
    const body = await res.text()
    assert.ok(body.length > 0, `${ref} 内容为空`)
  }
})

await check('未知子路径不会击穿到应用静态层', async () => {
  const res = await fetch(`${base}/studio/__definitely_missing__`, { headers: { cookie }, redirect: 'manual' })
  assert.ok(res.status === 404 || res.status === 200, `意外状态 ${res.status}`)
  const body = await res.text()
  assert.equal(body.includes('未找到前端产物'), false, '落到了应用的静态层')
})

await check('宿主被停掉后再次访问会自动重新拉起', async () => {
  await host.stop()
  assert.equal(host.status().state, 'stopped')
  const res = await fetch(`${base}/studio/`, { redirect: 'manual' })
  // 反代会重新拉起宿主并把令牌注入翻译成 303；这里只断言「不再返回 503」
  assert.equal(res.status, 303, `期望重新拉起后拿到 303，实际 ${res.status}`)
  assert.equal(host.status().state, 'ready')
})

server.close()
await host.stop()
console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ `/studio/` + 真实宿主集成通过')
process.exit(bad ? 1 : 0)
