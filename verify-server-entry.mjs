/**
 * verify-server-entry.mjs — 独立运行入口
 *
 * 覆盖：端口上报可用、健康检查、未知接口不回退 HTML、SPA 回退、
 *       端口占用非零退出、SIGTERM 优雅退出（退出码 0）。
 * 前置：npm run build:server && npm run build（或 npx vite build）
 * 用法：node verify-server-entry.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ENTRY = path.join(process.cwd(), 'server', 'index.mjs')
const BUNDLE = path.join(process.cwd(), 'server-build', 'app.mjs')
const DIST = path.join(process.cwd(), 'dist', 'index.html')

if (!fs.existsSync(BUNDLE)) {
  console.error('缺少 server-build/app.mjs，先运行 npm run build:server')
  process.exit(1)
}
if (!fs.existsSync(DIST)) {
  console.error('缺少 dist/index.html，先运行 npx vite build')
  process.exit(1)
}

const results = []
function check(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
  } catch (e) {
    results.push({ name, ok: false, message: e.message })
  }
}

/** 启动一个实例，等到握手行；resolve 出 pid / port / 进程句柄 */
function start({ port }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, SB_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`启动超时，stdout=${out.slice(-300)} stderr=${err.slice(-300)}`))
    }, 20_000)
    child.stdout.on('data', (d) => {
      out += String(d)
      const m = out.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
      if (m) {
        clearTimeout(timer)
        resolve({ child, port: Number(m[1]), stdout: () => out, stderr: () => err })
      }
    })
    child.stderr.on('data', (d) => {
      err += String(d)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`进程提前退出 code=${code} stderr=${err.slice(-300)}`))
    })
  })
}

function waitExit(child) {
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)))
}

const a = await start({ port: 0 })

check('系统分配端口：握手端口可访问', () => {
  assert.ok(a.port > 0)
})

const base = `http://127.0.0.1:${a.port}`

const health = await fetch(`${base}/api/health`).then((r) => r.json())
check('健康检查返回成功', () => {
  assert.equal(typeof health, 'object')
  assert.ok(Object.keys(health).length > 0)
})

const api404 = await fetch(`${base}/api/not-exist`)
const api404Type = api404.headers.get('content-type') || ''
const api404Body = await api404.text()
check('未知接口返回 JSON 404，不回退 HTML', () => {
  assert.equal(api404.status, 404)
  assert.match(api404Type, /application\/json/)
  assert.ok(!api404Body.includes('<!doctype html'))
})

const spa = await fetch(`${base}/some/deep/route`)
const spaBody = await spa.text()
check('非接口路径回退入口 HTML', () => {
  assert.equal(spa.status, 200)
  assert.match(spaBody, /<!doctype html/i)
})

const traversal = await fetch(`${base}/%2e%2e/package.json`)
const traversalBody = await traversal.text()
check('路径穿越不回吐仓库文件', () => {
  assert.ok(!traversalBody.includes('"dependencies"'))
})

// 端口占用：同端口再起一个，必须非零退出且提到端口
const b = spawn(process.execPath, [ENTRY], {
  env: { ...process.env, SB_PORT: String(a.port) },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let bErr = ''
b.stderr.on('data', (d) => {
  bErr += String(d)
})
const bCode = await waitExit(b)
check('端口被占用：非零退出且提示端口', () => {
  assert.notEqual(bCode, 0)
  assert.ok(bErr.includes(String(a.port)), `stderr=${bErr.slice(-200)}`)
})

// 优雅退出
a.child.kill('SIGTERM')
const aCode = await waitExit(a.child)
check('SIGTERM 优雅退出（退出码 0）', () => {
  assert.equal(aCode, 0)
})

let failed = 0
for (const r of results) {
  if (r.ok) console.log(`  ok   ${r.name}`)
  else {
    failed++
    console.log(`  FAIL ${r.name}\n       ${r.message}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
