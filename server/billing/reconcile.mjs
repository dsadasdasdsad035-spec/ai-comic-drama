import { creditsFromMicro } from './constants.mjs'
import { getBillingDb } from './db.mjs'
import { getBillingSettings } from './settings.mjs'
import { creditWallet } from './wallet.mjs'

function sumMicro(sql, params = []) {
  const row = getBillingDb().prepare(sql).get(...params)
  return Number(row?.s ?? 0)
}

/** 平台侧对账：用户负债、流水、用量与支付订单是否自洽 */
export function buildReconciliationReport() {
  const d = getBillingDb()
  const wallets = d.prepare('SELECT SUM(balance_micro) AS bal, SUM(hold_micro) AS hold, COUNT(*) AS n FROM wallets').get()
  const ledgerByType = d
    .prepare(`SELECT type, SUM(amount_micro) AS s, COUNT(*) AS c FROM ledger_entries GROUP BY type`)
    .all()
  const usageAgg = d
    .prepare(
      `SELECT cap, COUNT(*) AS calls, SUM(total_micro) AS credits_micro
       FROM usage_events GROUP BY cap`,
    )
    .all()
  const orders = d
    .prepare(
      `SELECT status, COUNT(*) AS c, SUM(credits_micro) AS credits_micro, SUM(amount_cny) AS cny
       FROM payment_orders GROUP BY status`,
    )
    .all()

  const ledgerMap = Object.fromEntries(ledgerByType.map((r) => [r.type, r]))
  const usageMicro = sumMicro('SELECT COALESCE(SUM(total_micro), 0) AS s FROM usage_events')
  const usageLedgerMicro = Math.abs(Number(ledgerMap.usage?.s ?? 0))
  const rechargeMicro = Number(ledgerMap.recharge?.s ?? 0)
  const giftMicro = Number(ledgerMap.gift?.s ?? 0)

  const balances = d.prepare('SELECT user_id, balance_micro, hold_micro FROM wallets').all()
  let ledgerMismatch = 0
  for (const w of balances) {
    const last = d
      .prepare('SELECT balance_after_micro FROM ledger_entries WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(w.user_id)
    if (last && Number(last.balance_after_micro) !== Number(w.balance_micro)) ledgerMismatch++
  }

  const issues = []
  if (ledgerMismatch > 0) issues.push(`wallet_balance_mismatch_users:${ledgerMismatch}`)
  if (Math.abs(usageMicro - usageLedgerMicro) > 1) {
    issues.push(`usage_events_vs_ledger:${usageMicro - usageLedgerMicro}`)
  }

  const userLiabilityMicro = Number(wallets?.bal ?? 0)
  const userHoldMicro = Number(wallets?.hold ?? 0)

  return {
    generated_at: new Date().toISOString(),
    billing_enabled: Boolean(getBillingSettings().billing_enabled),
    users_with_wallet: Number(wallets?.n ?? 0),
    user_balance_credits: creditsFromMicro(userLiabilityMicro),
    user_hold_credits: creditsFromMicro(userHoldMicro),
    user_available_credits: creditsFromMicro(userLiabilityMicro - userHoldMicro),
    ledger_by_type: ledgerByType.map((r) => ({
      type: r.type,
      count: r.c,
      credits: creditsFromMicro(r.s),
    })),
    usage_by_cap: usageAgg.map((r) => ({
      cap: r.cap,
      calls: r.c,
      credits: creditsFromMicro(r.credits_micro),
    })),
    totals: {
      gifted_credits: creditsFromMicro(giftMicro),
      recharged_credits: creditsFromMicro(rechargeMicro),
      consumed_credits: creditsFromMicro(usageMicro),
    },
    payment_orders: orders.map((o) => ({
      status: o.status,
      count: o.c,
      credits: creditsFromMicro(o.credits_micro ?? 0),
      cny: Number(o.cny ?? 0),
    })),
    /** 渠道对账：用户侧已扣积分 ≈ 应转交上游 APIMart 的 Credits（1:1 代发模型下） */
    channel: {
      platform_apimart_credits_owed: creditsFromMicro(usageMicro),
      note: '上游 APIB/APIMART 账户余额需在 apimart 控制台单独核对；此处仅汇总本平台对用户记账的消费额',
    },
    ok: issues.length === 0,
    issues,
  }
}

/** 冒烟 / 测试：将 pending 订单标记 paid 并入账（需 BILLING_ALLOW_SIMULATE=1） */
export function simulatePaymentPaid(tradeOrderId) {
  if (String(process.env.BILLING_ALLOW_SIMULATE || '') !== '1') {
    throw new Error('未启用 BILLING_ALLOW_SIMULATE=1，禁止模拟入账')
  }
  const d = getBillingDb()
  const order = d.prepare('SELECT * FROM payment_orders WHERE trade_order_id = ?').get(tradeOrderId)
  if (!order) throw new Error('订单不存在')
  if (order.status === 'paid') return { already: true, trade_order_id: tradeOrderId }
  d.prepare(`UPDATE payment_orders SET status = 'paid', paid_at = datetime('now') WHERE trade_order_id = ?`).run(
    tradeOrderId,
  )
  const credits = order.credits_micro / 1_000_000
  creditWallet(order.user_id, credits, 'recharge', 'payment_order', tradeOrderId, {
    pack_id: order.pack_id,
    simulated: true,
  })
  return { already: false, trade_order_id: tradeOrderId, credits }
}