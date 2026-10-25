/**
 * 发布队列：进程内并发 1，任务状态持久化在 publish_jobs。
 *
 * 三条硬规则：
 * 1. 自动触发（auto=true）只能跑草稿，submitFinal 永远不会被调用。
 * 2. 一次只跑一个浏览器任务，失败可归因，也不并发轰平台。
 * 3. 任务结束一定关闭浏览器；超时/取消都落到明确状态。
 */
import { getJob, transitionJob, listJobs, ACTIVE_STATES } from './publish-jobs.mjs'
import { getAdapter, adapterCanExecute, adapterCanPublishFinal } from './publish-adapters.mjs'
import { getAccountInternal, setAccountStatus } from './publish-accounts.mjs'
import { getDeliverable } from './deliverables.mjs'
import { getPlatform } from './publish-platforms.mjs'
import { resolvePublishFile, resolveChrome, sanitizeError } from './publish-utils.mjs'

const queue = []
let running = null
const cancelled = new Set()

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
  const ctx = { videoPath, title: copy.title, description: copy.description, tags: copy.tags }

  transitionJob(root, id, 'uploading', { stage: 'opening', message: '打开创作后台' })
  let browser = null
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
    browser = await openContext(account.profileDir)
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

    transitionJob(root, id, 'uploading', { stage: 'metadata', message: '填写文案与封面' })
    await adapter.fillMetadata(page, ctx)
    await guard()

    transitionJob(root, id, 'uploading', { stage: 'draft', message: '保存草稿' })
    await adapter.saveDraft(page)
    await guard()

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

    transitionJob(root, id, 'awaiting_confirmation', {
      stage: 'draft',
      message: '草稿已保存，请到平台后台确认发布',
    })
  } catch (e) {
    const code = e?.code || 'adapter_error'
    if (code === 'cancelled') {
      try {
        transitionJob(root, id, 'cancelled', { stage: 'cancelled', message: '用户取消' })
      } catch { /* ignore */ }
    } else if (code === 'awaiting_user') {
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
    try {
      await browser?.close()
    } catch {
      /* ignore */
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
    const id = running.id
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
}

export function activeJobCount(root) {
  return listJobs(root, { active: true, limit: 500 }).length
}
