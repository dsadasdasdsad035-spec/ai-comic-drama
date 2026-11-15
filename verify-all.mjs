/**
 * 回归总跑：把 verify-*.mjs 按顺序挨个跑一遍，汇总结果。
 * 顺序执行（共用同一个 dev server 和 project 库，并行会互相踩）。
 *
 * 跑法：node verify-all.mjs [关键字]
 * - 需要现成服务的脚本一律从 `APP_URL` 取地址（见 verify-lib.mjs `requireServer`）。
 * - 未设置 `APP_URL` 时，这里自起一个 dev server 并注入地址，跑完清理；
 *   已设置则直接复用，不自起。
 * - 某个脚本「全部断言都跳过」按异常处理：那是环境缺依赖，不是通过。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'

const filter = process.argv[2] ?? ''
const files = fs
  .readdirSync('.')
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .filter((f) => !f.includes('verify-all'))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort()

/** 拿一个空闲端口：先 bind 0 再释放，紧接着给 vite 用 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })

let server = null
let appUrl = String(process.env.APP_URL || '').trim()

try {
  // 需要现成服务的脚本没有默认端口了，批量入口负责把它们要的地址准备好
  if (!appUrl) {
    const port = await freePort()
    appUrl = `http://127.0.0.1:${port}`
    console.log(`自起 dev server：${appUrl}`)
    server = spawn(
      process.execPath,
      ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'],
      { stdio: 'ignore' },
    )
    const up = await (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const r = await fetch(`${appUrl}/api/health`, { signal: AbortSignal.timeout(800) })
          if (r.ok) return true
        } catch {
          /* 等下一轮 */
        }
        await new Promise((r) => setTimeout(r, 300))
      }
      return false
    })()
    if (!up) {
      console.error(`自起 dev server 失败：${appUrl} 一直不可用`)
      process.exit(1)
    }
  } else {
    console.log(`复用已有服务：${appUrl}`)
  }

  const runOne = (f) =>
    new Promise((resolve) => {
      const t0 = Date.now()
      const cp = spawn(process.execPath, [f], {
        env: { ...process.env, APP_URL: appUrl, NO_PROXY: '*', no_proxy: '*' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let out = ''
      cp.stdout.on('data', (d) => (out += d))
      cp.stderr.on('data', (d) => (out += d))
      const kill = setTimeout(() => cp.kill('SIGTERM'), 180000)
      cp.on('close', (code) => {
        clearTimeout(kill)
        const fails = out
          .split('\n')
          .filter((l) => l.startsWith('❌'))
          .map((l) => l.replace('❌ ', '').trim())
        // 汇总行约定：`汇总：通过 X；失败 Y；跳过 Z`
        const sum = /汇总：通过 (\d+)；失败 (\d+)；跳过 (\d+)/.exec(out)
        const passed = sum ? Number(sum[1]) : 0
        const skipped = sum ? Number(sum[3]) : 0
        const allSkipped = sum ? passed === 0 && skipped > 0 : false
        resolve({ f, code, secs: Math.round((Date.now() - t0) / 1000), fails, passed, skipped, allSkipped })
      })
    })

  const rows = []
  for (const f of files) {
    const r = await runOne(f)
    rows.push(r)
    const skipNote = r.skipped ? ` 跳过 ${r.skipped}` : ''
    const allSkippedNote = r.allSkipped ? ' ⚠️ 全部跳过（不算通过）' : ''
    console.log(
      `${r.code === 0 && !r.allSkipped ? '✅' : '❌'} ${r.f} (${r.secs}s)${skipNote}${allSkippedNote}${r.fails.length ? '\n   ' + r.fails.join('\n   ') : ''}`,
    )
  }
  const bad = rows.filter((r) => r.code !== 0 || r.allSkipped)
  const skippedRows = rows.filter((r) => r.skipped > 0)
  if (skippedRows.length) {
    console.log(`\n有跳过项的脚本：${skippedRows.map((r) => `${r.f}（${r.skipped}）`).join(', ')}`)
  }
  console.log(
    `\n${bad.length ? `❌ ${bad.length}/${rows.length} 个脚本失败：${bad.map((r) => r.f).join(', ')}` : `✅ ${rows.length}/${rows.length} 全部通过`}`,
  )
  process.exitCode = bad.length ? 1 : 0
} finally {
  if (server) {
    server.kill('SIGTERM')
    console.log('已清理自起的 dev server')
  }
}
