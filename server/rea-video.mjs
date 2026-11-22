/**
 * rea-video 拆解作业宿主。
 *
 * 为什么是外部进程而不是内置实现：rea-video 的判定价值在像素级取证（帧节奏、
 * 传感器噪声、冻结帧、平涂块统计），这套东西用 Python + opencv 写成，重写一遍
 * 既不会更准也不会更省。所以这里只做「宿主该做的事」：
 * - 探测可执行文件，装不上就明确说清原因与安装命令；
 * - 一次拆解是一个一次性作业：独立目录、独立进程、可取消、有超时；
 * - 把应用已有的视觉模型设置注入子进程环境，用户不用配第二遍；
 * - 解析产物成案例库能消费的逐镜结构，并把证据帧复制到可读媒体目录。
 *
 * 设计取舍见 openspec/changes/prompt-case-library/design.md D5–D8。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mediaPath, statePath } from './paths.mjs'
import { CASE_MEDIA_SUBDIR } from './prompt-cases.mjs'

/** 作业状态根下的子目录；与 Blender 作业分开，清理互不影响 */
const JOBS_DIR = '.rea-jobs'
/** 产物上限：单个 30 秒片子的拆解包通常在 50 MB 内，512 MB 是安全阀 */
const MAX_OUTPUT_BYTES = Math.max(
  64 * 1024 * 1024,
  Number(process.env.REA_MAX_OUTPUT_MB || 512) * 1024 * 1024,
)
const CONCURRENCY = Math.max(1, Number(process.env.REA_CONCURRENCY) || 1)
/** 停滞上限：拆解在不同阶段之间可能长时间无输出，比渲染宽 */
const DEFAULT_STALL_MS = 90_000
/** 总超时：按片长估算，30 秒片子给 4 分钟起步 */
const DEFAULT_MIN_TIMEOUT_MS = 180_000
const TIMEOUT_PER_SECOND = 8

const INSTALL_HINT =
  '未找到 rea-video。安装：uv tool install "rea-video[ocr] @ git+https://github.com/JuneYaooo/rea-video"（需要 Python ≥ 3.10 与 ffmpeg），或在设置里填 rea-video 可执行文件路径。'

/**
 * 档位 → 额外参数。
 *
 * `quick` 是默认档：六个 `--no-*` 关掉了所有需要下载模型的步骤
 * （音轨分离 67+149 MB、语音识别 160 MB、说话人 35 MB），首次运行零下载。
 * `full` 全开，首次会提示下载体积。
 */
export const REVERSE_TIERS = {
  quick: {
    id: 'quick',
    label: '快速（默认）',
    args: ['--no-stems', '--no-asr', '--no-speakers', '--no-packaging', '--no-moments', '--no-survey'],
    downloads: [],
    hint: '只做切镜与逐镜制作方式判定 + 提示词，不下载任何模型。',
  },
  full: {
    id: 'full',
    label: '完整',
    args: [],
    downloads: [
      { name: '人声/配乐分离（UVR MDX-Net）', mb: 67 },
      { name: '音效分离（BandIt v2）', mb: 149 },
      { name: '本地语音识别（SenseVoice）', mb: 160 },
      { name: '说话人分离', mb: 35 },
    ],
    hint: '含音轨分离、字幕时间轴、特殊时刻分析；首次运行需要下载约 411 MB 模型，耗时也明显更长。',
  },
}

export function listReverseTiers() {
  return Object.values(REVERSE_TIERS).map((t) => ({
    id: t.id,
    label: t.label,
    hint: t.hint,
    downloads: t.downloads,
    downloadMb: t.downloads.reduce((n, d) => n + d.mb, 0),
  }))
}

export function normalizeTier(raw) {
  const v = String(raw || '').trim()
  return REVERSE_TIERS[v] ? v : 'quick'
}

/** 固定分类集合：产物里的 label 只能落在这 11 个里，其余按未知保留原值 */
export const REVERSE_LABELS = {
  live_action: '实拍',
  ai_video: 'AI 生成视频',
  avatar: '数字人口播',
  cg_3d: '3D 渲染',
  code_render: '代码/模板渲染',
  screen_capture: '屏幕录制/截图',
  still_motion: '静态图 + 推拉动效',
  static_hold: '静帧停留',
  anim_2d: '2D 动画',
  stop_motion: '定格动画',
  film_footage: '影视片段',
}

const jobs = new Map()
const queue = []
let running = 0
let healthCache = null

// ---------------------------------------------------------------- 可执行文件

function bundledReaBin() {
  try {
    return path.join(path.dirname(process.execPath), 'rea-video')
  } catch {
    return ''
  }
}

function binCandidates() {
  const list = []
  if (process.env.REA_VIDEO_BIN) list.push(process.env.REA_VIDEO_BIN)
  list.push(bundledReaBin())
  return list.filter(Boolean)
}

function findOnPath(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const p = path.join(dir, name)
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch {
      /* ignore */
    }
  }
  return ''
}

/** 显式路径 → 随包位置 → PATH */
export function resolveReaBin() {
  for (const candidate of binCandidates()) {
    try {
      if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* ignore */
    }
  }
  return findOnPath('rea-video') || null
}

function probeBin(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--help'], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr) {
        resolve({ ok: false, reason: 'not-executable', detail: err.message })
        return
      }
      const text = `${stdout || ''}\n${stderr || ''}`
      if (err) {
        resolve({ ok: false, reason: 'help-failed', detail: text.trim().slice(0, 400) })
        return
      }
      const m = text.match(/rea-video[^\n]*?(\d+\.\d+\.\d+)/i)
      resolve({ ok: true, version: m ? m[1] : '', detail: '' })
    })
  })
}

/**
 * 可用性探测。`force` 跳过缓存，供设置页「检测」按钮使用。
 */
export async function reaHealth({ bin, force = false } = {}) {
  const resolved = String(bin || '').trim() || resolveReaBin()
  if (!force && healthCache && healthCache.path === resolved && Date.now() - healthCache.at < 60_000) {
    return healthCache.value
  }
  let value
  if (!resolved) {
    value = { ok: false, path: null, reason: 'not-installed', message: INSTALL_HINT, version: '' }
  } else {
    const probe = await probeBin(resolved)
    value = probe.ok
      ? { ok: true, path: resolved, reason: '', message: '', version: probe.version || '' }
      : {
          ok: false,
          path: resolved,
          reason: probe.reason,
          message: `rea-video 无法执行：${probe.detail || probe.reason}`,
          version: '',
        }
  }
  healthCache = { path: resolved, at: Date.now(), value }
  return value
}

// ---------------------------------------------------------------- 作业

function nowIso() {
  return new Date().toISOString()
}

function clearTimers(job) {
  if (job.timeoutTimer) clearTimeout(job.timeoutTimer)
  if (job.stallTimer) clearTimeout(job.stallTimer)
  job.timeoutTimer = null
  job.stallTimer = null
}

function touchStall(job) {
  if (job.stallTimer) clearTimeout(job.stallTimer)
  const limit = job.stallMs || DEFAULT_STALL_MS
  job.stallTimer = setTimeout(() => {
    failJob(job, `拆解超过 ${Math.round(limit / 1000)}s 没有进展，已终止`, 'error', 'stall')
  }, limit)
}

function snapshot(job) {
  return {
    id: job.id,
    status: job.status,
    /** 失败细分原因：stall / timeout / cancel / exit；成功为空 */
    reason: job.reason || '',
    phase: job.phase,
    tier: job.tier,
    title: job.title,
    videoUrl: job.videoUrl,
    elapsedMs: job.startedAt ? Date.now() - job.startedAt : 0,
    timeoutMs: job.timeoutMs,
    tail: job.tail.slice(-12),
    error: job.error,
    vlm: job.vlmStatus,
    result: job.result,
  }
}

export function getReverseJob(id) {
  const job = jobs.get(String(id))
  return job ? snapshot(job) : null
}

export function listReverseJobs(limit = 20) {
  return [...jobs.values()].slice(-limit).map(snapshot)
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
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }, 5000).unref?.()
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function dirSize(dir) {
  let total = 0
  const walk = (p) => {
    let entries = []
    try {
      entries = fs.readdirSync(p, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(p, e.name)
      if (e.isDirectory()) walk(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir)
  return total
}

/**
 * 终止作业并记账。
 *
 * `status` 只用四态（error / cancelled / done / running），失败原因走 `reason`：
 * 状态机越简单，close 事件与定时器的竞争越少。这里先置状态再 kill，
 * 子进程的 close 回调看到终态就直接返回，不会覆盖原因。
 */
function failJob(job, message, status = 'error', reason = '') {
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return
  clearTimers(job)
  job.status = status
  job.reason = reason || (status === 'cancelled' ? 'cancel' : 'exit')
  job.error = message
  job.finishedAt = Date.now()
  killChild(job)
  // 失败不留半成品：产物目录整体删除
  removeDir(job.dir)
  running = Math.max(0, running - 1)
  pump()
}

export function cancelReverseJob(id, reason = '用户取消') {
  const job = jobs.get(String(id))
  if (!job) return null
  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') return snapshot(job)
  failJob(job, reason, 'cancelled', 'cancel')
  return snapshot(job)
}

/**
 * 把应用设置的视觉模型转成子进程环境变量。
 *
 * 不写 `.env` 文件：密钥落到作业目录就等于散落到磁盘各处，还会进备份。
 * 三个变量名是 rea-video 的既定契约（见它的 setup.md）。
 */
export function vlmEnvFrom(entry, provider, opts = {}) {
  const baseUrl = String(provider?.baseUrl || '').trim()
  const model = String(entry?.model || '').trim()
  const localProxy = String(opts.localProxy || '').trim()
  const internalToken = String(opts.internalToken || '').trim()
  if (!model) return { env: {}, configured: false }

  /**
   * 优先走应用内的中转端点（/api/prompt-cases/vlm-proxy）。
   *
   * 直接给上游地址是不行的，两个实测原因：
   * 1. APIMart 即使不传 stream 也只回 SSE，rea-video 按 JSON 解析会报
   *    `Expecting value: line 1 column 1`；
   * 2. 子进程拿不到 apimart 的代理与会话级 IPv4 处理，直连会证书失败。
   * 中转端点用应用自己的客户端转发并归一成非流式 JSON，同时不让密钥落到
   * 子进程环境里（只放内部令牌）。
   */
  if (localProxy && internalToken) {
    return {
      env: {
        // 带上 /v1 后缀：rea-video 会再拼 /chat/completions
        REA_VLM_BASE_URL: `${localProxy.replace(/\/+$/, '')}/v1`,
        REA_VLM_API_KEY: internalToken,
        REA_VLM_MODEL: model,
        // rea-video 用的是 OpenAI 兼容客户端；这里告诉它别开流式
        REA_VLM_STREAM: '0',
      },
      configured: true,
      viaProxy: true,
    }
  }

  const apiKey = String(provider?.apiKey || provider?.key || '').trim()
  if (!baseUrl || !apiKey) return { env: {}, configured: false }
  return {
    env: {
      REA_VLM_BASE_URL: baseUrl.replace(/\/+$/, ''),
      REA_VLM_API_KEY: apiKey,
      REA_VLM_MODEL: model,
    },
    configured: true,
    viaProxy: false,
  }
}

function appendTail(job, chunk) {
  const text = String(chunk || '')
  if (!text) return
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    job.tail.push(t.slice(0, 400))
  }
  if (job.tail.length > 400) job.tail.splice(0, job.tail.length - 400)
  // 解析 rea-video 的阶段名，让界面能显示「现在在干什么」
  const phase = job.tail[job.tail.length - 1] || ''
  const m = phase.match(/^(survey|decompose|classify|vlm|review|packaging|stems|audio|videomd|report)\b/i)
  if (m) job.phase = m[1].toLowerCase()
  touchStall(job)
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const next = queue.shift()
    if (!next || next.status !== 'queued') continue
    running += 1
    startJob(next)
  }
}

function buildArgs(job) {
  const tier = REVERSE_TIERS[job.tier] || REVERSE_TIERS.quick
  const args = ['decompose', job.inputPath, '-o', job.outDir, '--lang', 'zh']
  args.push(...tier.args)
  if (job.useVlm && job.vlmConfigured) args.push('--vlm')
  else args.push('--no-vlm')
  return args
}

function startJob(job) {
  job.status = 'running'
  job.phase = 'decompose'
  job.startedAt = Date.now()
  job.timeoutTimer = setTimeout(() => {
    failJob(job, `拆解超过 ${Math.round(job.timeoutMs / 1000)}s，已终止`, 'error', 'timeout')
  }, job.timeoutMs)
  touchStall(job)

  const args = buildArgs(job)
  let child
  try {
    child = spawn(job.bin, args, {
      cwd: job.dir,
      env: { ...process.env, ...job.vlmEnv, PYTHONUNBUFFERED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    failJob(job, `无法启动 rea-video：${e?.message || String(e)}`)
    return
  }
  job.child = child
  child.stdout?.on('data', (b) => appendTail(job, b.toString('utf8')))
  child.stderr?.on('data', (b) => appendTail(job, b.toString('utf8')))

  child.on('error', (e) => failJob(job, `rea-video 进程出错：${e?.message || String(e)}`))

  child.on('close', (code) => {
    clearTimers(job)
    if (job.status === 'cancelled' || job.status === 'error') return
    if (code !== 0) {
      const tail = job.tail.slice(-4).join(' / ')
      failJob(job, `拆解失败（退出码 ${code}）${tail ? `：${tail}` : ''}`)
      return
    }
    const size = dirSize(job.dir)
    if (size > MAX_OUTPUT_BYTES) {
      failJob(job, `产物体积超过上限（${Math.round(size / 1024 / 1024)} MB > ${MAX_OUTPUT_BYTES / 1024 / 1024} MB）`)
      return
    }
    job.status = 'done'
    job.phase = 'done'
    job.finishedAt = Date.now()
    // 成功后立刻解析产物：轮询阶段就要能报出镜头数与视觉判定状态
    try {
      parseJobArtifacts(job, job.appRoot)
      job.result = summarizeBreakdown(job)
    } catch (e) {
      job.status = 'error'
      job.error = `产物解析失败：${e?.message || String(e)}`
      running = Math.max(0, running - 1)
      pump()
      return
    }
    running = Math.max(0, running - 1)
    pump()
  })
}

/** 作业最终结果摘要：界面只需要这些，不把整个 breakdown 塞进响应 */
function summarizeBreakdown(job) {
  const parsed = job.parsed || { shots: [], vlmStatus: 'off', globalStyle: '' }
  return {
    shots: parsed.shots.length,
    vlmStatus: parsed.vlmStatus,
    vlmNote: parsed.vlmNote,
    duration: parsed.duration,
    engine: parsed.engine,
    storyboardUrl: parsed.storyboardUrl,
    /** 沙箱预览用的报告地址；没有报告时为空 */
    reportUrl: parsed.reportUrl || '',
    /** 本作业到导出状态用的视觉模型（只回标签，不回 Key） */
    vlmModel: parsed.vlmModel || '',
    // 逐镜结构交由 adopt 阶段整体写入案例库，轮询只回数量
  }
}

/**
 * 创建一个拆解作业。
 *
 * `videoPath` 必须是服务端已解析好的本地绝对路径与站内 URL 对，
 * 作业目录里用硬链接/复制得到一份输入，避免源文件被移走后作业失败。
 */
export async function createReverseJob(appRoot, input = {}) {
  const health = await reaHealth({ bin: input.bin })
  if (!health.ok) {
    const err = new Error(health.message)
    err.kind = health.reason || 'rea-unavailable'
    throw err
  }
  const sourcePath = String(input.videoPath || '')
  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('源视频不存在')
  const id = `rea-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
  const dir = statePath(appRoot, JOBS_DIR, id)
  fs.mkdirSync(dir, { recursive: true })

  const ext = path.extname(sourcePath) || '.mp4'
  const inputPath = path.join(dir, `input${ext}`)
  try {
    fs.linkSync(sourcePath, inputPath)
  } catch {
    fs.copyFileSync(sourcePath, inputPath)
  }
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(outDir, { recursive: true })

  const tier = normalizeTier(input.tier)
  const durationSec = Math.max(0, Number(input.durationSec) || 0)
  const timeoutMs = Math.max(
    DEFAULT_MIN_TIMEOUT_MS,
    Math.round(durationSec * TIMEOUT_SECONDS_SCALE) + DEFAULT_MIN_TIMEOUT_MS,
  )

  const job = {
    id,
    tier,
    status: 'queued',
    phase: 'queued',
    appRoot,
    bin: health.path,
    dir,
    inputPath,
    outDir,
    videoUrl: String(input.videoUrl || ''),
    title: String(input.title || '').slice(0, 200),
    useVlm: input.useVlm !== false,
    vlmConfigured: Boolean(input.vlm?.configured),
    vlmEnv: input.vlm?.env || {},
    vlmStatus: input.vlm?.configured ? 'pending' : 'not_configured',
    /** 本次使用的视觉模型标识（只存展示用标签，不含 Key） */
    vlmModel: String(input.vlm?.modelLabel || ''),
    timeoutMs,
    // 测试可缩短；生产固定 90s
    stallMs: Math.max(1000, Number(input.stallMs) || DEFAULT_STALL_MS),
    tail: [],
    error: null,
    child: null,
    timeoutTimer: null,
    stallTimer: null,
    startedAt: null,
    finishedAt: null,
    parsed: null,
    result: null,
  }
  jobs.set(id, job)
  queue.push(job)
  pump()
  return snapshot(job)
}

const TIMEOUT_SECONDS_SCALE = TIMEOUT_PER_SECOND

/**
 * 解析拆解产物 → 案例库逐镜结构。
 *
 * 字段对齐 rea-video 的 breakdown.json：
 * - `shots[].base`：label / label_zh / confidence / decided_by / evidence
 * - `shots[].review.replication`：image_prompt / video_prompt / video_prompt_en
 * - `shots[].assets`：sheet / first_frame / last_frame
 * - `analysis.vlm.status`：ok / partial / failed / not_configured / off
 *
 * 制作方式不在集合内时保留原值并标 `unknown: true`，不静默映射。
 */
export function parseBreakdown(doc) {
  const b = doc && typeof doc === 'object' ? doc : {}
  const source = b.source && typeof b.source === 'object' ? b.source : {}
  const vlm = b.analysis?.vlm && typeof b.analysis.vlm === 'object' ? b.analysis.vlm : {}
  const shotsRaw = Array.isArray(b.shots) ? b.shots : []

  const shots = shotsRaw.map((rec, i) => {
    const base = rec?.base && typeof rec.base === 'object' ? rec.base : {}
    const label = String(base.label || '').trim()
    const labelKnown = Boolean(REVERSE_LABELS[label])
    /**
     * 两段提示词的真实来源有两处，优先级从高到低：
     * 1. `review.replication`：agent 看图复核后手填的提示词（最具体，含景别/机位/光）；
     * 2. `replication.spec.scene`：rea-video 对代码渲染类镜头自动产出的画面规格。
     *
     * 注意 `replication` 本身不是提示词：它给的是复刻路线、候选工具与验证项。
     * AI 生成类镜头在未做看图复核时**没有**提示词，这是上游设计，不是缺数据
     * ——因此这里如实标 promptMissing，让界面提示人工补写。
     */
    const rep = rec?.review?.replication && typeof rec.review.replication === 'object' ? rec.review.replication : {}
    const plan = rec?.replication && typeof rec.replication === 'object' ? rec.replication : {}
    const spec = plan.spec && typeof plan.spec === 'object' ? plan.spec : {}
    const scene = spec.scene && typeof spec.scene === 'object' ? spec.scene : {}
    const scenePicture = String(scene.picture || '').trim()
    const sceneMove = String(scene.move || '').trim()
    const planNote = String(plan.note || '').trim()
    const imagePrompt = String(rep.image_prompt || '').trim() || scenePicture
    const videoPrompt = String(rep.video_prompt || '').trim() || sceneMove
    const videoPromptEn = String(rep.video_prompt_en || '').trim()
    const assets = rec?.assets && typeof rec.assets === 'object' ? rec.assets : {}
    const evidence = Array.isArray(base.evidence) ? base.evidence.map((x) => String(x)).filter(Boolean) : []
    const confidence = Number(base.confidence)
    return {
      index: Number(rec?.index) || i + 1,
      start: Number(rec?.start) || 0,
      end: Number(rec?.end) || 0,
      duration: Number(rec?.duration) || 0,
      kind: label,
      kindLabel: labelKnown ? REVERSE_LABELS[label] : label ? `未知（${label}）` : '',
      unknownKind: Boolean(label) && !labelKnown,
      confidence: Number.isFinite(confidence) ? Math.round(confidence * 1000) / 1000 : null,
      decidedBy: String(base.decided_by || ''),
      evidence,
      keyframePrompt: imagePrompt,
      videoPrompt: videoPrompt || videoPromptEn,
      videoPromptEn,
      promptMissing: !imagePrompt && !videoPrompt && !videoPromptEn,
      /** 复刻路线与工具（rea-video 的 replication 给的是这个，不是提示词） */
      remakeRoute: Array.isArray(plan.route) ? plan.route.map(String) : [],
      remakeExecutor: String(plan.executor || ''),
      remakeNote: planNote,
      /** 上游规则号，便于回查它为什么这么判 */
      remakeRule: String(plan.rule || ''),
      assets: {
        sheet: String(assets.sheet || ''),
        firstFrame: String(assets.first_frame || ''),
        lastFrame: String(assets.last_frame || ''),
      },
    }
  })

  const vlmStatus = String(vlm.status || 'off')
  const vlmNote =
    vlmStatus === 'ok'
      ? '视觉判定已生效'
      : vlmStatus === 'partial'
        ? '视觉判定只覆盖了部分镜头：其余镜头仅靠确定性取证'
        : vlmStatus === 'failed'
          ? '视觉模型调用全部失败：本片只有确定性取证'
          : vlmStatus === 'not_configured'
            ? '未配置视觉模型：本片只有确定性取证'
            : ''

  const globalStyle = String(b.cast?.style || b.aspects?.style || '').trim()

  return {
    shots,
    vlmStatus,
    vlmNote,
    duration: Number(source.duration) || 0,
    engine: String(b.engine || ''),
    globalStyle,
    aspect: String(source.aspect_ratio || ''),
    width: Number(source.width) || 0,
    height: Number(source.height) || 0,
    fps: Number(source.fps) || 0,
  }
}

/**
 * 读取作业产物并解析；同时把证据帧复制到媒体目录。
 *
 * 证据帧复制失败只影响该镜的展示，不使整个作业失败：一个张坏图不该把
 * 已经跑完几分钟的拆解结果作废。
 */
export function parseJobArtifacts(job, appRoot) {
  const breakdownPath = path.join(job.outDir, 'breakdown.json')
  if (!fs.existsSync(breakdownPath)) throw new Error('产物缺少 breakdown.json')
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(breakdownPath, 'utf8'))
  } catch (e) {
    throw new Error(`breakdown.json 不是合法 JSON：${e?.message || String(e)}`)
  }
  const parsed = parseBreakdown(doc)
  const vlmStatus = parsed.vlmStatus

  const mediaDirName = `${CASE_MEDIA_SUBDIR}/${job.id}`
  const mediaDir = mediaPath(appRoot, ...mediaDirName.split('/'))
  fs.mkdirSync(mediaDir, { recursive: true })

  const copyIfExists = (rel, tag) => {
    const src = path.join(job.outDir, rel)
    if (!rel || !fs.existsSync(src)) return ''
    const ext = path.extname(src) || '.jpg'
    const name = `${tag}${ext}`
    try {
      fs.copyFileSync(src, path.join(mediaDir, name))
      return `/${mediaDirName}/${name}`
    } catch {
      return ''
    }
  }

  const storyboardUrl = copyIfExists('storyboard.jpg', 'storyboard')
  for (const shot of parsed.shots) {
    const tag = `s${String(shot.index).padStart(3, '0')}`
    const sheet = copyIfExists(shot.assets.sheet, tag)
    const first = copyIfExists(shot.assets.firstFrame, `${tag}_first`)
    const last = copyIfExists(shot.assets.lastFrame, `${tag}_last`)
    shot.evidenceFrames = [sheet, first, last].filter(Boolean)
    shot.evidenceMissing = shot.evidenceFrames.length === 0
  }

  /**
   * 报告与它引用的资源整份复制到可读目录，供界面沙箱预览。
   *
   * 报告的 img/audio 全是相对路径（storyboard.jpg / shots/*.jpg / sfx/*.wav），
   * 只拷 report.html 会一片空白。实测产物无 script、无外链，所以沙箱 iframe
   * （禁脚本）是安全边界。复制失败不影响结构化结果。
   */
  let reportUrl = ''
  const reportSrc = path.join(job.outDir, 'report.html')
  if (fs.existsSync(reportSrc)) {
    const reportDir = path.join(mediaDir, 'report')
    try {
      fs.mkdirSync(reportDir, { recursive: true })
      fs.copyFileSync(reportSrc, path.join(reportDir, 'report.html'))
      for (const sub of ['shots', 'sfx', 'frames']) {
        const from = path.join(job.outDir, sub)
        if (!fs.existsSync(from)) continue
        fs.cpSync(from, path.join(reportDir, sub), { recursive: true })
      }
      for (const file of ['storyboard.jpg', 'audio.png']) {
        const from = path.join(job.outDir, file)
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(reportDir, file))
      }
      reportUrl = `/${mediaDirName}/report/report.html`
    } catch {
      // 报告展示失败不影响结构化结果
    }
  }

  job.parsed = {
    ...parsed,
    reportUrl,
    vlmModel: job.vlmModel || '',
    vlmStatus,
    storyboardUrl,
    mediaDir: `/${mediaDirName}`,
  }
  job.vlmStatus = vlmStatus
  return job.parsed
}

/** 清理过期作业目录（保留最近成功的）：默认只删 6 小时前的 */
export function cleanupStaleReverseJobs(appRoot, maxAgeMs = 6 * 60 * 60 * 1000) {
  const dir = statePath(appRoot, JOBS_DIR)
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      const stat = fs.statSync(full)
      const live = jobs.get(name)
      if (live && (live.status === 'running' || live.status === 'queued')) continue
      if (stat.isDirectory() && Date.now() - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      /* ignore */
    }
  }
  return removed
}

/**
 * 把一条已完成的拆解写成案例。
 *
 * 写入 `prompt_cases`（`source=reverse-own`），`prompt` 存整片风格与逐镜摘要的可读
 * 文本，`shots` 存结构化逐镜（制作方式、置信度、依据、两段提示词、证据帧）。
 * 许可由 prompt-cases.mjs 按来源强制为 own，这里不传 license。
 */
export function adoptReverseJob(jobOrId, input = {}) {
  const job = typeof jobOrId === 'string' ? jobs.get(String(jobOrId)) : jobOrId
  if (!job) throw new Error('作业不存在')
  if (job.status !== 'done' || !job.parsed) throw new Error('作业还没完成，不能存入案例库')
  const parsed = job.parsed
  const title = String(input.title || job.title || '').trim() || `反推 · ${parsed.shots.length} 镜`

  const lines = []
  if (parsed.globalStyle) lines.push(`整体风格：${parsed.globalStyle}`)
  if (job.videoUrl) lines.push(`来源视频：${job.videoUrl}`)
  lines.push(`逐镜 ${parsed.shots.length} 个`)
  if (parsed.vlmNote) lines.push(`视觉判定：${parsed.vlmNote}`)

  return {
    source: 'reverse-own',
    sourceId: job.id,
    title,
    prompt: lines.join('\n'),
    shots: parsed.shots,
    model: parsed.engine,
    category: '',
    tags: [],
    videoUrl: job.videoUrl,
    posterUrl: parsed.storyboardUrl || '',
    author: '',
    sourceUrl: '',
    createdAt: '',
  }
}

export function shutdownReverseJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'queued') {
      clearTimers(job)
      killChild(job)
    }
  }
}

export { CONCURRENCY as REA_CONCURRENCY, INSTALL_HINT as REA_INSTALL_HINT }

/** 供测试：清掉作业表与探测缓存 */
export function resetReverseState() {
  for (const job of jobs.values()) {
    clearTimers(job)
    killChild(job)
  }
  jobs.clear()
  queue.length = 0
  running = 0
  healthCache = null
}

export { nowIso }
