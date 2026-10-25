/**
 * 本机 Blender 渲染宿主。
 *
 * 设计要点（见 openspec/changes/replace-three-with-blender/design.md）：
 * - 每次渲染是一个一次性作业：独立目录、独立进程、独立输出。
 * - 宿主拥有渲染设置与输出路径；场景代码只拿到 build/pose/dispose。
 * - 失败、取消、超时都不产出半成品，也不覆盖上一版视频。
 * - 帧序列先落盘再编码，保证帧精确；不再走浏览器录制与 base64 回传。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { parseProjectMediaUrl, resolveProjectMediaPath } from './media.mjs'

const JOBS_DIR = '.blender-jobs'
const HOST_SCRIPT = path.join('scripts', 'blender', 'host.py')
const SENTINEL = 'ZCODE_JOB '
const INSTALL_HINT =
  '未找到 Blender。请安装受支持的版本（brew install --cask blender），或在设置中用 BLENDER_BIN 指定可执行文件路径。'

const MIN_VERSION = process.env.BLENDER_MIN_VERSION || '4.2'
const MAX_VERSION = process.env.BLENDER_MAX_VERSION || '6.0'
const CONCURRENCY = Math.max(1, Number(process.env.BLENDER_CONCURRENCY) || 2)

/** 档位默认值；1.2 实测后会通过环境变量覆盖。 */
export const BLENDER_DEFAULTS = {
  engine: process.env.BLENDER_ENGINE || 'eevee',
  trialFps: 30,
  proxyFps: Math.max(4, Math.min(30, Number(process.env.BLENDER_PROXY_FPS) || 15)),
  finalFps: 30,
  trialSamples: Math.max(1, Number(process.env.BLENDER_TRIAL_SAMPLES) || 8),
  proxySamples: Math.max(1, Number(process.env.BLENDER_PROXY_SAMPLES) || 16),
  finalSamples: Math.max(1, Number(process.env.BLENDER_FINAL_SAMPLES) || 32),
  proxyShortEdge: Math.max(160, Number(process.env.BLENDER_PROXY_EDGE) || 540),
  trialShortEdge: Math.max(120, Number(process.env.BLENDER_TRIAL_EDGE) || 320),
}

const TIER_LIMITS = {
  trial: { timeoutMs: 60_000, stallMs: 25_000 },
  proxy: { timeoutMs: 240_000, stallMs: 60_000 },
  final: { timeoutMs: 900_000, stallMs: 120_000 },
}
/** 单作业产物体积上限；超限删除并失败，避免磁盘被单次渲染占满。 */
const MAX_OUTPUT_BYTES = Math.max(
  16 * 1024 * 1024,
  Number(process.env.BLENDER_MAX_OUTPUT_MB || 512) * 1024 * 1024,
)

const jobs = new Map()
const queue = []
let running = 0
let healthCache = null

// ---------------------------------------------------------------- 可执行文件

function blenderCandidates() {
  const list = []
  if (process.env.BLENDER_BIN) list.push(process.env.BLENDER_BIN)
  list.push(
    '/Applications/Blender.app/Contents/MacOS/Blender',
    path.join(process.env.HOME || '', 'Applications/Blender.app/Contents/MacOS/Blender'),
    '/usr/local/bin/blender',
    '/opt/homebrew/bin/blender',
  )
  return list.filter(Boolean)
}

export function resolveBlenderBin() {
  for (const candidate of blenderCandidates()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* ignore */
    }
  }
  const fromPath = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((dir) => path.join(dir, 'blender'))
    .find((p) => {
      try {
        return fs.existsSync(p)
      } catch {
        return false
      }
    })
  return fromPath || null
}

function probeVersion(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 20_000 }, (err, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`
      const m = text.match(/Blender\s+([0-9]+(?:\.[0-9]+){1,2})/i)
      resolve(m ? m[1] : err ? null : 'unknown')
    })
  })
}

function parts(v) {
  return String(v || '')
    .split('.')
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
}

/** 只比较 bound 给出的位数，避免 "6.0" 拒绝 6.0.1。 */
function withinRange(version, min, max) {
  const v = parts(version)
  if (!v.length) return false
  const cmp = (bound) => {
    const b = parts(bound)
    for (let i = 0; i < b.length; i++) {
      if ((v[i] || 0) < b[i]) return -1
      if ((v[i] || 0) > b[i]) return 1
    }
    return 0
  }
  return cmp(min) >= 0 && cmp(max) <= 0
}

export async function blenderHealth({ refresh = false } = {}) {
  if (!refresh && healthCache && Date.now() - healthCache.at < 60_000) return healthCache.value
  const bin = resolveBlenderBin()
  let value
  if (!bin) {
    value = { ok: false, path: null, version: null, min: MIN_VERSION, max: MAX_VERSION, reason: 'not-installed', message: INSTALL_HINT, defaults: BLENDER_DEFAULTS }
  } else {
    const version = await probeVersion(bin)
    if (!version || version === 'unknown') {
      value = { ok: false, path: bin, version, min: MIN_VERSION, max: MAX_VERSION, reason: 'unreadable', message: `无法读取 Blender 版本：${bin}`, defaults: BLENDER_DEFAULTS }
    } else if (!withinRange(version, MIN_VERSION, MAX_VERSION)) {
      value = { ok: false, path: bin, version, min: MIN_VERSION, max: MAX_VERSION, reason: 'unsupported-version', message: `Blender ${version} 不在支持范围 ${MIN_VERSION}–${MAX_VERSION} 内，请安装受支持的版本`, defaults: BLENDER_DEFAULTS }
    } else {
      value = { ok: true, path: bin, version, min: MIN_VERSION, max: MAX_VERSION, reason: null, message: '', defaults: BLENDER_DEFAULTS }
    }
  }
  healthCache = { at: Date.now(), value }
  return value
}

// ---------------------------------------------------------------- 路径与素材

function publicDir(appRoot) {
  return path.join(appRoot, 'public')
}

function insideDir(dir, file) {
  const rel = path.relative(dir, file)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** 站内 URL → 本地文件；拒绝网络、dataURL 与越界路径。 */
export function resolveAssetFile(appRoot, url) {
  const raw = String(url || '').split('?')[0]
  if (!raw) throw new Error('素材地址为空')
  if (/^(https?:|data:|blob:)/i.test(raw)) throw new Error(`素材必须是项目内文件：${raw.slice(0, 80)}`)
  const pm = parseProjectMediaUrl(raw)
  const file = pm
    ? resolveProjectMediaPath(appRoot, pm.name, pm.file)
    : path.join(publicDir(appRoot), raw.replace(/^\//, ''))
  if (!pm && !insideDir(publicDir(appRoot), file)) throw new Error(`素材路径越界：${raw}`)
  if (!fs.existsSync(file)) throw new Error(`素材文件不存在：${raw}`)
  return file
}

function safeKey(key, index) {
  const base = String(key || `asset-${index}`)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || `asset-${index}`
}

const MAX_ASSET_EDGE = 2048
const MAX_IMAGES = 16
const MAX_VIDEOS = 4
const MAX_TOTAL_ASSET_BYTES = 48 * 1024 * 1024

function resolveFfprobe() {
  const ff = resolveFfmpeg()
  const probe = ff.replace(/ffmpeg$/, 'ffprobe')
  try {
    if (fs.existsSync(probe)) return probe
  } catch {
    /* ignore */
  }
  return 'ffprobe'
}

async function imageSize(file) {
  try {
    const { stdout } = await run(resolveFfprobe(), [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      file,
    ])
    const stream = JSON.parse(stdout)?.streams?.[0]
    return stream ? { width: Number(stream.width) || 0, height: Number(stream.height) || 0 } : null
  } catch {
    return null
  }
}

async function materializeAssets(appRoot, dir, assets) {
  const out = []
  const missing = []
  const list = Array.isArray(assets) ? assets : []
  const images = list.filter((a) => a?.kind !== 'video-frame')
  const videoIds = new Set(list.filter((a) => a?.kind === 'video-frame').map((a) => a?.videoUrl || a?.url))
  if (images.length > MAX_IMAGES) throw new Error(`最多选择 ${MAX_IMAGES} 张图片`)
  if (videoIds.size > MAX_VIDEOS) throw new Error(`最多选择 ${MAX_VIDEOS} 个视频`)

  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  let totalBytes = 0
  for (const [i, asset] of list.entries()) {
    const key = String(asset?.key || `asset-${i}`)
    try {
      const src = resolveAssetFile(appRoot, asset?.url)
      totalBytes += fs.statSync(src).size
      if (totalBytes > MAX_TOTAL_ASSET_BYTES) {
        throw new Error(`素材总大小超过 ${Math.round(MAX_TOTAL_ASSET_BYTES / 1024 / 1024)}MB`)
      }
      const ext = (path.extname(src).slice(1) || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
      const name = `${safeKey(key, i)}-${crypto.randomBytes(3).toString('hex')}.${ext}`
      const dst = path.join(dir, 'assets', name)
      fs.copyFileSync(src, dst)

      // 尺寸上限在落盘时执行：超过 2048px 的图片缩放到 2048 短边，避免 Blender 吃大图。
      let size = null
      if (asset?.kind !== 'video-frame') {
        size = await imageSize(dst)
        if (size && Math.max(size.width, size.height) > MAX_ASSET_EDGE) {
          const tmp = `${dst}.scaled.${ext}`
          await run(resolveFfmpeg(), [
            '-y', '-i', dst,
            '-vf', `scale='min(${MAX_ASSET_EDGE},iw)':-2`,
            tmp,
          ])
          fs.rmSync(dst, { force: true })
          fs.renameSync(tmp, dst)
          size = await imageSize(dst)
        }
      }

      try {
        fs.chmodSync(dst, 0o444)
      } catch {
        /* 权限失败不影响渲染 */
      }
      out.push({
        key,
        label: String(asset?.label || key),
        kind: asset?.kind === 'video-frame' ? 'video-frame' : 'image',
        path: dst,
        width: size?.width || Number(asset?.width) || 0,
        height: size?.height || Number(asset?.height) || 0,
        ...(asset?.videoDuration != null ? { videoDuration: Number(asset.videoDuration) } : {}),
        ...(asset?.frameTime != null ? { frameTime: Number(asset.frameTime) } : {}),
      })
    } catch (e) {
      if (/超过|最多选择/.test(String(e?.message || ''))) throw e
      missing.push({ key, label: String(asset?.label || key), url: String(asset?.url || ''), reason: (e && e.message) || '读取失败' })
    }
  }
  return { assets: out, missing }
}

// ---------------------------------------------------------------- 编码

const FFMPEG_CANDIDATES = [
  '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
]

export function resolveFfmpeg() {
  for (const p of FFMPEG_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return 'ffmpeg'
}

function run(bin, args, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || stdout || err.message).trim().slice(0, 1200)))
        return
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') })
    })
  })
}

function frameStamp() {
  return `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
}

async function encodeAndExtract(appRoot, job) {
  const ffmpeg = resolveFfmpeg()
  const framesDir = path.join(job.dir, 'frames')
  const files = fs.readdirSync(framesDir).filter((f) => /^\d{4}\.png$/.test(f)).sort()
  if (!files.length) throw new Error('渲染没有产出任何帧')
  job.frames = files.length

  const outDir = path.join(appRoot, 'public', 'videos')
  fs.mkdirSync(outDir, { recursive: true })
  const videoName = `blender-${frameStamp()}.mp4`
  const videoPath = path.join(outDir, videoName)
  await run(ffmpeg, [
    '-y',
    '-framerate', String(job.fps),
    '-i', path.join(framesDir, '%04d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    videoPath,
  ])
  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size < 1024) throw new Error('mp4 编码失败')
  if (fs.statSync(videoPath).size > MAX_OUTPUT_BYTES) {
    fs.rmSync(videoPath, { force: true })
    throw new Error(`产物超过 ${Math.round(MAX_OUTPUT_BYTES / 1024 / 1024)}MB 上限`)
  }
  job.videoUrl = `/videos/${videoName}`

  const genDir = path.join(appRoot, 'public', 'generated')
  fs.mkdirSync(genDir, { recursive: true })
  const picks = job.keyTimes.length ? job.keyTimes : [0, job.duration / 2, job.duration]
  job.frameUrls = []
  for (const [i, t] of picks.entries()) {
    const index = Math.max(0, Math.min(files.length - 1, Math.round(Number(t) * job.fps)))
    const src = path.join(framesDir, files[index])
    const name = `blender-${job.id}-${i}.jpg`
    await run(ffmpeg, ['-y', '-i', src, '-q:v', '2', path.join(genDir, name)])
    job.frameUrls.push(`/generated/${name}`)
  }

  // 帧序列用完即删，只保留 mp4 与抽取的关键帧。
  try {
    fs.rmSync(framesDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- 作业

function clearTimers(job) {
  if (job.timeoutTimer) clearTimeout(job.timeoutTimer)
  if (job.stallTimer) clearTimeout(job.stallTimer)
  job.timeoutTimer = null
  job.stallTimer = null
}

function touchStall(job) {
  if (job.stallTimer) clearTimeout(job.stallTimer)
  const limit = TIER_LIMITS[job.tier]?.stallMs || 60_000
  job.stallTimer = setTimeout(() => fail(job, `单帧渲染超过 ${Math.round(limit / 1000)}s 没有进展`, 'stall'), limit)
}

function snapshot(job) {
  return {
    id: job.id,
    tier: job.tier,
    status: job.status,
    phase: job.phase,
    engine: job.engine,
    progress: job.total ? Math.min(1, job.done / job.total) : 0,
    frame: job.done,
    total: job.total,
    width: job.width,
    height: job.height,
    fps: job.fps,
    duration: job.duration,
    videoUrl: job.videoUrl,
    frameUrls: job.frameUrls,
    missingAssets: job.missingAssets,
    error: job.error,
    elapsedMs: job.startedAt ? Date.now() - job.startedAt : 0,
  }
}

export function getRenderJob(id) {
  const job = jobs.get(String(id))
  return job ? snapshot(job) : null
}

export function listRenderJobs() {
  return [...jobs.values()].slice(-20).map(snapshot)
}

function cleanupDir(job) {
  try {
    fs.rmSync(job.dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function killChild(job) {
  const child = job.child
  if (!child) return
  try {
    child.kill('SIGTERM')
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      // killed 标志在调用 kill 后即为 true，不能用来判断进程是否已退出。
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 2500).unref?.()
}

function fail(job, message, status = 'error') {
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return
  clearTimers(job)
  job.status = status
  job.error = message
  job.finishedAt = Date.now()
  killChild(job)
  cleanupDir(job)
  running = Math.max(0, running - 1)
  pump()
}

export function cancelRenderJob(id, reason = '用户取消') {
  const job = jobs.get(String(id))
  if (!job) return null
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return snapshot(job)
  fail(job, reason, 'cancelled')
  return snapshot(job)
}

function startJob(job) {
  job.status = 'running'
  job.phase = 'render'
  job.startedAt = Date.now()
  const bin = job.bin
  const host = path.join(job.appRoot, HOST_SCRIPT)
  const child = spawn(
    bin,
    ['--background', '--factory-startup', '--python-exit-code', '1', '--python', host, '--', job.jobJson],
    {
      cwd: job.dir,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  job.child = child
  const limit = TIER_LIMITS[job.tier] || TIER_LIMITS.final
  job.timeoutTimer = setTimeout(() => fail(job, `渲染超过 ${Math.round(limit.timeoutMs / 1000)}s，已终止`), limit.timeoutMs)
  touchStall(job)

  let buffer = ''
  let stderr = ''
  const onLine = (line) => {
    if (!line.startsWith(SENTINEL)) return
    let data
    try {
      data = JSON.parse(line.slice(SENTINEL.length))
    } catch {
      return
    }
    if (data.type === 'engine') job.engine = data.engine
    else if (data.type === 'progress') {
      job.done = Number(data.frame) || 0
      job.total = Number(data.total) || job.total
      touchStall(job)
    } else if (data.type === 'error') {
      job.error = `${data.phase ? `[${data.phase}] ` : ''}${data.message || '渲染失败'}`
    }
  }
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) onLine(line.trim())
  })
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-8000)
  })
  child.on('error', (e) => fail(job, `无法启动 Blender：${e.message}`))
  child.on('close', (code) => {
    if (job.status !== 'running') return
    clearTimers(job)
    if (code !== 0) {
      const tail = (stderr || '').trim().split('\n').filter(Boolean).slice(-4).join(' ')
      fail(job, job.error || `Blender 退出码 ${code}${tail ? `：${tail.slice(0, 600)}` : ''}`)
      return
    }
    job.phase = 'encode'
    encodeAndExtract(job.appRoot, job)
      .then(() => {
        job.status = 'done'
        job.phase = 'done'
        job.finishedAt = Date.now()
        cleanupDir(job)
        running = Math.max(0, running - 1)
        pump()
      })
      .catch((e) => fail(job, `编码失败：${e.message}`))
  })
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()
    if (job.status !== 'queued') continue
    running++
    startJob(job)
  }
}

function normalizeInput(input) {
  if (input?.tier != null && !['trial', 'proxy', 'final'].includes(input.tier)) {
    throw new Error(`未知的渲染档位：${input.tier}`)
  }
  const tier = input?.tier || 'final'
  const duration = Number(input?.duration)
  const fps = Math.round(Number(input?.fps) || (tier === 'proxy' ? BLENDER_DEFAULTS.proxyFps : tier === 'trial' ? BLENDER_DEFAULTS.trialFps : BLENDER_DEFAULTS.finalFps))
  const width = Math.round(Number(input?.width))
  const height = Math.round(Number(input?.height))
  if (!(duration > 0 && duration <= 60)) throw new Error('镜头时长必须在 0–60 秒之间')
  if (!(fps >= 1 && fps <= 60)) throw new Error('帧率必须在 1–60 之间')
  if (!(width >= 2 && width <= 1920) || !(height >= 2 && height <= 1920)) throw new Error('分辨率必须在 2–1920 之间')
  const code = String(input?.code || '')
  if (!code.trim()) throw new Error('代码为空')
  if (Buffer.byteLength(code, 'utf8') > 200 * 1024) throw new Error('代码超过 200KB 上限')
  const assets = Array.isArray(input?.assets) ? input.assets : []
  const engine = String(input?.engine || BLENDER_DEFAULTS.engine)
  const samples =
    Number(input?.samples) ||
    (tier === 'trial' ? BLENDER_DEFAULTS.trialSamples : tier === 'proxy' ? BLENDER_DEFAULTS.proxySamples : BLENDER_DEFAULTS.finalSamples)
  return { tier, duration, fps, width, height, code, assets, engine, samples, mode: input?.mode === 'review' ? 'review' : 'clean', shot: input?.shot || {}, times: Array.isArray(input?.times) ? input.times.map(Number) : null, keyTimes: Array.isArray(input?.keyTimes) ? input.keyTimes.map(Number) : null }
}

/** 提交渲染作业；返回作业快照（含 id）。参数非法时直接抛错，不创建目录、不启动进程。 */
export async function submitRenderJob(input, appRoot) {
  const v = normalizeInput(input)
  const bin = resolveBlenderBin()
  if (!bin) throw new Error(INSTALL_HINT)
  const id = `b${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  const dir = path.join(appRoot, JOBS_DIR, id)
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true })
  const codePath = path.join(dir, 'scene_code.py')
  fs.writeFileSync(codePath, v.code, 'utf8')

  let materialized
  try {
    materialized = await materializeAssets(appRoot, dir, v.assets)
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
  const { assets, missing } = materialized
  const times = v.times && v.times.length ? v.times : Array.from({ length: Math.max(1, Math.round(v.duration * v.fps)) }, (_, i) => i / v.fps)
  const jobJson = path.join(dir, 'job.json')
  fs.writeFileSync(
    jobJson,
    JSON.stringify({
      id,
      tier: v.tier,
      codePath,
      assets,
      width: v.width,
      height: v.height,
      fps: v.fps,
      duration: v.duration,
      times,
      engine: v.engine,
      samples: v.samples,
      mode: v.mode,
      shot: v.shot,
      framesDir: path.join(dir, 'frames'),
    }),
    'utf8',
  )

  const job = {
    id,
    tier: v.tier,
    status: 'queued',
    phase: 'queued',
    appRoot,
    bin,
    dir,
    jobJson,
    codePath,
    width: v.width,
    height: v.height,
    fps: v.fps,
    duration: v.duration,
    mode: v.mode,
    engine: v.engine,
    done: 0,
    total: times.length,
    videoUrl: '',
    frameUrls: [],
    keyTimes: v.keyTimes || [],
    missingAssets: missing,
    error: null,
    child: null,
    timeoutTimer: null,
    stallTimer: null,
    startedAt: null,
    finishedAt: null,
  }
  jobs.set(id, job)
  queue.push(job)
  pump()
  return snapshot(job)
}

export function cleanupStaleJobs(appRoot, maxAgeMs = 2 * 60 * 60 * 1000) {
  const dir = path.join(appRoot, JOBS_DIR)
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      const stat = fs.statSync(full)
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true })
        removed++
      }
    } catch {
      /* ignore */
    }
  }
  return removed
}

export function shutdownRenderJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'queued') {
      clearTimers(job)
      killChild(job)
      cleanupDir(job)
    }
  }
}

export { CONCURRENCY as BLENDER_CONCURRENCY }
