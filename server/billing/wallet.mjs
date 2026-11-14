import { creditsFromMicro, microFromCredits } from './constants.mjs'
import { getBillingDb, withBillingTxn } from './db.mjs'

function walletRow(userId) {
  const d = getBillingDb()
  let row = d.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
  if (!row) {
    d.prepare('INSERT INTO wallets (user_id, balance_micro, hold_micro) VALUES (?, 0, 0)').run(userId)
    row = d.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId)
  }
  return row
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
    const w = walletRow(userId)
    const available = Number(w.balance_micro) - Number(w.hold_micro)
    if (available < micro) throw new Error('user_insufficient_credits')
    const hold = Number(w.hold_micro) + micro
    d.prepare('UPDATE wallets SET hold_micro = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(hold, userId)
    return { hold_micro: micro, hold_credits: credits }
  })
}

export function releaseHold(userId, credits) {
  const micro = microFromCredits(credits)
  const d = getBillingDb()
  const w = walletRow(userId)
  const hold = Math.max(0, Number(w.hold_micro) - micro)
  d.prepare('UPDATE wallets SET hold_micro = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(hold, userId)
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
    d.prepare('UPDATE wallets SET balance_micro = ?, hold_micro = ?, updated_at = datetime(\'now\') WHERE user_id = ?').run(
      newBalance,
      newHold,
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