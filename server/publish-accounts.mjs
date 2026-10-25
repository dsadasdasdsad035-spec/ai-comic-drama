/**
 * 平台账号存储：只保存「平台 + 本机浏览器 profile 目录 + 状态」。
 *
 * 为什么不在数据库存 cookie / storageState：
 * - 登录态本来就是浏览器 profile 的一部分，再导出一次等于多一份明文凭据；
 * - profile 目录权限 0700 且不进仓库，是最小的可信边界；
 * - 列表与错误信息都不返回目录绝对路径，避免界面把 secrets 带出去。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openDatabase, safeProjectName } from './db.mjs'
import { profilesRoot, sanitizeError } from './publish-utils.mjs'
import { getPlatform } from './publish-platforms.mjs'

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

export const ACCOUNT_STATUS = ['connected', 'expired', 'unknown', 'disabled']

function nowIso() {
  return new Date().toISOString()
}

export function newAccountId() {
  return `pa-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function safeAccountId(id) {
  const v = String(id || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v)) throw new Error(`账号 id 不合法：${v || '(空)'}`)
  return v
}

/** 对外视图：不带 profile 目录、不带任何凭据 */
function publicAccount(row) {
  if (!row) return null
  return {
    id: row.id,
    platform: row.platform,
    label: row.label || '',
    status: ACCOUNT_STATUS.includes(row.status) ? row.status : 'unknown',
    lastCheckedAt: row.last_checked_at || '',
    autoDraft: Boolean(row.auto_draft),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

export function listAccounts(root, opts = {}) {
  const d = open(root)
  const platform = String(opts.platform || '').trim()
  const rows = platform
    ? d.prepare('SELECT * FROM publish_accounts WHERE platform = ? ORDER BY created_at, id').all(platform)
    : d.prepare('SELECT * FROM publish_accounts ORDER BY platform, created_at, id').all()
  return rows.map(publicAccount)
}

export function getAccount(root, id) {
  const d = open(root)
  const row = d.prepare('SELECT * FROM publish_accounts WHERE id = ?').get(String(id || ''))
  return publicAccount(row)
}

/** 内部用：执行适配器时才能拿到 profile 目录 */
export function getAccountInternal(root, id) {
  const d = open(root)
  const row = d.prepare('SELECT * FROM publish_accounts WHERE id = ?').get(String(id || ''))
  if (!row) return null
  return {
    ...publicAccount(row),
    profileDir: row.profile_dir,
  }
}

export function accountProfileDir(appRoot, accountId) {
  return path.join(profilesRoot(appRoot), safeAccountId(accountId))
}

/**
 * 创建或更新账号绑定。同一平台 + 同一 profile 视为同一账号的重新登录，
 * 这样重新扫码不会堆出一串重复账号。
 */
export function upsertAccount(appRoot, input = {}) {
  const d = open(appRoot)
  const platform = getPlatform(input.platform).id
  const id = input.id ? safeAccountId(input.id) : newAccountId()
  const dir = accountProfileDir(appRoot, id)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* 某些文件系统不支持，忽略 */
  }
  const at = nowIso()
  const label = String(input.label || '').slice(0, 80)
  const status = ACCOUNT_STATUS.includes(input.status) ? input.status : 'connected'
  const existing = d.prepare('SELECT id FROM publish_accounts WHERE id = ?').get(id)
  if (existing) {
    d.prepare(
      `UPDATE publish_accounts SET label = ?, status = ?, last_checked_at = ?, auto_draft = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      label || String(input.keepLabel || ''),
      status,
      at,
      input.autoDraft == null ? Number(!!input.keepAutoDraft) : Number(Boolean(input.autoDraft)),
      at,
      id,
    )
  } else {
    d.prepare(
      `INSERT INTO publish_accounts (id,platform,label,profile_dir,status,last_checked_at,auto_draft,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, platform, label, dir, status, at, Number(Boolean(input.autoDraft)), at, at)
  }
  return getAccount(appRoot, id)
}

export function setAccountStatus(appRoot, id, status, message = '') {
  const d = open(appRoot)
  const next = ACCOUNT_STATUS.includes(status) ? status : 'unknown'
  d.prepare('UPDATE publish_accounts SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?').run(
    next,
    nowIso(),
    nowIso(),
    safeAccountId(id),
  )
  return { account: getAccount(appRoot, id), message: sanitizeError(message) }
}

export function setAutoDraft(appRoot, id, enabled) {
  const d = open(appRoot)
  d.prepare('UPDATE publish_accounts SET auto_draft = ?, updated_at = ? WHERE id = ?').run(
    Number(Boolean(enabled)),
    nowIso(),
    safeAccountId(id),
  )
  return getAccount(appRoot, id)
}

export function deleteAccount(appRoot, id) {
  const d = open(appRoot)
  const safe = safeAccountId(id)
  const row = d.prepare('SELECT profile_dir FROM publish_accounts WHERE id = ?').get(safe)
  const res = d.prepare('DELETE FROM publish_accounts WHERE id = ?').run(safe)
  if (row?.profile_dir) {
    try {
      fs.rmSync(String(row.profile_dir), { recursive: true, force: true })
    } catch {
      /* 目录删不掉不影响账号删除 */
    }
  }
  return Number(res.changes) > 0
}

/** 账号可用 = connected；expired / unknown 都算不可用 */
export function accountUsable(account) {
  return Boolean(account && account.status === 'connected')
}

/** 便于路由层：项目名参数校验（账号本身不按项目隔离，但验证脚本会传项目根） */
export function assertProjectRoot(appRoot) {
  return safeProjectName(path.basename(String(appRoot || '')) || 'root')
}
