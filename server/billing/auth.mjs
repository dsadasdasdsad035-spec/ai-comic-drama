import crypto from 'node:crypto'
import { getBillingDb } from './db.mjs'
import { hashPassword, verifyPassword } from './password.mjs'
import { getBillingSettings } from './settings.mjs'
import { creditWallet } from './wallet.mjs'
import { sendVerificationEmail } from './email.mjs'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function newToken() {
  return crypto.randomBytes(32).toString('hex')
}

export function registerUser(email, password) {
  const e = String(email || '').trim().toLowerCase()
  const p = String(password || '')
  if (!EMAIL_RE.test(e)) throw new Error('邮箱格式不正确')
  if (p.length < 8) throw new Error('密码至少 8 位')
  const d = getBillingDb()
  const exists = d.prepare('SELECT id FROM users WHERE email = ?').get(e)
  if (exists) throw new Error('该邮箱已注册')
  const info = d
    .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
    .run(e, hashPassword(p))
  const userId = Number(info.lastInsertRowid)
  d.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(userId)
  return { userId, email: e }
}

export function ensureVerifyStore() {
  const d = getBillingDb()
  d.exec(`CREATE TABLE IF NOT EXISTS verify_tokens (
    user_id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`)
}

export function createVerifyToken(userId) {
  ensureVerifyStore()
  const token = newToken()
  const d = getBillingDb()
  const exp = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  d.prepare(
    `INSERT OR REPLACE INTO verify_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
  ).run(userId, hashToken(token), exp)
  return token
}

export function verifyEmail(token) {
  ensureVerifyStore()
  const h = hashToken(token)
  const d = getBillingDb()
  const row = d.prepare('SELECT user_id, expires_at FROM verify_tokens WHERE token_hash = ?').get(h)
  if (!row) throw new Error('验证链接无效或已过期')
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('验证链接已过期')
  const userId = row.user_id
  d.prepare(`UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL`).run(
    userId,
  )
  d.prepare('DELETE FROM verify_tokens WHERE user_id = ?').run(userId)
  grantSignupBonusOnce(userId)
  return userId
}

export function grantSignupBonusOnce(userId) {
  const d = getBillingDb()
  if (d.prepare('SELECT user_id FROM signup_gifts WHERE user_id = ?').get(userId)) return false
  const bonus = Number(getBillingSettings().signup_bonus_credits) || 0
  d.prepare('INSERT INTO signup_gifts (user_id, granted_at) VALUES (?, datetime(\'now\'))').run(userId)
  if (bonus > 0) {
    creditWallet(userId, bonus, 'gift', 'signup', 'signup_bonus', { reason: '注册赠送' })
    return true
  }
  return false
}

export function registerAndNotify(email, password, publicBaseUrl) {
  const { userId, email: e } = registerUser(email, password)
  const token = createVerifyToken(userId)
  const url = `${String(publicBaseUrl || '').replace(/\/+$/, '')}/api/auth/verify?token=${token}`
  sendVerificationEmail(e, url)
  return { userId, email: e }
}

export function loginUser(email, password) {
  const e = String(email || '').trim().toLowerCase()
  const row = getBillingDb().prepare('SELECT * FROM users WHERE email = ?').get(e)
  if (!row || !verifyPassword(password, row.password_hash)) throw new Error('邮箱或密码错误')
  if (row.disabled) throw new Error('账户已禁用')
  const token = newToken()
  const exp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  getBillingDb()
    .prepare('INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(row.id, hashToken(token), exp)
  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      email_verified: Boolean(row.email_verified_at),
    },
  }
}

export function logoutToken(rawToken) {
  if (!rawToken) return
  getBillingDb().prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(rawToken))
}

export function sessionFromToken(rawToken) {
  if (!rawToken) return null
  const row = getBillingDb()
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.email_verified_at, u.disabled
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(rawToken))
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) return null
  if (row.disabled) return null
  return {
    userId: row.user_id,
    email: row.email,
    emailVerified: Boolean(row.email_verified_at),
  }
}

export function isBillingAdmin(email) {
  const admin = String(process.env.BILLING_ADMIN_EMAIL || '').trim().toLowerCase()
  if (!admin) return false
  return String(email || '').trim().toLowerCase() === admin
}

export function parseSessionCookie(cookieHeader) {
  const raw = String(cookieHeader || '')
  const parts = raw.split(';').map((s) => s.trim())
  for (const p of parts) {
    if (p.startsWith('sb_session=')) return decodeURIComponent(p.slice('sb_session='.length))
  }
  return null
}

export function parseBearer(authHeader) {
  const h = String(authHeader || '')
  if (!h.startsWith('Bearer ')) return null
  return h.slice(7).trim()
}