/**
 * 3D Agent full_host：隔离 job 目录内的 shell 与文件工具。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const JOBS_DIR = '.agent-jobs'
const MAX_IO_CHARS = 64 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_WRITE_BYTES = 512 * 1024
const SHELL_CONCURRENCY = Math.max(1, Number(process.env.AGENT_SHELL_CONCURRENCY) || 1)

/** @type {Map<string, object>} */
const jobs = new Map()
let shellRunning = 0

function truncate(text, max = MAX_IO_CHARS) {
  const s = String(text ?? '')
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…（已截断，共 ${s.length} 字符）`
}

function jobsRoot(root) {
  const dir = path.join(root, JOBS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function resolveInJob(jobDir, relPath) {
  const base = path.resolve(jobDir)
  const target = path.resolve(base, relPath || '.')
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径必须在 agent job 目录内')
  }
  return target
}

function getJob(jobId) {
  const job = jobs.get(jobId)
  if (!job) throw new Error('agent job 不存在或已过期')
  return job
}

export function ensureAgentJob(root, { project, shotId }) {
  const projectName = String(project || '').trim()
  const sid = String(shotId || '').trim()
  if (!projectName || !sid) throw new Error('缺少 project 或 shotId')
  const id = crypto.randomUUID()
  const dir = path.join(jobsRoot(root), id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.meta.json'),
    JSON.stringify({ project: projectName, shotId: sid, createdAt: Date.now() }, null, 0),
  )
  const job = {
    id,
    project: projectName,
    shotId: sid,
    dir,
    status: 'idle',
    proc: null,
    lastCommand: '',
  }
  jobs.set(id, job)
  return { ok: true, jobId: id, dir: JOBS_DIR + '/' + id }
}

function runShellOnce(job, command, cwdRel, timeoutMs) {
  return new Promise((resolve, reject) => {
    shellRunning++
    job.status = 'running'
    job.lastCommand = command.slice(0, 500)
    const cwd = resolveInJob(job.dir, cwdRel || '.')
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let killed = false
    const proc = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, AGENT_JOB_ID: job.id },
    })
    job.proc = proc
    const timer = setTimeout(() => {
      killed = true
      try {
        proc.kill('SIGTERM')
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    proc.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      job.status = 'idle'
      job.proc = null
      shellRunning--
      reject(err)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      job.status = 'idle'
      job.proc = null
      shellRunning--
      const exitCode = killed ? 124 : code ?? 1
      resolve({
        ok: true,
        exitCode,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        durationMs: Date.now() - started,
        timedOut: killed,
        command: command.slice(0, 200),
      })
    })
  })
}

export async function agentShell(root, body) {
  void root
  const job = getJob(String(body.jobId || ''))
  const command = String(body.command || '').trim()
  if (!command) throw new Error('command 不能为空')
  if (job.status === 'running') throw new Error('该 job 已有命令在执行')
  if (shellRunning >= SHELL_CONCURRENCY) throw new Error('宿主命令繁忙，请稍后重试')
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1000, Number(body.timeout_ms ?? body.timeoutMs) || DEFAULT_TIMEOUT_MS),
  )
  return runShellOnce(job, command, String(body.cwd || '.'), timeoutMs)
}

export function agentReadFile(root, body) {
  void root
  const job = getJob(String(body.jobId || ''))
  const rel = String(body.path || '')
  if (!rel) throw new Error('path 不能为空')
  const full = resolveInJob(job.dir, rel)
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('文件不存在')
  const content = fs.readFileSync(full, 'utf8')
  return { ok: true, path: rel, content: truncate(content, MAX_IO_CHARS) }
}

export function agentWriteFile(root, body) {
  void root
  const job = getJob(String(body.jobId || ''))
  const rel = String(body.path || '')
  if (!rel) throw new Error('path 不能为空')
  const content = String(body.content ?? '')
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    throw new Error(`单次写入不得超过 ${MAX_WRITE_BYTES} 字节`)
  }
  const full = resolveInJob(job.dir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf8')
  return { ok: true, path: rel, bytes: Buffer.byteLength(content, 'utf8') }
}

export function agentListDir(root, body) {
  void root
  const job = getJob(String(body.jobId || ''))
  const rel = String(body.path || '.')
  const full = resolveInJob(job.dir, rel)
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new Error('目录不存在')
  const names = fs.readdirSync(full).slice(0, 500)
  return { ok: true, path: rel, entries: names }
}

export function cancelAgentJob(jobId) {
  const job = getJob(jobId)
  if (job.proc) {
    try {
      job.proc.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  return { ok: true, jobId }
}
