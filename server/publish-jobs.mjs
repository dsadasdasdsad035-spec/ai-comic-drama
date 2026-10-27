/**
 * 发布任务存储与状态机。
 *
 * 关键约束：
 * - 一个「平台目标」是一条 job；一条成片发三个平台就是三条 job。
 * - 幂等键 = deliverableId|platform|accountId；有活动任务就复用。
 * - 只有显式「重新发布」才 run_no+1 建新 job，旧记录保留。
 * - 状态迁移按表校验；终态不能被自动改回进行中。
 * - 服务重启把未完成任务标 unknown，绝不自动续跑。
 */
import crypto from 'node:crypto'
import { openDatabase } from './db.mjs'
import { sanitizeError } from './publish-utils.mjs'

let conn = null
let connRoot = ''

function open(root) {
  const dir = String(root || '')
  if (!dir) throw new Error('缺少项目根目录')
  if (conn && connRoot === dir) return conn
  conn = openDatabase(dir)
  connRoot = dir
  return conn
}

export const JOB_STATES = [
  'draft',
  'queued',
  'uploading',
  'awaiting_user',
  'awaiting_confirmation',
  'submitted',
  'published',
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'unknown',
]

/** 合法迁移：from → 允许的 to[] */
export const TRANSITIONS = {
  draft: ['queued', 'cancelled'],
  queued: ['uploading', 'cancelled', 'failed', 'expired', 'unknown'],
  uploading: ['awaiting_user', 'awaiting_confirmation', 'submitted', 'published', 'failed', 'cancelled', 'expired', 'unknown'],
  awaiting_user: ['uploading', 'awaiting_confirmation', 'failed', 'cancelled', 'expired', 'unknown'],
  awaiting_confirmation: ['published', 'submitted', 'cancelled', 'unknown'],
  submitted: ['published', 'rejected', 'unknown'],
  published: [],
  rejected: [],
  failed: [],
  cancelled: [],
  expired: [],
  unknown: [],
}

/** 可重试状态：失败的、登录失效的、状态未知的 */
export const RETRYABLE_STATES = ['failed', 'expired', 'unknown']

export const ACTIVE_STATES = ['draft', 'queued', 'uploading', 'awaiting_user', 'awaiting_confirmation', 'submitted']

export function isActiveState(state) {
  return ACTIVE_STATES.includes(String(state || ''))
}

export function canTransition(from, to) {
  const allowed = TRANSITIONS[String(from || '')]
  return Array.isArray(allowed) && allowed.includes(String(to || ''))
}

export function assertTransition(from, to) {
  const a = String(from || '')
  const b = String(to || '')
  if (!JOB_STATES.includes(a)) throw new Error(`未知任务状态：${a || '(空)'}`)
  if (!JOB_STATES.includes(b)) throw new Error(`未知目标状态：${b || '(空)'}`)
  if (!canTransition(a, b)) throw new Error(`不允许的状态迁移：${a} → ${b}`)
  return true
}

export function newJobId() {
  return `pj-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

export function idempotencyKey(deliverableId, platform, accountId) {
  return `${String(deliverableId || '')}|${String(platform || '')}|${String(accountId || '')}`
}

function nowIso() {
  return new Date().toISOString()
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw ?? '')
  } catch {
    return fallback
  }
}

function rowToJob(row) {
  if (!row) return null
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    runNo: Number(row.run_no) || 1,
    deliverableId: row.deliverable_id,
    project: row.project,
    episode: Number(row.episode) || 0,
    platform: row.platform,
    accountId: row.account_id || '',
    mode: row.mode,
    state: row.state,
    stage: row.stage || '',
    errorCode: row.error_code || '',
    errorMessage: row.error_message || '',
    workUrl: row.work_url || '',
    deliverableUrl: row.deliverable_url || '',
    payload: parseJson(row.payload, {}),
    createdAt: row.created_at || '',
    startedAt: row.started_at || '',
    endedAt: row.ended_at || '',
  }
}

export function appendEvent(root, jobId, state, stage, message) {
  const d = open(root)
  d.prepare('INSERT INTO publish_events (job_id,state,stage,message,created_at) VALUES (?,?,?,?,?)').run(
    String(jobId || ''),
    String(state || ''),
    String(stage || ''),
    sanitizeError(message),
    nowIso(),
  )
}

export function listEvents(root, jobId) {
  const d = open(root)
  return d
    .prepare('SELECT * FROM publish_events WHERE job_id = ? ORDER BY id')
    .all(String(jobId || ''))
    .map((r) => ({
      id: Number(r.id),
      state: r.state || '',
      stage: r.stage || '',
      message: r.message || '',
      createdAt: r.created_at || '',
    }))
}

export function getJob(root, id) {
  const d = open(root)
  return rowToJob(d.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(String(id || '')))
}

export function getJobWithEvents(root, id) {
  const job = getJob(root, id)
  if (!job) return null
  return { ...job, events: listEvents(root, id) }
}

export function findActiveJob(root, key) {
  const d = open(root)
  const placeholders = ACTIVE_STATES.map(() => '?').join(',')
  const row = d
    .prepare(
      `SELECT * FROM publish_jobs WHERE idempotency_key = ? AND state IN (${placeholders})
       ORDER BY run_no DESC LIMIT 1`,
    )
    .get(String(key || ''), ...ACTIVE_STATES)
  return rowToJob(row)
}

export function listJobs(root, opts = {}) {
  const d = open(root)
  const clauses = []
  const args = []
  if (opts.project) {
    clauses.push('project = ?')
    args.push(String(opts.project))
  }
  if (Number(opts.episode) > 0) {
    clauses.push('episode = ?')
    args.push(Number(opts.episode))
  }
  if (opts.deliverableId) {
    clauses.push('deliverable_id = ?')
    args.push(String(opts.deliverableId))
  }
  if (opts.active) {
    clauses.push(`state IN (${ACTIVE_STATES.map(() => '?').join(',')})`)
    args.push(...ACTIVE_STATES)
  }
  if (opts.states?.length) {
    clauses.push(`state IN (${opts.states.map(() => '?').join(',')})`)
    args.push(...opts.states)
  }
  const limit = Math.min(500, Math.max(1, Number(opts.limit) || 200))
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = d
    .prepare(`SELECT * FROM publish_jobs ${where} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...args, limit)
  return rows.map(rowToJob)
}

/**
 * 创建任务；默认幂等复用活动任务。
 * republish=true 时忽略活动任务，run_no + 1 建新记录。
 */
export function createJob(root, input = {}) {
  const d = open(root)
  const key = idempotencyKey(input.deliverableId, input.platform, input.accountId)
  if (!input.republish) {
    const existing = findActiveJob(root, key)
    if (existing) return { job: existing, reused: true }
  }
  const maxRun = Number(
    d.prepare('SELECT MAX(run_no) AS r FROM publish_jobs WHERE idempotency_key = ?').get(key)?.r || 0,
  )
  const id = newJobId()
  const at = nowIso()
  const mode = input.mode === 'publish' || input.mode === 'package' ? input.mode : 'draft'
  d.prepare(
    `INSERT INTO publish_jobs
     (id,idempotency_key,run_no,deliverable_id,project,episode,platform,account_id,mode,state,stage,
      error_code,error_message,work_url,deliverable_url,payload,created_at,started_at,ended_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    key,
    maxRun + 1,
    String(input.deliverableId || ''),
    String(input.project || ''),
    Number(input.episode) || 0,
    String(input.platform || ''),
    String(input.accountId || ''),
    mode,
    'queued',
    'queued',
    '',
    '',
    '',
    String(input.deliverableUrl || ''),
    JSON.stringify(input.payload || {}),
    at,
    '',
    '',
  )
  appendEvent(root, id, 'queued', 'queued', '任务已创建')
  return { job: getJob(root, id), reused: false }
}

/** 同状态只推进阶段：状态机不为自迁移开口子，但阶段更新是合法的 */
export function updateStage(root, id, stage, message = '') {
  const d = open(root)
  const cur = getJob(root, id)
  if (!cur) throw new Error('任务不存在')
  d.prepare('UPDATE publish_jobs SET stage = ? WHERE id = ?').run(String(stage || ''), String(id))
  appendEvent(root, id, cur.state, stage, message)
  return getJob(root, id)
}

/**
 * 记录封面投递结论：写进 payload 与一条事件。
 * 封面是否真的上传过必须以执行结果为准，不能靠阶段文案推测。
 */
export function recordJobCover(root, id, attached, note = '') {
  const d = open(root)
  const cur = getJob(root, id)
  if (!cur) throw new Error('任务不存在')
  const payload = { ...(cur.payload || {}), coverAttached: Boolean(attached), coverNote: sanitizeError(note) }
  d.prepare('UPDATE publish_jobs SET payload = ? WHERE id = ?').run(JSON.stringify(payload), String(id))
  appendEvent(
    root,
    id,
    cur.state,
    attached ? 'cover' : 'cover_skipped',
    payload.coverNote || (attached ? '封面已上传' : '封面未上传'),
  )
  return getJob(root, id)
}

/** 迁移状态；非法迁移直接抛错，避免把 published 悄悄改回 uploading */
export function transitionJob(root, id, next, opts = {}) {
  const d = open(root)
  const cur = getJob(root, id)
  if (!cur) throw new Error('任务不存在')
  if (cur.state === next) return updateStage(root, id, opts.stage ?? cur.stage, opts.message || '')
  assertTransition(cur.state, next)
  const at = nowIso()
  const started = cur.startedAt || (next === 'uploading' ? at : '')
  const ended = ['published', 'rejected', 'failed', 'cancelled', 'expired', 'unknown'].includes(next) ? at : ''
  d.prepare(
    `UPDATE publish_jobs SET state = ?, stage = ?, error_code = ?, error_message = ?, work_url = ?,
       started_at = ?, ended_at = ? WHERE id = ?`,
  ).run(
    next,
    opts.stage == null ? cur.stage : String(opts.stage),
    opts.errorCode == null ? cur.errorCode : String(opts.errorCode),
    opts.errorMessage == null ? cur.errorMessage : sanitizeError(opts.errorMessage),
    opts.workUrl == null ? cur.workUrl : String(opts.workUrl),
    started,
    ended,
    String(id),
  )
  appendEvent(root, id, next, opts.stage == null ? cur.stage : String(opts.stage), opts.message || '')
  return getJob(root, id)
}

export function cancelJob(root, id) {
  const cur = getJob(root, id)
  if (!cur) throw new Error('任务不存在')
  if (!isActiveState(cur.state)) throw new Error('任务已结束，无法取消')
  return transitionJob(root, id, 'cancelled', { stage: 'cancelled', message: '用户取消' })
}

export function markPublished(root, id, workUrl = '') {
  const cur = getJob(root, id)
  if (!cur) throw new Error('任务不存在')
  if (!['awaiting_confirmation', 'submitted'].includes(cur.state)) {
    throw new Error('当前状态不能标记为已发布')
  }
  return transitionJob(root, id, 'published', {
    stage: 'published',
    workUrl: workUrl || cur.workUrl,
    message: '人工确认已发布',
  })
}

/**
 * 服务重启恢复：未完成任务一律 unknown，写事件，不自动重跑。
 * 返回被处理的数量，便于启动日志。
 */
export function recoverInterruptedJobs(root) {
  const d = open(root)
  const rows = d
    .prepare(`SELECT id, state FROM publish_jobs WHERE state IN ('queued','uploading','awaiting_user')`)
    .all()
  for (const row of rows) {
    try {
      transitionJob(root, row.id, 'unknown', {
        stage: 'interrupted',
        errorCode: 'server_restart',
        errorMessage: '服务重启，执行状态未知',
        message: '服务重启，任务未被自动续跑',
      })
    } catch {
      /* 状态已被别处改掉就跳过 */
    }
  }
  return rows.length
}

export function jobSummary(root, opts = {}) {
  const jobs = listJobs(root, { ...opts, limit: 500 })
  const running = jobs.filter((j) => ['queued', 'uploading', 'awaiting_user'].includes(j.state)).length
  const failed = jobs.filter((j) => ['failed', 'expired'].includes(j.state)).length
  const unknown = jobs.filter((j) => j.state === 'unknown').length
  return { running, failed, unknown, total: jobs.length }
}
