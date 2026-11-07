/**
 * agent job 沙箱：路径隔离、读写、列表（不执行真实 shell）。
 * 跑法：node verify-agent-shell.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(repoRoot, '.verify-agent-shell-' + Date.now())
fs.mkdirSync(root, { recursive: true })

const lib = await import('./server/agentHost.mjs')

let bad = 0
const check = (n, c, e = '') => {
  console.log(`${c ? '✅' : '❌'} ${n}${e ? ' | ' + e : ''}`)
  if (!c) bad++
}

const { jobId } = lib.ensureAgentJob(repoRoot, { project: 'P', shotId: 'E01-S01' })
check('创建 job', Boolean(jobId), jobId)

const jobDir = path.join(repoRoot, '.agent-jobs', jobId)
const skillIndex = path.join(jobDir, 'dcc-skills', 'INDEX.zh-CN.md')
check('job 挂载 dcc-skills', fs.existsSync(skillIndex), skillIndex)
const previs = path.join(jobDir, 'dcc-previs-pack.md')
check('job 挂载 dcc-previs-pack', fs.existsSync(previs))

lib.agentWriteFile(root, { jobId, path: 'notes.txt', content: 'hello agent' })
const read = lib.agentReadFile(root, { jobId, path: 'notes.txt' })
check('读取文件', read.content === 'hello agent', read.content)

const listed = lib.agentListDir(root, { jobId, path: '.' })
check('列出目录', listed.entries.includes('notes.txt'), listed.entries.join(','))

let escaped = false
try {
  lib.agentReadFile(root, { jobId, path: '../../../etc/passwd' })
} catch (e) {
  escaped = true
}
check('拒绝路径逃逸', escaped)

try {
  fs.rmSync(path.join(repoRoot, '.agent-jobs', jobId), { recursive: true, force: true })
} catch {
  /* ignore */
}
fs.rmSync(root, { recursive: true, force: true })
process.exit(bad ? 1 : 0)
