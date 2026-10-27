/**
 * 发布队列：进程内并发 1，任务状态持久化在 publish_jobs。
 *
 * 三条硬规则：
 * 1. 自动触发（auto=true）只能跑草稿，submitFinal 永远不会被调用。
 * 2. 一次只跑一个浏览器任务，失败可归因，也不并发轰平台。
 * 3. 任务结束时，只有「不需要人再操作」的状态才关浏览器。草稿已存、表单已填好、
 *    等待人工验证这些状态必须把窗口留给用户——否则用户刚看到窗口就没了，
 *    「请到平台后台确认发布」也变成一句空话。
 */
import { getJob, transitionJob, updateStage, recordJobCover, appendEvent, listJobs, ACTIVE_STATES } from './publish-jobs.mjs'
import {
  getAdapter,
  adapterCanExecute,
  adapterCanAttachCover,
  adapterCanPublishFinal,
} from './publish-adapters.mjs'
import { getAccountInternal, setAccountStatus } from './publish-accounts.mjs'
import { getDeliverable } from './deliverables.mjs'
import { getPlatform, requiredCoverAspects } from './publish-platforms.mjs'
import { resolvePublishFile, resolveChrome, sanitizeError } from './publish-utils.mjs'

const queue = []
let running = null
const cancelled = new Set()
/**
 * 留给用户操作的浏览器窗口（草稿已存 / 等待人工验证），按 profile 目录登记。
 *
 * 两个原因必须登记：
 * - 不登记就没人知道它们存在，进程退出时变成孤儿 Chrome；
 * - 同一个 profile 不能被两个 Chromium 实例同时打开，用户连续发同平台任务时
 *   必须先关掉旧的窗口，否则新任务会以 ProcessSingleton 失败。
 */
const keepOpenContexts = new Map()

/** 关闭所有留给用户的窗口；服务停止或用户显式清理时调用 */
export async function closeKeptOpenWindows() {
  const list = [...keepOpenContexts.entries()]
  keepOpenContexts.clear()
  for (const [, ctx] of list) {
    try {
      await ctx.close()
    } catch {
      /* ignore */
    }
  }
  return list.length
}

export function keptOpenWindowCount() {
  return keepOpenContexts.size
}

/** 同一个 profile 之前留了窗口就先关掉，否则新的 launch 会撞单例锁 */
async function releaseProfileWindow(profileDir) {
  const key = String(profileDir || '')
  const ctx = keepOpenContexts.get(key)
  if (!ctx) return false
  keepOpenContexts.delete(key)
  try {
    await ctx.close()
  } catch {
    /* 已经关了 */
  }
  return true
}

function nowMs() {
  return Date.now()
}

export function queueDepth() {
  return queue.length + (running ? 1 : 0)
}

export function isRunning(jobId) {
  return running?.id === String(jobId || '')
}

function pruneCancelled() {
  for (const id of cancelled) {
    const ix = queue.findIndex((j) => j.id === id)
    if (ix >= 0) queue.splice(ix, 1)
  }
}

export function enqueue(jobId, opts = {}) {
  const id = String(jobId || '')
  const job = getJob(opts.root, id)
  if (!job) throw new Error('任务不存在')
  if (!ACTIVE_STATES.includes(job.state)) throw new Error('任务已结束')
  if (running?.id === id || queue.some((j) => j.id === id)) return { queued: false, reason: 'duplicate' }
  queue.push({ id, root: opts.root, appRoot: opts.appRoot || opts.root, projectsRoot: opts.projectsRoot || opts.root })
  pump()
  return { queued: true }
}

export function cancel(jobId, root) {
  const id = String(jobId || '')
  cancelled.add(id)
  if (running?.id === id) {
    running.cancelRequested = true
    return { running: true }
  }
  pruneCancelled()
  const job = getJob(root, id)
  if (job && ACTIVE_STATES.includes(job.state)) {
    try {
      transitionJob(root, id, 'cancelled', { stage: 'cancelled', message: '用户取消' })
    } catch {
      /* 状态已变则忽略 */
    }
  }
  return { running: false }
}

function nextItem() {
  pruneCancelled()
  return queue.shift() || null
}

async function loadChromium() {
  const mod = await import('playwright-core')
  return mod.chromium
}

let contextFactory = null

/** 验证脚本注入假的浏览器上下文；生产始终走真实 Chrome */
export function setContextFactoryForTest(fn) {
  contextFactory = typeof fn === 'function' ? fn : null
}

async function openContext(profileDir) {
  if (contextFactory) return contextFactory(profileDir)
  const chromium = await loadChromium()
  const exe = resolveChrome()
  const opts = { headless: false, viewport: null, args: ['--no-first-run', '--no-default-browser-check'] }
  if (exe) opts.executablePath = exe
  else opts.channel = 'chrome'
  return chromium.launchPersistentContext(profileDir, opts)
}

function titleOf(cfg) {
  return String(cfg?.master?.title || '').trim()
}

function descriptionOf(cfg) {
  return String(cfg?.master?.description || '').trim()
}

function overrideFor(cfg, platform) {
  return cfg?.targets?.[platform]?.override || null
}

function copyFor(cfg, platform) {
  const ov = overrideFor(cfg, platform)
  return {
    title: String(ov?.title || titleOf(cfg)),
    description: String(ov?.description || descriptionOf(cfg)),
    tags: Array.isArray(ov?.tags) && ov.tags.length ? ov.tags : Array.isArray(cfg?.master?.tags) ? cfg.master.tags : [],
  }
}

/**
 * 把已准备的封面解析成绝对路径。
 * 配置里只存站内 URL；解析失败（文件丢了、地址非法）时该比例缺席，
 * 由调用方按「没有可用封面」处理，而不是把坏路径交给适配器。
 */
function resolveCovers(appRoot, projectsRoot, config, platform) {
  const covers = {}
  for (const aspect of requiredCoverAspects([platform.id])) {
    const url = config?.cover?.[aspect]
    if (!url) continue
    try {
      covers[aspect] = resolvePublishFile(appRoot, url, { projectsRoot }).path
    } catch {
      /* 预检已报缺失；这里跳过，不让失效路径进任务 */
    }
  }
  return covers
}

/** 平台首选封面：按平台声明的比例顺序取第一个已解析的 */
function preferredCover(platform, covers) {
  for (const aspect of platform.coverAspects) {
    if (covers[aspect]) return covers[aspect]
  }
  return ''
}

async function executeItem(item) {
  const { root, id } = item
  const job = getJob(root, id)
  if (!job) return
  if (cancelled.has(id)) {
    try {
      transitionJob(root, id, 'cancelled', { stage: 'cancelled', message: '用户取消' })
    } catch { /* ignore */ }
    return
  }

  const platform = getPlatform(job.platform)
  const adapter = getAdapter(job.platform)
  if (!adapter || !adapterCanExecute(job.platform, job.mode)) {
    transitionJob(root, id, 'failed', {
      stage: 'adapter',
      errorCode: platform.manualOnly ? 'manual_only' : 'adapter_unverified',
      errorMessage: platform.manualOnly
        ? `${platform.label}当前只能人工发布或导出发布包`
        : `${platform.label}适配器尚未验证，只能保存草稿`,
    })
    return
  }
  // 最终发布必须有已验证适配器；未验证时降级为草稿而不是硬点
  const canFinal = job.mode === 'publish' && adapterCanPublishFinal(job.platform)

  const account = getAccountInternal(root, job.accountId)
  if (!account) {
    transitionJob(root, id, 'failed', {
      stage: 'account',
      errorCode: 'account_missing',
      errorMessage: '账号不存在',
    })
    return
  }
  if (account.status !== 'connected') {
    transitionJob(root, id, 'expired', {
      stage: 'account',
      errorCode: 'account_unusable',
      errorMessage: account.status === 'expired' ? '登录已失效，请重新登录' : '账号状态未知，请先检查登录',
    })
    return
  }

  const deliverable = getDeliverable(root, job.deliverableId)
  if (!deliverable) {
    transitionJob(root, id, 'failed', {
      stage: 'deliverable',
      errorCode: 'deliverable_missing',
      errorMessage: '成片不存在',
    })
    return
  }
  let videoPath = ''
  try {
    videoPath = resolvePublishFile(item.appRoot || root, deliverable.url, { projectsRoot: item.projectsRoot || root }).path
  } catch (e) {
    transitionJob(root, id, 'failed', {
      stage: 'deliverable',
      errorCode: 'deliverable_file_missing',
      errorMessage: sanitizeError(e),
    })
    return
  }

  const copy = copyFor(deliverable.config, job.platform)
  const appRoot = item.appRoot || root
  const projectsRoot = item.projectsRoot || root
  const covers = resolveCovers(appRoot, projectsRoot, deliverable.config, platform)
  const coverPath = preferredCover(platform, covers)
  const canAttachCover = adapterCanAttachCover(platform.id)
  const ctx = {
    videoPath,
    title: copy.title,
    description: copy.description,
    tags: copy.tags,
    coverPath,
    covers,
  }

  transitionJob(root, id, 'uploading', { stage: 'opening', message: '打开创作后台' })
  let browser = null
  /** 需要用户继续在窗口里操作时置 true，finally 就不再关窗口 */
  let keepWindowOpen = false
  const timeoutMs = Number(process.env.PUBLISH_JOB_TIMEOUT_MS) || 15 * 60 * 1000
  const deadline = nowMs() + timeoutMs

  const guard = async () => {
    if (cancelled.has(id) || running?.cancelRequested) {
      const err = new Error('已取消')
      err.code = 'cancelled'
      throw err
    }
    if (nowMs() > deadline) {
      const err = new Error('发布超时')
      err.code = 'timeout'
      throw err
    }
  }

  try {
    // 同一 profile 不能被两个 Chromium 同时打开。若上一轮草稿的窗口还留着，
    // 这里会把它关掉（用户已经发起新任务，旧窗口的价值低于新任务能跑起来）。
    const releasedOldWindow = await releaseProfileWindow(account.profileDir)
    browser = await openContext(account.profileDir)
    if (releasedOldWindow) {
      appendEvent(root, id, 'uploading', 'window_released', '已关闭同账号上一轮保留的窗口，以便开始本次任务')
    }
    const page = browser.pages()[0] || (await browser.newPage())

    await adapter.openBackend(page)
    await guard()
    const session = await adapter.checkSession(page)
    if (session.status === 'expired') {
      setAccountStatus(root, account.id, 'expired', session.message)
      transitionJob(root, id, 'expired', {
        stage: 'session',
        errorCode: 'session_expired',
        errorMessage: session.message || '登录已失效',
      })
      return
    }
    if (session.status === 'unknown') {
      // 页面结构判断不了：不猜成功，也不硬跑
      transitionJob(root, id, 'unknown', {
        stage: 'session',
        errorCode: 'session_unknown',
        errorMessage: session.message || '无法确认登录状态',
      })
      return
    }

    transitionJob(root, id, 'uploading', { stage: 'uploading', message: '上传视频' })
    await adapter.uploadVideo(page, ctx)
    await guard()

    // 封面只在适配器真正能投递时上传；否则只记录结论，不点未知选择器
    let coverAttached = false
    let coverNote = ''
    if (!coverPath) {
      coverNote = platform.coverAspects.length ? '没有已解析的封面文件' : '该平台不需要封面'
    } else if (!canAttachCover) {
      coverNote =
        adapter.coverSupport === 'unsupported'
          ? '该平台不支持自定义封面'
          : '封面步骤尚未在真实登录态验证，需在平台后台手动设置'
      updateStage(root, id, 'cover_skipped', coverNote)
    } else {
      transitionJob(root, id, 'uploading', { stage: 'cover', message: '上传封面' })
      try {
        await adapter.uploadCover(page, ctx)
        coverAttached = true
        coverNote = '封面已上传'
      } catch (e) {
        // 封面失败不改写任务结果：视频与文案已就绪，封面留给人工补
        coverNote = `封面上传失败：${sanitizeError(e?.detail || e?.message || e)}`
        updateStage(root, id, 'cover_failed', coverNote)
      }
      await guard()
    }

    transitionJob(root, id, 'uploading', {
      stage: 'metadata',
      message: coverAttached ? '填写文案（封面已上传）' : '填写文案',
    })
    await adapter.fillMetadata(page, ctx)
    await guard()

    const draftKind = platform.draftKind || 'none'
    transitionJob(root, id, 'uploading', {
      stage: 'draft',
      message: draftKind === 'none' ? '填好表单（该平台没有草稿）' : '保存草稿',
    })
    await adapter.saveDraft(page)
    await guard()

    // 封面结论写进 payload：界面与后续排查都能看到「封面到底传没传」
    recordJobCover(root, id, coverAttached, coverNote)

    // 自动模式到此为止；只有用户明确要求 publish 才继续点终发布
    if (canFinal && !running?.auto) {
      transitionJob(root, id, 'awaiting_confirmation', { stage: 'confirm', message: '等待确认最终发布' })
      try {
        await adapter.submitFinal(page)
        const status = await adapter.readStatus(page)
        transitionJob(root, id, 'published', {
          stage: 'published',
          workUrl: status?.url || '',
          message: '已提交并确认发布',
        })
      } catch (e) {
        const code = e?.code || 'submit_failed'
        if (code === 'awaiting_user') {
          keepWindowOpen = true
          transitionJob(root, id, 'awaiting_user', {
            stage: e.stage || 'verify',
            errorCode: code,
            errorMessage: '需要人工完成验证',
          })
        } else {
          transitionJob(root, id, 'unknown', {
            stage: e.stage || 'submit',
            errorCode: code,
            errorMessage: sanitizeError(e?.detail || e?.message || '提交结果未知'),
          })
        }
      }
      return
    }

    // 草稿阶段的三种结果都需要人接着在窗口里操作，窗口必须留着
    keepWindowOpen = true
    transitionJob(root, id, 'awaiting_confirmation', {
      stage: 'draft',
      message:
        draftKind === 'local'
          ? '草稿存在本机浏览器内，清空数据会丢失；请在已打开的窗口里确认发布'
          : draftKind === 'none'
            ? '表单已填好但该平台不保存草稿，请立即在已打开的窗口点击发布'
            : '草稿已保存，请在已打开的窗口或平台后台确认发布',
    })
  } catch (e) {
    const code = e?.code || 'adapter_error'
    if (code === 'cancelled') {
      try {
        transitionJob(root, id, 'cancelled', { stage: 'cancelled', message: '用户取消' })
      } catch { /* ignore */ }
    } else if (code === 'awaiting_user') {
      keepWindowOpen = true
      try {
        transitionJob(root, id, 'awaiting_user', {
          stage: e.stage || 'verify',
          errorCode: code,
          errorMessage: '需要人工完成验证码或二次验证',
        })
      } catch { /* ignore */ }
    } else if (code === 'timeout') {
      try {
        transitionJob(root, id, 'failed', {
          stage: e.stage || 'timeout',
          errorCode: 'timeout',
          errorMessage: '发布超时，请重试',
        })
      } catch { /* ignore */ }
    } else {
      try {
        transitionJob(root, id, 'failed', {
          stage: e.stage || 'unknown',
          errorCode: code,
          errorMessage: sanitizeError(e?.detail || e?.message || '发布失败'),
        })
      } catch { /* ignore */ }
    }
  } finally {
    if (keepWindowOpen && browser) {
      // 草稿/验证场景：把窗口留给用户，并登记下来供后续关闭
      const ctx = browser
      const key = String(account.profileDir || '')
      keepOpenContexts.set(key, ctx)
      appendEvent(root, id, 'awaiting_confirmation', 'window_kept', '浏览器窗口保持打开，供人工确认发布')
      // 用户亲自关掉窗口时把它从登记表里摘掉，避免泄漏
      try {
        ctx.on?.('close', () => {
          if (keepOpenContexts.get(key) === ctx) keepOpenContexts.delete(key)
        })
      } catch {
        /* 事件不可用就算了 */
      }
    } else {
      try {
        await browser?.close()
      } catch {
        /* ignore */
      }
    }
  }
}

async function pump() {
  if (running) return
  const item = nextItem()
  if (!item) return
  running = { id: item.id, cancelRequested: false, auto: Boolean(getJob(item.root, item.id)?.payload?.auto) }
  try {
    await executeItem(item)
  } catch (e) {
    console.warn('[publish] 任务执行异常:', sanitizeError(e))
    // 兜底：异常不能让任务永远停在排队/上传中
    try {
      const cur = getJob(item.root, item.id)
      if (cur && ACTIVE_STATES.includes(cur.state)) {
        transitionJob(item.root, item.id, 'failed', {
          stage: 'internal',
          errorCode: 'internal_error',
          errorMessage: sanitizeError(e),
        })
      }
    } catch {
      /* 状态已变则忽略 */
    }
  } finally {
    // running 可能已被 resetQueueForTest 清空（验证脚本会在任务收尾时重置）
    const id = running?.id || item.id
    running = null
    cancelled.delete(id)
    if (queue.length) void pump()
  }
}

/** 启动时清空队列并恢复中断任务；调用一次即可 */
export function startQueue(root) {
  queue.length = 0
  running = null
  return root
}

export function resetQueueForTest() {
  queue.length = 0
  running = null
  cancelled.clear()
  contextFactory = null
  keepOpenContexts.clear()
}

export function activeJobCount(root) {
  return listJobs(root, { active: true, limit: 500 }).length
}
