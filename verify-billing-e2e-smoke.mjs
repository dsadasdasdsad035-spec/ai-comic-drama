/**
 * 冒烟：注册 → 验证 → 登录 → 模拟充值 → 启用计费 → APIMart 扣费 → 渠道对账
 * 跑法：node verify-billing-e2e-smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { patchBillingSettings } from './server/billing/settings.mjs'
import {
  registerUser,
  createVerifyToken,
  verifyEmail,
  loginUser,
  sessionFromToken,
} from './server/billing/auth.mjs'
import { getWalletSummary } from './server/billing/wallet.mjs'
import { getBillingDb } from './server/billing/db.mjs'
import { microFromCredits } from './server/billing/constants.mjs'
import { simulatePaymentPaid, buildReconciliationReport } from './server/billing/reconcile.mjs'
import { guardApimartText, finalizeApimartText } from './server/billing/guard.mjs'
import { seedPriceCatalogIfEmpty } from './server/billing/price-catalog.mjs'

let bad = 0
const step = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' | ' + detail : ''}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-e2e-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
process.env.BILLING_ALLOW_SIMULATE = '1'
process.env.BILLING_ADMIN_EMAIL = 'smoke-admin@example.com'
process.env.APIMART_API_KEY = 'platform-smoke-key'

openBillingDbFile(file)
seedPriceCatalogIfEmpty()
patchBillingSettings({ billing_enabled: true })

const email = 'smoke-admin@example.com'
const password = 'SmokeTest1Pass'

console.log('\n--- 1. 注册 ---')
const { userId } = registerUser(email, password)
const vtok = createVerifyToken(userId)
step('注册成功', userId > 0)

console.log('\n--- 2. 邮箱验证（含注册赠送）---')
verifyEmail(vtok)
const afterGift = getWalletSummary(userId)
step('验证后有钱包', afterGift.credits >= 20, `credits=${afterGift.credits}`)

console.log('\n--- 3. 登录 ---')
const { token } = loginUser(email, password)
const session = sessionFromToken(token)
step('会话有效', Boolean(session?.userId === userId))

console.log('\n--- 4. 创建订单并模拟充值 ---')
const pack = patchBillingSettings({}).recharge_packs.find((p) => p.id === 'starter')
const tradeId = `smoke_${userId}_${Date.now()}`
const d = getBillingDb()
d.prepare(
  `INSERT INTO payment_orders (user_id, trade_order_id, pack_id, amount_cny, credits_micro, status)
   VALUES (?, ?, 'starter', ?, ?, 'pending')`,
).run(userId, tradeId, pack.price_cny, microFromCredits(pack.credits_total))
simulatePaymentPaid(tradeId)
const afterRecharge = getWalletSummary(userId)
step(
  '充值到账',
  afterRecharge.credits >= afterGift.credits + pack.credits_total - 0.01,
  `credits=${afterRecharge.credits}`,
)

console.log('\n--- 5. 模型调用扣费（APIMart 文本）---')
const mockReq = {
  headers: {
    authorization: `Bearer ${token}`,
  },
}
const provider = { kind: 'apimart', apiKey: '', label: 'APIMart' }
const model = 'gpt-5.1'
const body = { prompt: 'ping', maxTokens: 128 }
const ctx = guardApimartText({ provider, req: mockReq, model, body })
step('预扣通过', !ctx.error && !ctx.skipBilling, `hold=${ctx.holdCredits}`)
finalizeApimartText(ctx, { prompt_tokens: 500, completion_tokens: 120 })
const afterUse = getWalletSummary(userId)
step('扣费后余额下降', afterUse.credits < afterRecharge.credits, `${afterRecharge.credits} → ${afterUse.credits}`)

console.log('\n--- 6. 渠道对账 ---')
const report = buildReconciliationReport()
step('账本自洽', report.ok === true, report.issues.join('; ') || 'ok')
step('有消费记录', report.totals.consumed_credits > 0, String(report.totals.consumed_credits))
step(
  '渠道应付积分',
  report.channel.platform_apimart_credits_owed > 0,
  String(report.channel.platform_apimart_credits_owed),
)
console.log('\n对账摘要:', JSON.stringify(report, null, 2))

process.exit(bad ? 1 : 0)