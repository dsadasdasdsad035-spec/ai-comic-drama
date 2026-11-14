/**
 * 素材 / 平台链接摄取冒烟（离线为主，约 1–2 分钟）。
 *
 * 覆盖：口令提取、shot-3d 摄取（含 bytes）、素材 API、DTK 桩全流程 UI。
 *
 * 跑法：
 *   node verify-ingest-smoke.mjs
 *   node verify-ingest-smoke.mjs --quick   # 跳过 Playwright 全流程
 */
import { spawn } from 'node:child_process'
import path from 'node:path'

const ROOT = process.cwd()
const quick = process.argv.includes('--quick')

const STEPS = [
  { name: '口令 URL 提取', cmd: 'npx', args: ['tsx', 'tests/ingest-url.ts'] },
  { name: 'shot-3d 参考摄取', cmd: 'node', args: ['verify-shot-3d-reference-ingest.mjs'] },
  { name: '创意摄取适配器', cmd: 'node', args: ['verify-creative-ingest.mjs'] },
  { name: '素材页摄取 API', cmd: 'node', args: ['verify-asset-platform-ingest.mjs'] },
  ...(quick
    ? []
    : [{ name: '链接口令 UI+DTK 桩', cmd: 'node', args: ['verify-asset-video-link-flow.mjs'] }]),
]

const run = (step) =>
  new Promise((resolve) => {
    const t0 = Date.now()
    const cp = spawn(step.cmd, step.args, {
      cwd: ROOT,
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    let out = ''
    cp.stdout.on('data', (d) => (out += d))
    cp.stderr.on('data', (d) => (out += d))
    const kill = setTimeout(() => cp.kill('SIGTERM'), 300_000)
    cp.on('close', (code) => {
      clearTimeout(kill)
      const fails = out.split('\n').filter((l) => l.startsWith('❌'))
      resolve({ ...step, code: code ?? 1, secs: Math.round((Date.now() - t0) / 1000), fails, out })
    })
  })

console.log('=== 素材摄取冒烟 ===\n')
let bad = 0
for (const step of STEPS) {
  const r = await run(step)
  const ok = r.code === 0
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${r.name} (${r.secs}s) — ${path.basename(r.args.at(-1) || '')}`)
  if (r.fails.length) {
    for (const line of r.fails.slice(0, 8)) console.log(`   ${line}`)
  } else if (!ok) {
    console.log(`   退出码 ${r.code}`)
    console.log(r.out.split('\n').slice(-6).join('\n   '))
  }
}

console.log(bad ? `\n❌ 摄取冒烟：${bad}/${STEPS.length} 步失败` : `\n✅ 摄取冒烟：${STEPS.length}/${STEPS.length} 全部通过`)
process.exit(bad ? 1 : 0)