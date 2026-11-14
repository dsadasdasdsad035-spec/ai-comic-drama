import { creditsFromMicro, microFromCredits } from './constants.mjs'
import { getBillingDb, withBillingTxn } from './db.mjs'

/**
 * 悬空冻结的回收时限。
 *
 * 冻结依赖「请求结束」来释放：桌面端被关掉、断网、代理超时都会让请求中途消失，
 * 于是 hold_micro 永远留在库里，用户看到「可用余额」比实际少。
 * 单次生成最长约 10 分钟，给 60 分钟余量后再回收，正常请求不可能跨过这个窗口。
 */
const HOLD_TTL_MS = 60 * 60_000

function walletRow(userId) {
  const d = getBillingDb()
  let row = d.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
  if (!row) {
    d.prepare('INSERT INTO wallets (user_id, balance_micro, hold_micro) VALUES (?, 0, 0)').run(userId)
    row = d.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
  }
  return row
}

/** 超过 HOLD_TTL_MS 仍没释放的冻结视为悬空，直接清零（调用方需在事务内） */
function reclaimStaleHold(d, userId, w) {
  const hold = Number(w.hold_micro || 0)
  if (hold <= 0) return w
  const since = Number(w.hold_since_ms || 0)
  if (since && Date.now() - since <= HOLD_TTL_MS) return w
  d.prepare('UPDATE wallets SET hold_micro = 0, hold_since_ms = NULL, updated_at = datetime(\'now\') WHERE user_id = ?').run(
    userId,
  )
  console.warn(`[billing] 回收悬空冻结 user=${userId} hold=${creditsFromMicro(hold)} credit`)
  return { ...w, hold_micro: 0, hold_since_ms: null }
}

export function getWalletSummary(userId) {
  const w = walletRow(userId)
  const available = Math.max(0, Number(w.balance_micro) - Number(w.hold_micro))
  return {
    balance_micro: Number(w.balance_micro),
    hold_micro: Number(w.hold_micro),
    available_micro: available,
    credits: creditsFromMicro(w.balance_micro),
    available_credits: creditsFromMicro(available),
  }
}

export function appendLedger(userId, type, amountMicro, refType, refId, meta = {}) {
  return withBillingTxn((d) => {
    const w = walletRow(userId)
    const nextBalance = Number(w.balance_micro) + amountMicro
    if (nextBalance < 0) throw new Error('余额不足')
    d.prepare('UPDATE wallets SET balance_micro = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      nextBalance,
      userId,
    )
    const info = d
      .prepare(
        `INSERT INTO ledger_entries (user_id, type, amount_micro, balance_after_micro, ref_type, ref_id, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, type, amountMicro, nextBalance, refType, refId, JSON.stringify(meta))
    return { id: info.lastInsertRowid, balance_after_micro: nextBalance }
  })
}

export function creditWallet(userId, credits, type, refType, refId, meta) {
  return appendLedger(userId, type, microFromCredits(credits), refType, refId, meta)
}

export function holdCredits(userId, credits) {
  const micro = microFromCredits(credits)
  return withBillingTxn((d) => {
    const w = reclaimStaleHold(d, userId, walletRow(userId))
    const available = Number(w.balance_micro) - Number(w.hold_micro)
    if (available < micro) throw new Error('user_insufficient_credits')
    const hold = Number(w.hold_micro) + micro
    const since = Number(w.hold_micro) > 0 && w.hold_since_ms ? Number(w.hold_since_ms) : Date.now()
    d.prepare('UPDATE wallets SET hold_micro = ?, hold_since_ms = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      hold,
      since,
      userId,
    )
    return { hold_micro: micro, hold_credits: credits }
  })
}

export function releaseHold(userId, credits) {
  const micro = microFromCredits(credits)
  return withBillingTxn((d) => {
    const w = walletRow(userId)
    const hold = Math.max(0, Number(w.hold_micro) - micro)
    d.prepare('UPDATE wallets SET hold_micro = ?, hold_since_ms = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      hold,
      hold > 0 ? (w.hold_since_ms ?? null) : null,
      userId,
    )
  })
}

/** 从冻结中实扣：先减 hold 再减 balance */
export function settleFromHold(userId, holdCredits, actualCredits, usageMeta) {
  const holdMicro = microFromCredits(holdCredits)
  const actualMicro = microFromCredits(actualCredits)
  return withBillingTxn((d) => {
    const w = walletRow(userId)
    const newHold = Math.max(0, Number(w.hold_micro) - holdMicro)
    const newBalance = Number(w.balance_micro) - actualMicro
    if (newBalance < 0 || newHold > newBalance) throw new Error('user_insufficient_credits')
    d.prepare('UPDATE wallets SET balance_micro = ?, hold_micro = ?, hold_since_ms = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      newBalance,
      newHold,
      newHold > 0 ? (w.hold_since_ms ?? null) : null,
      userId,
    )
    const entry = d
      .prepare(
        `INSERT INTO ledger_entries (user_id, type, amount_micro, balance_after_micro, ref_type, ref_id, meta_json)
         VALUES (?, 'usage', ?, ?, 'usage', ?, ?)`,
      )
      .run(userId, -actualMicro, newBalance, String(usageMeta.trace_id || ''), JSON.stringify(usageMeta))
    if (usageMeta.cap) {
      d.prepare(
        `INSERT INTO usage_events (user_id, cap, model, spec_key, qty, total_micro, trace_id, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        userId,
        usageMeta.cap,
        usageMeta.model || '',
        usageMeta.spec_key || 'default',
        usageMeta.qty ?? 1,
        actualMicro,
        usageMeta.trace_id || '',
        JSON.stringify(usageMeta),
      )
    }
    return { ledger_id: entry.lastInsertRowid, balance_after_micro: newBalance }
  })
}

export function listLedger(userId, limit = 50, offset = 0) {
  const rows = getBillingDb()
    .prepare(
      `SELECT id, type, amount_micro, balance_after_micro, ref_type, ref_id, meta_json, created_at
       FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset)
  return rows.map((r) => ({
    ...r,
    amount_credits: creditsFromMicro(r.amount_micro),
    balance_after_credits: creditsFromMicro(r.balance_after_micro),
    meta: safeJson(r.meta_json),
  }))
}

function safeJson(s) {
  try {
    return JSON.parse(String(s || '{}'))
  } catch {
    return {}
  }
}