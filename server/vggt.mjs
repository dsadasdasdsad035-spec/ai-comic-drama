/**
 * 参考片几何分析（VGGT POC）：异步作业，不写 project 调度字段。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { probeMedia, extractFrame, MAX_FRAMES_PER_REQUEST } from './video-analyze.mjs'
import { resolveCreativeFile } from './creative.mjs'
import { parseProjectMediaUrl, resolveProjectMediaPath } from './media.mjs'
import { mediaPathFromUrl } from './paths.mjs'

const JOBS_DIR = '.vggt-jobs'
const TTL_DAYS = Math.max(1, Number(process.env.VGGT_JOB_TTL_DAYS) || 7)
const TTL_MS = TTL_DAYS * 86_400_000

/** @type {Map<string, object>} */
const jobs = new Map()

function jobsRoot(appRoot) {
  const dir = path.join(appRoot, JOBS_DIR)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function jobDir(appRoot, id) {
  return path.join(jobsRoot(appRoot), id)
}

function workerConfigured() {
  const url = String(process.env.VGGT_WORKER_URL || '').trim()
  if (url) return true
  return String(process.env.VGGT_MOCK_WORKER || '') === '1'
}

function workerBaseUrl() {
  const url = String(process.env.VGGT_WORKER_URL || '').trim()
  if (url) return url.replace(/\/$/, '')
  if (String(process.env.VGGT_MOCK_WORKER || '') === '1') {
    return `http://127.0.0.1:${Number(process.env.VGGT_MOCK_PORT) || 8765}`
  }
  return null
}

/** 站内视频路径 → 本机绝对路径 */
export function resolveLocalVideoRef(appRoot, ref) {
  const raw = String(ref || '').split('?')[0].trim()
  if (!raw || /^https?:\/\//i.test(raw)) throw new Error('只支持本站视频路径')
  if (raw.startsWith('/creative/')) return resolveCreativeFile(appRoot, raw)
  if (raw.startsWith('/videos/') || raw.startsWith('/generated/')) {
    const full = mediaPathFromUrl(appRoot, raw)
    if (!fs.existsSync(full)) throw new Error('视频文件不存在')
    return full
  }
  const parsed = parseProjectMediaUrl(raw)
  if (parsed) return resolveProjectMediaPath(appRoot, parsed.name, parsed.file)
  throw new Error(`无法解析视频地址：${raw.slice(0, 120)}`)
}

const JOB_ID_RE = /^[a-f0-9]{16}$/

function assertJobId(id) {
  const s = String(id || '')
  if (!JOB_ID_RE.test(s)) throw new Error('非法的作业 id')
  return s
}

function fingerprintFile(file) {
  const h = crypto.createHash('sha256')
  const st = fs.statSync(file)
  h.update(String(st.size))
  h.update(String(st.mtimeMs))
  h.update(path.basename(file))
  return `sha256:${h.digest('hex').slice(0, 32)}`
}

async function extractUniformFrames(file, outDir, maxFrames) {
  const info = await probeMedia(file)
  const total = Math.max(0.05, Number(info.duration || 0))
  const n = Math.min(MAX_FRAMES_PER_REQUEST, Math.max(1, Number(maxFrames) || 24))
  fs.mkdirSync(outDir, { recursive: true })
  const frames = []
  for (let i = 0; i < n; i++) {
    const at = n === 1 ? 0 : (i / (n - 1)) * Math.max(0, total - 0.05)
    const name = `frame-${String(i).padStart(4, '0')}.jpg`
    const out = path.join(outDir, name)
    const got = await extractFrame(file, at, out)
    frames.push({ index: i, at: got.at, file: out })
  }
  return {
    probe: {
      duration: info.duration,
      width: info.width,
      height: info.height,
      fps: info.fps,
    },
    frames,
    frameCount: frames.length,
  }
}

async function callWorker(payload) {
  const base = workerBaseUrl()
  if (!base) throw new Error('VGGT Worker 未配置')
  const token = String(process.env.VGGT_WORKER_TOKEN || '').trim()
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${base}/v1/infer`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let j
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error(`Worker 返回非 JSON（${res.status}）`)
  }
  if (!res.ok || !j?.ok || !j?.report) {
    throw new Error(j?.message || `Worker 失败（${res.status}）`)
  }
  return j.report
}

function validateReportShape(report) {
  if (report?.version !== 1) throw new Error('报告 version 无效')
  if (!Array.isArray(report.keyframes) || !report.keyframes.length) throw new Error('报告 keyframes 为空')
  if (!['high', 'medium', 'low'].includes(report.confidence)) throw new Error('报告 confidence 无效')
  if (!String(report.motionSummaryZh || '').trim()) throw new Error('报告缺少 motionSummaryZh')
}

function writeJobState(dir, state) {
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(state, null, 2))
}

function readJobState(dir) {
  const p = path.join(dir, 'status.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

async function runJob(appRoot, id) {
  const dir = jobDir(appRoot, id)
  const mem = jobs.get(id)
  if (!mem || mem.cancelled) return
  try {
    writeJobState(dir, { ...mem, status: 'running', updatedAt: new Date().toISOString() })
    const videoFile = mem.videoFile
    const framesDir = path.join(dir, 'frames')
    const sampled = await extractUniformFrames(videoFile, framesDir, mem.maxFrames)
    if (jobs.get(id)?.cancelled) {
      writeJobState(dir, { ...jobs.get(id), status: 'cancelled', updatedAt: new Date().toISOString() })
      return
    }
    const payload = {
      framesDir,
      probe: sampled.probe,
      projectAspect: mem.projectAspect,
      effectiveSeconds: mem.effectiveSeconds,
      frameCount: sampled.frameCount,
    }
    const report = await callWorker(payload)
    if (!report.sourceFingerprint) report.sourceFingerprint = mem.sourceFingerprint
    validateReportShape(report)
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
    const done = {
      ...mem,
      status: 'completed',
      reportPath: path.join(dir, 'report.json'),
      updatedAt: new Date().toISOString(),
      sampleCount: sampled.frameCount,
    }
    jobs.set(id, done)
    writeJobState(dir, done)
    try {
      fs.rmSync(framesDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  } catch (e) {
    const failed = {
      ...mem,
      status: 'failed',
      error: e?.message || String(e),
      updatedAt: new Date().toISOString(),
    }
    jobs.set(id, failed)
    writeJobState(dir, failed)
  }
}

export function isVggtAvailable() {
  return workerConfigured()
}

export function submitVggtAnalyze(appRoot, body) {
  if (!workerConfigured()) {
    const err = new Error(
      'VGGT Worker 未配置。请设置 VGGT_WORKER_URL，或本地运行 node workers/vggt/mock-server.mjs 并设置 VGGT_WORKER_URL=http://127.0.0.1:8765；开发也可设 VGGT_MOCK_WORKER=1。',
    )
    err.code = 'VGGT_NO_WORKER'
    throw err
  }
  const sourceKind = String(body?.sourceKind || 'reference')
  const videoRef = String(body?.videoRef || '').trim()
  if (!videoRef) throw new Error('缺少 videoRef')
  const videoFile = resolveLocalVideoRef(appRoot, videoRef)
  const id = crypto.randomBytes(8).toString('hex')
  const dir = jobDir(appRoot, id)
  fs.mkdirSync(dir, { recursive: true })
  const state = {
    id,
    status: 'pending',
    sourceKind,
    videoRef,
    videoFile,
    sourceFingerprint: fingerprintFile(videoFile),
    projectAspect: String(body?.projectAspect || '16:9'),
    effectiveSeconds: Math.min(12, Math.max(2, Math.round(Number(body?.effectiveSeconds) || 6))),
    maxFrames: Math.min(MAX_FRAMES_PER_REQUEST, Math.max(4, Number(body?.maxFrames) || 24)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  jobs.set(id, state)
  writeJobState(dir, state)
  void runJob(appRoot, id)
  const { videoFile: _vf, ...pub } = state
  return { ...pub }
}

export function getVggtJob(appRoot, id) {
  const safeId = assertJobId(id)
  const dir = jobDir(appRoot, safeId)
  let state = jobs.get(safeId) || readJobState(dir)
  if (!state) return null
  if (state.status === 'completed' && fs.existsSync(path.join(dir, 'report.json'))) {
    try {
      state = { ...state, report: JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')) }
    } catch {
      /* ignore */
    }
  }
  const { videoFile: _v, ...pub } = state
  return pub
}

export function cancelVggtJob(appRoot, id) {
  const safeId = assertJobId(id)
  const state = jobs.get(safeId) || readJobState(jobDir(appRoot, safeId))
  if (!state) throw new Error('作业不存在或已过期')
  if (state.status === 'completed' || state.status === 'failed') {
    const { videoFile: _v, ...pub } = state
    return pub
  }
  const next = { ...state, cancelled: true, status: 'cancelled', updatedAt: new Date().toISOString() }
  jobs.set(safeId, next)
  writeJobState(jobDir(appRoot, safeId), next)
  const { videoFile: _v, ...pub } = next
  return pub
}

/** 启动时清理超期作业目录 */
export function cleanupVggtJobs(appRoot) {
  const root = jobsRoot(appRoot)
  if (!fs.existsSync(root)) return
  const now = Date.now()
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name)
    try {
      const st = fs.statSync(dir)
      if (now - st.mtimeMs > TTL_MS) fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
