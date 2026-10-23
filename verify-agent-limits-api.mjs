/**
 * Agent 运行上限服务端设置 round-trip（自起临时 dev server，不碰当前项目/设置库）。
 * 跑法：node verify-agent-limits-api.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5312
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-limits-api-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  return r.json()
}
const put = (agentLimits) =>
  api('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentLimits }),
  })

let ok = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) { ok = true; break }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!ok) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

try {
  const s0 = (await api('/api/settings')).settings
  check('旧设置补默认值', s0.agentLimits?.maxSteps === 24 && s0.agentLimits?.totalSeconds === 300, JSON.stringify(s0.agentLimits))
  const originalModels = JSON.stringify(s0.models)
  const originalRules = JSON.stringify(s0.rules)

  const saved = await put({ maxSteps: 48, totalSeconds: 600 })
  check('保存新值返回规范化结果', saved.settings?.agentLimits?.maxSteps === 48 && saved.settings?.agentLimits?.totalSeconds === 600, JSON.stringify(saved.settings?.agentLimits))
  const s1 = (await api('/api/settings')).settings
  check('重新读取保留新值', s1.agentLimits?.maxSteps === 48 && s1.agentLimits?.totalSeconds === 600, JSON.stringify(s1.agentLimits))
  check('保存不丢模型和规则', JSON.stringify(s1.models) === originalModels && JSON.stringify(s1.rules) === originalRules)

  await put({ maxSteps: 0, totalSeconds: 9999 })
  const s2 = (await api('/api/settings')).settings
  check('服务端夹取越界值', s2.agentLimits?.maxSteps === 12 && s2.agentLimits?.totalSeconds === 1800, JSON.stringify(s2.agentLimits))

  await put({ maxSteps: '', totalSeconds: 'abc' })
  const s3 = (await api('/api/settings')).settings
  check('服务端空值回退默认', s3.agentLimits?.maxSteps === 24 && s3.agentLimits?.totalSeconds === 300, JSON.stringify(s3.agentLimits))
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
