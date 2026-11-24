/**
 * 视频转白模：作业编排。
 *
 * 与 server/blender.mjs 同一套形态，理由相同：每次转换是一个一次性作业，
 * 独立目录、独立子进程、独立输出；失败、取消、超时都不产出半成品。
 *
 * 链路（两段子进程，拆开跑是为了失败时不重做上一步）：
 *   视频 → da3_infer.py（抽帧 + DA3 推理）→ npz
 *        → mesh_whitebox.py（TSDF + GLB 导出）→ .glb
 *
 * 推理环境在 <state-root>/.whitebox/ 下，由 whitebox/install.sh 装。
 * 环境不满足时**明确报 env-missing 并附缺失项**，绝不产出占位 GLB（见 spec）。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { projectMediaDir, projectMediaUrl, parseProjectMediaUrl, resolveProjectMediaPath } from './media.mjs'
import { resolveStateRoot, statePath } from './paths.mjs'
import { readProject, resolveRoot, safeProjectName, writeProject } from './db.mjs'

const JOBS_DIR = '.whitebox-jobs'
const CONCURRENCY = Math.max(1, Number(process.env.WHITEBOX_CONCURRENCY) || 1)

/** 单次转换的总超时。实测冷启动 31s / 热启动 7s，留足余量给慢机器与大视频。 */
const JOB_TIMEOUT_MS = Math.max(30_000, Number(process.env.WHITEBOX_TIMEOUT_MS) || 300_000)
/** 子进程超过这么久没有任何输出即认为卡死。 */
const STALL_MS = Math.max(15_000, Number(process.env.WHITEBOX_STALL_MS) || 120_000)

// 与 whitebox/da3_infer.py 保持一致。
//
// 12 帧是早期基于「内存不够」的错误假设设的；实测 84 帧只占 2.07GB。
// 真正决定重建质量的是**帧间隔**：42 秒视频按旧的「12 帧摊薄」等于每 4 秒
// 一帧，相机早已走出视野，位姿崩、重建塌成薄板（15,874 面、形态不可辨）。
// 改成按 0.5 秒间隔采样后同一视频出 92,832 面、房间轮廓清晰。
const HARD_MAX_FRAMES = 96
const MIN_FRAMES = 4
/** 目标帧间隔（秒）。前端默认值也用它。 */
const DEFAULT_INTERVAL = 0.5
const DEFAULT_TARGET_SIZE = 6

const INSTALL_HINT = '先运行 bash whitebox/install.sh（首次约需 2GB 下载）'

const jobs = new Map()
const queue = []
let running = 0

// ---------------------------------------------------------------- 环境

/**
 * 运行时有两套可能的位置，按优先级探测：
 *
 * 1. **随包环境**（`BUNDLE_WHITEBOX=1` 构建的安装包）：<appRoot>/whitebox-runtime/
 *    由 desktop/scripts/bundle-whitebox.mjs 预装，解释器 / venv / 源码 / 权重全在里面。
 *    appRoot 打包后是 Contents/Resources/app（只读），但推理只需要读。
 * 2. **state 根环境**（默认构建）：<state-root>/.whitebox/，用户自己跑 install.sh。
 *
 * 优先随包：那是开箱即用的那份；没有才回退，让默认构建与用户自装仍然可用。
 * 两者子目录结构完全相同，所以下面的路径拼接不需要分支。
 */
function bundledRuntimePath(appRoot) {
  return path.join(path.resolve(appRoot), 'whitebox-runtime')
}

function usesBundledRuntime(appRoot) {
  return fs.existsSync(path.join(bundledRuntimePath(appRoot), 'venv', 'bin', 'python'))
}

function whiteboxRoot(appRoot) {
  return usesBundledRuntime(appRoot) ? bundledRuntimePath(appRoot) : statePath(appRoot, '.whitebox')
}

/** 这份环境是不是随安装包来的（供 UI 区分「无需安装」与「需要安装」） */
export function isBundledRuntime(appRoot) {
  return usesBundledRuntime(appRoot)
}

export function venvPython(appRoot) {
  return path.join(whiteboxRoot(appRoot), 'venv', 'bin', 'python')
}

/** 子进程环境：KMP_DUPLICATE_LIB_OK 必须在这里设，别指望调用方记得。 */
function pythonEnv(extra = {}) {
  return {
    ...process.env,
    // torch 与 pycolmap 各带一份 libomp，同进程导入会 abort（OMP Error #15）
    KMP_DUPLICATE_LIB_OK: 'TRUE',
    PYTHONUNBUFFERED: '1',
    TOKENIZERS_PARALLELISM: 'false',
    ...extra,
  }
}

let healthCache = null

/**
 * 体检：转调 whitebox/doctor.py。带 60 秒缓存（与 blenderHealth 一致），
 * 因为 UI 每次进 Tab 都会问，而探测要起一个子进程。
 */
export async function whiteboxHealth(appRoot, { refresh = false } = {}) {
  if (!refresh && healthCache && Date.now() - healthCache.at < 60_000) return healthCache.value

  const py = venvPython(appRoot)
  const venvExists = fs.existsSync(py)
  let value

  // 一律跑 doctor.py，即使 venv 不存在。
  //
  // 为什么不用「venv 不在就返回空 checks 的短路」：UI 要逐项告诉用户缺什么，
  // 空 checks 会渲染成一个没有任何条目的面板——用户只看到「环境未安装」，
  // 不知道到底缺 Python、缺 torch 还是缺那 516MB 权重。venv 不在时用系统
  // python 跑 doctor，它照样输出五项与各自的缺失原因（见 doctor 的
  // probe_venv_interpreter：它会探测 venv 而不是报告自己）。
  {
    const script = path.join(path.resolve(appRoot), 'whitebox', 'doctor.py')
    const bin = venvExists ? py : 'python3'
    if (!fs.existsSync(script)) {
      value = {
        ok: false,
        installed: false,
        venv: py,
        venvExists,
        checks: {},
        missing: ['doctor'],
        installHint: INSTALL_HINT,
        message: `体检脚本缺失：${script}`,
      }
    } else {
      // 环境根有两种来源（见 whiteboxRoot）：随包时直接给 --runtime-root，
      // 自装时给 --state-root 让它自己拼 .whitebox。不能一律用 appRoot——
      // 桌面端的 appRoot 是只读应用目录，状态在 Application Support 下。
      const rootArgs = usesBundledRuntime(appRoot)
        ? ['--runtime-root', bundledRuntimePath(appRoot)]
        : ['--state-root', resolveStateRoot(appRoot)]
      const result = await runOnce(bin, [script, ...rootArgs], {
        timeoutMs: 90_000,
      })
      let parsed = null
      for (const line of String(result.stdout || '').trim().split('\n').reverse()) {
        try {
          parsed = JSON.parse(line)
          break
        } catch {
          /* 继续往上找 */
        }
      }
      value = parsed
        ? { ...parsed, installed: venvExists, message: parsed.ok ? '' : parsed.message || '推理环境不完整' }
        : {
            ok: false,
            installed: venvExists,
            venv: py,
            venvExists,
            checks: {},
            missing: ['doctor'],
            installHint: INSTALL_HINT,
            message: `体检失败（退出码 ${result.code}）：${(result.stderr || '').trim().slice(-400)}`,
          }
    }
  }

  healthCache = { at: Date.now(), value }
  return value
}

/** 权重是否就绪的轻量判断，供 POST 前置校验用（不读 doctor 的完整结果）。 */
function weightsReady(appRoot) {
  return fs.existsSync(path.join(whiteboxRoot(appRoot), 'models', 'da3-base', 'model.safetensors'))
}

// ---------------------------------------------------------------- 子进程

function runOnce(bin, args, { timeoutMs = 120_000, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(bin, args, { cwd, env: pythonEnv() })
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e?.message || String(e) })
      return
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    child.stdout?.on('data', (c) => {
      stdout += c.toString('utf8')
    })
    child.stderr?.on('data', (c) => {
      stderr += c.toString('utf8')
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

// ---------------------------------------------------------------- 输入校验

function normalizeInput(input) {
  // interval 是主参数；fps 保留给旧调用方，两者等价换算
  const interval = Number(input?.interval ?? (input?.fps ? 1 / Number(input.fps) : DEFAULT_INTERVAL))
  if (!(interval > 0.05 && interval <= 10)) throw new Error('抽帧间隔必须在 0.05–10 秒之间')

  // 硬上限：规格要求不得接受大于 12 的值
  const rawMax = Number(input?.maxFrames ?? HARD_MAX_FRAMES)
  const maxFrames = Math.min(HARD_MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(rawMax) || HARD_MAX_FRAMES))

  const targetSize = Number(input?.targetSize ?? DEFAULT_TARGET_SIZE)
  if (!(targetSize >= 0.5 && targetSize <= 50)) throw new Error('目标尺寸必须在 0.5–50 米之间')

  const resolution = Number(input?.resolution ?? 384)
  if (!(resolution >= 128 && resolution <= 512)) throw new Error('TSDF 分辨率必须在 128–512 之间')

  return { interval, maxFrames, targetSize, resolution }
}

/**
 * 把站内媒体 URL 解析成磁盘文件。只接受项目媒体路径，拒绝外部 URL——
 * 下载是素材摄取环节的事，不是这里。
 */
function resolveMediaFile(appRoot, projectName, rawUrl, kindLabel) {
  const raw = String(rawUrl || '').split('?')[0]
  if (!raw) throw new Error(`缺少${kindLabel}来源`)

  const pm = parseProjectMediaUrl(raw)
  if (pm) {
    if (pm.name !== projectName) throw new Error(`${kindLabel}不属于当前项目`)
    const file = resolveProjectMediaPath(appRoot, pm.name, pm.file)
    if (!fs.existsSync(file)) throw new Error(`${kindLabel}文件不存在：${raw}`)
    return file
  }

  if (/^(https?:|data:|blob:)/i.test(raw)) {
    throw new Error(`不支持直接提交外部链接。请先把${kindLabel}导入素材库，再选它转换成白模。`)
  }
  throw new Error(`无法识别的${kindLabel}地址：${raw}`)
}

/**
 * 解析输入来源。两种模式二选一：
 *
 * - `video`：一段视频，服务端按间隔抽帧。适合随手拍的巡游镜头。
 * - `images`：一组图片（8–16 张）。优势是**可选择**——视频抽帧会抽到字幕帧、
 *   黑帧、特写帧，图片由用户自己挑。实测同一素材：随机 8 张出 12,744 面，
 *   精挑 8 张出 73,528 面。
 *
 * 两者下游完全一致（都是「一串带位姿的 RGB」→ TSDF），所以只在这里分流。
 */
function resolveInput(appRoot, projectName, input) {
  const rawImages = Array.isArray(input?.imageUrls) ? input.imageUrls : []
  const hasVideo = Boolean(String(input?.videoUrl || '').trim())

  if (hasVideo && rawImages.length) {
    throw new Error('视频与图片只能选一种作为输入')
  }

  if (rawImages.length) {
    const files = rawImages.map((u) => resolveMediaFile(appRoot, projectName, u, '图片'))
    if (files.length < MIN_FRAMES) {
      throw new Error(
        `只选了 ${files.length} 张图，至少需要 ${MIN_FRAMES} 张。` +
          '单张没有视差，只会得到一层深度壳；建议 8–16 张覆盖房间各方向。',
      )
    }
    const first = String(rawImages[0] || '').split('?')[0]
    const pm = parseProjectMediaUrl(first)
    return {
      sourceType: 'images',
      files,
      urls: rawImages,
      label: pm ? `${files.length} 张图片` : `${files.length} 张图片`,
    }
  }

  if (!hasVideo) throw new Error('缺少输入：需要一段视频或一组图片')

  const file = resolveMediaFile(appRoot, projectName, input.videoUrl, '视频')
  const pm = parseProjectMediaUrl(String(input.videoUrl).split('?')[0])
  return {
    sourceType: 'video',
    files: [file],
    urls: [String(input.videoUrl).split('?')[0]],
    label: pm ? path.basename(pm.file, path.extname(pm.file)) : '视频',
  }
}

// ---------------------------------------------------------------- 作业

function snapshot(job) {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    error: job.error,
    errorCode: job.errorCode,
    sourceLabel: job.sourceLabel,
    sourceType: job.sourceType,
    imageCount: job.sourceType === 'images' ? job.imageFiles.length : 0,
    glbUrl: job.glbUrl,
    assetTitle: job.assetTitle,
    stats: job.stats,
    frames: job.frames,
    interval: job.interval,
    device: job.device,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    elapsedMs: job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0,
  }
}

function setPhase(job, phase, progress) {
  job.phase = phase
  if (typeof progress === 'number') job.progress = progress
  touchStall(job)
}

function clearTimers(job) {
  if (job.timeoutTimer) clearTimeout(job.timeoutTimer)
  if (job.stallTimer) clearTimeout(job.stallTimer)
  job.timeoutTimer = null
  job.stallTimer = null
}

function touchStall(job) {
  if (job.stallTimer) clearTimeout(job.stallTimer)
  job.stallTimer = setTimeout(() => {
    fail(job, `超过 ${Math.round(STALL_MS / 1000)} 秒没有进展，已中止`, 'timeout')
  }, STALL_MS)
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
  }, 3000)
}

function cleanupDir(job) {
  try {
    fs.rmSync(job.dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

let pumpGuard = false
function pump() {
  if (pumpGuard) return
  pumpGuard = true
  try {
    while (running < CONCURRENCY && queue.length) {
      const job = queue.shift()
      if (job.status !== 'queued') continue
      running++
      void startJob(job)
    }
  } finally {
    pumpGuard = false
  }
}

function fail(job, message, code = 'error') {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return
  clearTimers(job)
  job.status = 'failed'
  job.phase = 'failed'
  job.error = message
  job.errorCode = code
  job.finishedAt = Date.now()
  // 失败不留半成品：作业目录整棵删掉。产物只在成功后从临时目录搬到项目媒体。
  killChild(job)
  cleanupDir(job)
  running = Math.max(0, running - 1)
  pump()
}

function runStage(job, bin, args, handler) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: path.resolve(job.appRoot), env: pythonEnv() })
    job.child = child
    let stderr = ''
    // 缓冲必须在闭包外：一行 JSON 可能被 chunk 切成两半，
    // 放在回调内部每次重置就会丢掉跨 chunk 的行。
    let buffer = ''
    child.stdout?.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (line.startsWith('{')) {
          try {
            handler(JSON.parse(line))
            continue
          } catch {
            /* 不是完整 JSON，落回日志 */
          }
        }
        job.log.push(line)
      }
    })
    child.stderr?.on('data', (c) => {
      stderr = (stderr + c.toString('utf8')).slice(-8000)
    })
    child.on('error', (e) => reject(new Error(`无法启动 ${path.basename(bin)}：${e.message}`)))
    child.on('close', (code) => {
      job.child = null
      if (job.status === 'cancelled') {
        reject(Object.assign(new Error('已取消'), { cancelled: true }))
        return
      }
      // handler 里遇到的错误（例如 Python 报 error 事件）记在 job.stageError 上。
      // 不能依赖 handler 里 throw：那是在事件回调里抛，抛不到这条 Promise 链，
      // 只会变成 uncaughtException。所以统一在这里按 stageError 优先判失败。
      if (job.stageError) {
        reject(new Error(job.stageError))
        return
      }
      if (code !== 0) {
        const tail = (stderr || '')
          .trim()
          .split('\n')
          .filter((l) => l && !/^OMP:|register_resolver|hydra-ecosystem|OmegaConf/.test(l))
          .slice(-3)
          .join(' ')
        reject(new Error(`退出码 ${code}${tail ? `：${tail.slice(0, 500)}` : ''}`))
        return
      }
      resolve()
    })
  })
}

async function startJob(job) {
  const started = Date.now()
  job.startedAt = started
  job.status = 'running'
  job.phase = 'starting'
  job.progress = 0
  job.log = []
  touchStall(job)
  job.timeoutTimer = setTimeout(() => {
    fail(job, `转换超过 ${Math.round(JOB_TIMEOUT_MS / 1000)} 秒仍未完成，已中止`, 'timeout')
  }, JOB_TIMEOUT_MS)

  const appRoot = job.appRoot
  const py = venvPython(appRoot)
  const repo = path.resolve(appRoot)
  const npz = path.join(job.dir, 'result.npz')
  const glb = path.join(job.dir, 'result.glb')

  try {
    setPhase(job, 'infer', 0.05)

    // ---- 阶段 1：抽帧 + 推理 ----
    await runStage(
      job,
      py,
      [
        path.join(repo, 'whitebox', 'da3_infer.py'),
        // 图片模式没有「间隔」概念：用户已经挑好了帧，直接全用
        ...(job.sourceType === 'images'
          ? ['--images', ...job.imageFiles]
          : ['--video', job.videoFile, '--interval', String(job.interval)]),
        '--out', npz,
        '--max-frames', String(job.maxFrames),
        ...(usesBundledRuntime(appRoot)
          ? ['--runtime-root', bundledRuntimePath(appRoot)]
          : ['--state-root', resolveStateRoot(appRoot)]),
      ],
      (event) => {
        if (event.type === 'phase') {
          const map = { sampling: ['infer', 0.08], inference: ['infer', 0.15], saving: ['infer', 0.45] }
          const [phase, progress] = map[event.phase] || ['infer', job.progress]
          setPhase(job, phase, progress)
        } else if (event.type === 'done') {
          job.frames = event.frames
          job.device = event.device
        } else if (event.type === 'error') {
          // 只记录，不 throw：见 runStage 的 close 处理说明
          job.stageError = event.message
          job.errorCode = event.code || 'error'
        }
      },
    )
    if (job.status !== 'running') return

    // ---- 阶段 2：TSDF + 导出 ----
    setPhase(job, 'mesh', 0.55)
    await runStage(
      job,
      py,
      [
        path.join(repo, 'whitebox', 'mesh_whitebox.py'),
        '--npz', npz,
        '--out', glb,
        '--target-size', String(job.targetSize),
        '--resolution', String(job.resolution),
      ],
      (event) => {
        if (event.type === 'phase') {
          const map = { loading: ['mesh', 0.58], fusing: ['mesh', 0.65], exporting: ['mesh', 0.9] }
          const [phase, progress] = map[event.phase] || ['mesh', job.progress]
          setPhase(job, phase, progress)
        } else if (event.type === 'done') {
          job.stats = event
        } else if (event.type === 'error') {
          // 只记录，不 throw：见 runStage 的 close 处理说明
          job.stageError = event.message
          job.errorCode = event.code || 'error'
        }
      },
    )
    if (job.status !== 'running') return

    if (!fs.existsSync(glb)) throw new Error('子进程报告成功但没有产出 GLB')

    // ---- 落盘：临时目录 → 项目媒体 ----
    setPhase(job, 'publish', 0.95)
    const name = `whitebox-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.glb`
    const mediaDir = projectMediaDir(appRoot, job.projectName)
    fs.mkdirSync(mediaDir, { recursive: true })
    const finalPath = path.join(mediaDir, name)
    fs.copyFileSync(glb, finalPath)

    job.glbUrl = projectMediaUrl(job.projectName, name)

    // ---- 登记素材卡 ----
    const title = `白模 · ${job.sourceLabel || '视频'}`
    registerAsset(appRoot, job.projectName, {
      kind: 'model',
      title,
      url: job.glbUrl,
      note: '视频转白模 · 估算尺度 · 稠密重建 · 非语义分割',
    })
    job.assetTitle = title

    job.status = 'done'
    job.phase = 'done'
    job.progress = 1
    job.finishedAt = Date.now()
    clearTimers(job)
    cleanupDir(job)
    running = Math.max(0, running - 1)
    pump()
  } catch (e) {
    if (e?.cancelled) return
    fail(job, e?.message || '转换失败', job.errorCode || 'error')
  }
}

/** 素材卡登记：同 URL 去重更新，与项目里其它资产写入路径一致。 */
function registerAsset(appRoot, projectName, entry) {
  try {
    const root = resolveRoot(appRoot)
    const project = readProject(root, projectName)
    if (!project) return
    const assets = Array.isArray(project.assets) ? [...project.assets] : []
    const idx = assets.findIndex((a) => String(a?.url || '').split('?')[0] === String(entry.url).split('?')[0])
    if (idx >= 0) assets[idx] = { ...assets[idx], ...entry }
    else assets.push({ tags: [], designId: '', ...entry })
    writeProject(root, projectName, { ...project, assets })
  } catch {
    /* 登记失败不影响产物本身，卡片可由用户手工补 */
  }
}

// ---------------------------------------------------------------- 对外接口

/**
 * 提交转换作业。参数非法或环境不合格时直接抛错，**不创建目录、不启动进程**。
 */
export async function submitWhiteboxJob(input, appRoot) {
  const projectName = safeProjectName(String(input?.projectName || ''))
  if (!projectName) throw new Error('缺少项目名称')

  const root = resolveRoot(appRoot)
  const project = readProject(root, projectName)
  if (!project) throw new Error(`项目不存在：${projectName}`)

  const settings = normalizeInput(input)
  const source = resolveInput(appRoot, projectName, input)

  // 环境前置校验：不满足就别建作业，直接给出可操作的错误
  const health = await whiteboxHealth(appRoot)
  if (!health.ok) {
    const err = new Error(health.message || '推理环境不完整，无法转换')
    err.code = 'env-missing'
    err.health = health
    throw err
  }
  if (!weightsReady(appRoot)) {
    const err = new Error('模型权重缺失，请先下载（约 516MB）')
    err.code = 'env-missing'
    err.health = health
    throw err
  }

  const id = `wb${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
  const dir = statePath(appRoot, JOBS_DIR, id)
  fs.mkdirSync(dir, { recursive: true })

  const job = {
    id,
    appRoot,
    projectName,
    dir,
    sourceType: source.sourceType,
    // 视频模式用 videoFile；图片模式用 imageFiles（数组）
    videoFile: source.files[0],
    imageFiles: source.files,
    videoUrl: source.urls[0],
    sourceLabel: source.label,
    interval: settings.interval,
    maxFrames: settings.maxFrames,
    targetSize: settings.targetSize,
    resolution: settings.resolution,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    error: null,
    errorCode: null,
    stageError: null,
    glbUrl: '',
    assetTitle: '',
    stats: null,
    frames: null,
    device: null,
    log: [],
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

export function getWhiteboxJob(id) {
  const job = jobs.get(String(id || ''))
  return job ? snapshot(job) : null
}

export function listWhiteboxJobs() {
  return [...jobs.values()].map(snapshot)
}

export function cancelWhiteboxJob(id) {
  const job = jobs.get(String(id || ''))
  if (!job) return null
  if (job.status !== 'running' && job.status !== 'queued') return snapshot(job)
  clearTimers(job)
  job.status = 'cancelled'
  job.phase = 'cancelled'
  job.error = '用户取消'
  job.errorCode = 'cancelled'
  job.finishedAt = Date.now()
  killChild(job)
  cleanupDir(job)
  running = Math.max(0, running - 1)
  pump()
  return snapshot(job)
}

/** 清掉遗留作业目录（进程崩溃时留下的） */
export function cleanupStaleWhiteboxJobs(appRoot, maxAgeMs = 2 * 60 * 60 * 1000) {
  const dir = statePath(appRoot, JOBS_DIR)
  if (!fs.existsSync(dir)) return 0
  let removed = 0
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    try {
      if (fs.statSync(full).isDirectory() && Date.now() - fs.statSync(full).mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true })
        removed++
      }
    } catch {
      /* ignore */
    }
  }
  return removed
}

export function shutdownWhiteboxJobs() {
  for (const job of jobs.values()) {
    if (job.status === 'running' || job.status === 'queued') {
      clearTimers(job)
      killChild(job)
      cleanupDir(job)
    }
  }
}

export { CONCURRENCY as WHITEBOX_CONCURRENCY, HARD_MAX_FRAMES, MIN_FRAMES, DEFAULT_INTERVAL }
