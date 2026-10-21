/**
 * 回归总跑：把 verify-*.mjs 按顺序挨个跑一遍，汇总结果。
 * 顺序执行（共用同一个 dev server 和 project 库，并行会互相踩）。
 * 跑法：node verify-all.mjs [关键字]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const filter = process.argv[2] ?? ''
const files = fs
  .readdirSync('.')
  .filter((f) => /^verify-.*\.mjs$/.test(f))
  .filter((f) => !f.includes('verify-all'))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort()

const runOne = (f) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const cp = spawn(process.execPath, [f], {
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
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
      resolve({ f, code, secs: Math.round((Date.now() - t0) / 1000), fails })
    })
  })

const rows = []
for (const f of files) {
  const r = await runOne(f)
  rows.push(r)
  console.log(`${r.code === 0 ? '✅' : '❌'} ${r.f} (${r.secs}s)${r.fails.length ? '\n   ' + r.fails.join('\n   ') : ''}`)
}
const bad = rows.filter((r) => r.code !== 0)
console.log(`\n${bad.length ? `❌ ${bad.length}/${rows.length} 个脚本失败：${bad.map((r) => r.f).join(', ')}` : `✅ ${rows.length}/${rows.length} 全部通过`}`)
process.exit(bad.length ? 1 : 0)
