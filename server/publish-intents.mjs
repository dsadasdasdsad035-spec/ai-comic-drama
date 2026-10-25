/**
 * 提交意图（publish_intents）：助手只能暂存，不能提交。
 *
 * 三条硬规则：
 * 1. 暂存只写一行 intent，不创建任务、不入队、不碰幂等键。
 * 2. 确认只认行内 config 快照；请求体里再传的配置只用来算 hash 比对，
 *    不一致直接拒绝，防止按用户已经改掉的旧配置执行。
 * 3. assistant 来源在服务端收窄：不能是发布（publish），也没有本机浏览器时
 *    不能是草稿。提示词和前端都拦不住的情况下这里仍然拒绝。
 */
import crypto from 'node:crypto'
import { openDatabase } from './db.mjs'
import { getPlatform } from './publish-platforms.mjs'
import { normalizeDeliverableConfig, getDeliverable } from './deliverables.mjs'
import { createJob } from './publish-jobs.mjs'
import { listAccounts } from './publish-accounts.mjs'
import { runPreflight } from './publish-preflight.mjs'
import { chromeAvailable, sanitizeError } from './publish-utils.mjs'

/** intent 状态：只有 confirmed 会产生任务；expired/cancelled 都是终态 */
export const INTENT_STATES = ['staged', 'confirmed', 'cancelled', 'expired']

/** 暂存有效期；超过后即使配置没变也要重新生成 */
export const INTENT_TTL_MS = 30 * 60 * 1000

/** 已结束 intent 的保留时长；只用于清理，不影响业务 */
export const INTENT_GARBAGE_MS = 24 * 60 * 60 * 1000

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

/** 稳定序列化：对象键按字典序，保证同一份配置永远得到同一个 hash */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

export function configHash(config) {
  return crypto.createHash('sha256').update(stableStringify(config)).digest('hex')
}

export function newIntentId() {
  return `pi-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

/** 规范化 targets：只保留已知平台、已知方式；同一平台只留第一条 */
export function normalizeTargets(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const platform = String(item?.platform || '').trim()
    if (!platform || seen.has(platform)) continue
    try {
      getPlatform(platform)
    } catch {
      continue
    }
    const mode = item?.mode === 'publish' || item?.mode === 'package' ? item.mode : 'draft'
    seen.add(platform)
    out.push({ platform, accountId: String(item?.accountId || '').trim().slice(0, 80), mode })
  }
  return out
}

/**
 * 来源收窄：这些拒绝必须在服务端，而不是靠提示词。
 * 返回 null 表示允许，返回 {code, message} 表示拒绝。
 */
export function intentSourceError({ source, targets }) {
  if (source !== 'assistant') return null
  if (targets.some((t) => t.mode === 'publish')) {
    return {
      code: 'assistant_cannot_publish',
      message: '助手不能代为公开发布，只能保存草稿或导出发布包',
    }
  }
  if (!chromeAvailable() && targets.some((t) => t.mode === 'draft')) {
    return {
      code: 'no_browser',
      message: '当前环境没有可用的本机浏览器，助手只能准备发布包',
    }
  }
  return null
}

function rowToIntent(row) {
  if (!row) return null
  return {
    id: row.id,
    deliverableId: row.deliverable_id,
    project: row.project,
    episode: Number(row.episode) || 0,
    source: row.source || 'assistant',
    hash: row.config_hash,
    config: parseJson(row.config, {}),
    targets: parseJson(row.targets, []),
    preflight: parseJson(row.preflight, {}),
    state: INTENT_STATES.includes(row.state) ? row.state : 'staged',
    jobIds: parseJson(row.job_ids, []),
    reason: row.reason || '',
    createdAt: row.created_at || '',
    expiresAt: row.expires_at || '',
    confirmedAt: row.confirmed_at || '',
  }
}

export function getIntent(root, id) {
  const d = open(root)
  return rowToIntent(d.prepare('SELECT * FROM publish_intents WHERE id = ?').get(String(id || '')))
}

function markIntent(root, id, state, extra = {}) {
  const d = open(root)
  d.prepare(`UPDATE publish_intents SET state = ?, reason = ?, job_ids = ?, confirmed_at = ? WHERE id = ?`).run(
    state,
    sanitizeError(extra.reason || ''),
    JSON.stringify(extra.jobIds || []),
    extra.confirmedAt || '',
    String(id || ''),
  )
  return getIntent(root, id)
}

/**
 * 用同一份预检实现跑 intent，避免确认路径与路由规则漂移。
 * appRoot 是应用根（`/exports/` 相对它解析），root 是项目库根；
 * 两者不是一回事，混用会让成片文件判定永远失败。
 */
function preflightFor(appRoot, root, deliverable, targets, config) {
  const accounts = new Map(listAccounts(root).map((a) => [a.id, a]))
  return {
    preflight: runPreflight({
      appRoot,
      projectsRoot: root,
      deliverable,
      targets,
      config,
      accounts,
    }),
    accounts,
  }
}

/**
 * 暂存一次提交意图。
 * 只算 hash + 跑预检 + 写一行；不创建任务。
 */
export function stageIntent(root, input = {}) {
  const deliverable = getDeliverable(root, String(input.deliverableId || ''))
  if (!deliverable) {
    const err = new Error('成片不存在')
    err.code = 'deliverable_missing'
    throw err
  }
  const source = input.source === 'assistant' ? 'assistant' : 'manual'
  const config = normalizeDeliverableConfig(input.config || deliverable.config)
  const targets = normalizeTargets(input.targets)
  if (!targets.length) {
    const err = new Error('至少需要一个提交目标')
    err.code = 'no_targets'
    throw err
  }
  const rejected = intentSourceError({ source, targets })
  if (rejected) {
    const err = new Error(rejected.message)
    err.code = rejected.code
    throw err
  }
  const { preflight } = preflightFor(input.appRoot || root, root, deliverable, targets, config)
  const id = newIntentId()
  const at = nowIso()
  const expires = new Date(Date.now() + INTENT_TTL_MS).toISOString()
  const d = open(root)
  d.prepare(
    `INSERT INTO publish_intents
     (id,deliverable_id,project,episode,source,config_hash,config,targets,preflight,state,job_ids,reason,created_at,expires_at,confirmed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    deliverable.id,
    deliverable.project,
    Number(deliverable.episode) || 0,
    source,
    configHash(config),
    JSON.stringify(config),
    JSON.stringify(targets),
    JSON.stringify(preflight),
    'staged',
    '[]',
    '',
    at,
    expires,
    '',
  )
  return getIntent(root, id)
}

/**
 * 确认提交：只认行内快照。
 * 三种拒绝都要落 expired 并给出可读原因，且不产生任何任务。
 * 已确认的 intent 再确认一次直接返回已有任务，不重复创建。
 */
export function confirmIntent(root, id, opts = {}) {
  const intent = getIntent(root, id)
  if (!intent) {
    const err = new Error('提交意图不存在或已过期')
    err.code = 'intent_missing'
    throw err
  }
  if (intent.state === 'confirmed') {
    return { intent, jobs: intent.jobIds.map((jobId) => ({ id: jobId })), reused: true }
  }
  if (intent.state !== 'staged') {
    const err = new Error('这份提交意图已经结束，请重新生成')
    err.code = 'intent_closed'
    throw err
  }
  // 请求方带了配置时，只用来证明「不是旧快照」，绝不采用其中的值
  if (opts.config) {
    const requestHash = configHash(normalizeDeliverableConfig(opts.config))
    if (requestHash !== intent.hash) {
      markIntent(root, intent.id, 'expired', { reason: '配置已变化，这份待确认已过期' })
      const err = new Error('配置已变化，这份待确认已过期')
      err.code = 'intent_stale'
      throw err
    }
  }
  if (intent.expiresAt && Date.now() > Date.parse(intent.expiresAt)) {
    markIntent(root, intent.id, 'expired', { reason: '提交意图已过期' })
    const err = new Error('这份提交意图已过期，请重新生成')
    err.code = 'intent_expired'
    throw err
  }
  const rejected = intentSourceError({ source: intent.source, targets: intent.targets })
  if (rejected) {
    markIntent(root, intent.id, 'expired', { reason: rejected.message })
    const err = new Error(rejected.message)
    err.code = rejected.code
    throw err
  }
  const deliverable = getDeliverable(root, intent.deliverableId)
  if (!deliverable) {
    markIntent(root, intent.id, 'expired', { reason: '成片已不存在' })
    const err = new Error('成片已不存在')
    err.code = 'deliverable_missing'
    throw err
  }
  const { preflight } = preflightFor(opts.appRoot || root, root, deliverable, intent.targets, intent.config)
  if (!preflight.ok) {
    const reason = preflight.blocking.map((b) => b.message).join('；').slice(0, 300)
    markIntent(root, intent.id, 'expired', { reason })
    const err = new Error(`预检未通过：${reason}`)
    err.code = 'preflight_failed'
    err.preflight = preflight
    throw err
  }

  const jobIds = []
  const created = []
  for (const t of intent.targets) {
    if (t.mode === 'package') continue
    const r = createJob(root, {
      deliverableId: deliverable.id,
      project: deliverable.project,
      episode: deliverable.episode,
      platform: t.platform,
      accountId: t.accountId || '',
      mode: t.mode || 'draft',
      deliverableUrl: deliverable.url,
      payload: {
        source: intent.source,
        intentId: intent.id,
        aiGenerated: Boolean(intent.config?.master?.aiGenerated),
      },
      republish: false,
    })
    if (r.job) {
      jobIds.push(r.job.id)
      created.push({ ...r.job, reused: r.reused })
    }
  }
  const next = markIntent(root, intent.id, 'confirmed', { jobIds, confirmedAt: nowIso() })
  return { intent: next, jobs: created, reused: false }
}

export function cancelIntent(root, id) {
  const intent = getIntent(root, id)
  if (!intent) return null
  if (intent.state === 'staged') return markIntent(root, intent.id, 'cancelled', { reason: '用户取消' })
  return intent
}

/** 把超过有效期的 staged 标成 expired；启动时调用一次 */
export function expireStaleIntents(root) {
  const d = open(root)
  const res = d
    .prepare(`UPDATE publish_intents SET state = 'expired', reason = ? WHERE state = 'staged' AND expires_at < ?`)
    .run('提交意图已过期', nowIso())
  return { expired: Number(res.changes) || 0 }
}

/** 清理已结束的 intent；staged 一律不动 */
export function sweepIntents(root, opts = {}) {
  const keepMs = Number(opts.keepMs) || INTENT_GARBAGE_MS
  const cutoff = new Date(Date.now() - keepMs).toISOString()
  const d = open(root)
  const res = d
    .prepare(`DELETE FROM publish_intents WHERE state IN ('confirmed','cancelled','expired') AND created_at < ?`)
    .run(cutoff)
  return { removed: Number(res.changes) || 0 }
}

export function resetIntentsForTest() {
  conn = null
  connRoot = ''
}
