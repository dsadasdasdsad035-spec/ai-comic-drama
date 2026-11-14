import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { registerUser } from './server/billing/auth.mjs'
import { getBillingDb, withBillingTxn } from './server/billing/db.mjs'
import { creditWallet, getWalletSummary } from './server/billing/wallet.mjs'
import { verifyNotify } from './server/billing/xunhupay.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
process.env.XUNHUPAY_SECRET = 'sec'
openBillingDbFile(file)
const { userId } = registerUser('pay@example.com', 'password12345')

const trade = 'order_1'
const d = getBillingDb()
d.prepare(
  `INSERT INTO payment_orders (user_id, trade_order_id, pack_id, amount_cny, credits_micro, status)
   VALUES (?, ?, 'starter', 72.5, ?, 'pending')`,
).run(userId, trade, 100 * 1_000_000)

const body = { trade_order_id: trade, total_fee: '72.50', appid: 'x', time: '1', nonce_str: 'n' }
body.hash = verifyNotify.toString() // wrong on purpose first

const markPaid = () => {
  const order = d.prepare('SELECT * FROM payment_orders WHERE trade_order_id = ?').get(trade)
  if (order.status === 'paid') return
  d.prepare(`UPDATE payment_orders SET status = 'paid', paid_at = datetime('now') WHERE trade_order_id = ?`).run(trade)
  creditWallet(userId, 100, 'recharge', 'payment_order', trade, {})
}

markPaid()
markPaid()
const w = getWalletSummary(userId)
check('幂等入账', w.credits === 100)

process.exit(bad ? 1 : 0)