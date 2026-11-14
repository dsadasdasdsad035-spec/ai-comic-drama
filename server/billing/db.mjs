import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_BILLING_SETTINGS } from './constants.mjs'
import { statePath } from '../paths.mjs'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  disabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  hold_micro INTEGER NOT NULL DEFAULT 0,
  -- 冻结开始时间（epoch ms）：请求被中途掐断（关桌面端、断网）时冻结会悬空，
  -- 超过 HOLD_TTL_MS 后由下一次预留操作回收，避免余额永远显示「被冻结」
  hold_since_ms INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  amount_micro INTEGER NOT NULL,
  balance_after_micro INTEGER NOT NULL,
  ref_type TEXT DEFAULT '',
  ref_id TEXT DEFAULT '',
  meta_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS payment_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  trade_order_id TEXT NOT NULL UNIQUE,
  pack_id TEXT NOT NULL,
  amount_cny REAL NOT NULL,
  credits_micro INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  xunhu_open_order_id TEXT DEFAULT '',
  notify_payload TEXT DEFAULT '',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  cap TEXT NOT NULL,
  model TEXT DEFAULT '',
  spec_key TEXT DEFAULT 'default',
  qty REAL DEFAULT 1,
  total_micro INTEGER NOT NULL,
  trace_id TEXT DEFAULT '',
  meta_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS price_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  spec_key TEXT NOT NULL DEFAULT 'default',
  credits_per_unit REAL NOT NULL,
  synced_at TEXT,
  UNIQUE(model_key, metric, spec_key)
);
CREATE TABLE IF NOT EXISTS billing_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signup_gifts (
  user_id INTEGER PRIMARY KEY,
  granted_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON user_sessions(token_hash);
`

let db = null
let dbFile = ''

/**
 * 老库补列。
 *
 * SQLite 没有 `ADD COLUMN IF NOT EXISTS`，而已经上线的库不会因为 CREATE TABLE IF NOT EXISTS
 * 重新建表，所以新增列必须在这里显式补齐（只加列、不改类型，老数据保持可读）。
 */
function migrateSchema(d) {
  const cols = d.prepare('PRAGMA table_info(wallets)').all().map((r) => String(r.name))
  if (!cols.includes('hold_since_ms')) {
    d.exec('ALTER TABLE wallets ADD COLUMN hold_since_ms INTEGER')
  }
}

export function billingDbPath(appRoot) {
  const env = String(process.env.BILLING_DB_PATH || '').trim()
  if (env) return path.resolve(env)
  const file = statePath(appRoot, 'data', 'billing.sqlite')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  return file
}

export function openBillingDb(appRoot) {
  const target = billingDbPath(appRoot)
  if (db && dbFile === target) return db
  db = null
  dbFile = billingDbPath(appRoot)
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  db = new DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)
  migrateSchema(db)
  const row = db.prepare('SELECT json FROM billing_settings WHERE id = 1').get()
  if (!row) {
    db.prepare('INSERT INTO billing_settings (id, json) VALUES (1, ?)').run(JSON.stringify(DEFAULT_BILLING_SETTINGS))
  }
  return db
}

/** 验证脚本用独立库，不占单例 */
export function openBillingDbFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const d = new DatabaseSync(file)
  d.exec('PRAGMA journal_mode = WAL;')
  d.exec(SCHEMA)
  migrateSchema(d)
  const row = d.prepare('SELECT json FROM billing_settings WHERE id = 1').get()
  if (!row) {
    d.prepare('INSERT INTO billing_settings (id, json) VALUES (1, ?)').run(JSON.stringify(DEFAULT_BILLING_SETTINGS))
  }
  db = d
  dbFile = file
  return d
}

export function getBillingDb() {
  if (!db) throw new Error('billing DB 未打开')
  return db
}

/** node:sqlite DatabaseSync 无 .transaction，用手写 IMMEDIATE 事务 */
export function withBillingTxn(fn) {
  const d = getBillingDb()
  d.exec('BEGIN IMMEDIATE')
  try {
    const out = fn(d)
    d.exec('COMMIT')
    return out
  } catch (e) {
    try {
      d.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  }
}

export function billingDbFile() {
  return dbFile
}