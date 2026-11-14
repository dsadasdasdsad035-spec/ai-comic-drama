/**
 * 计费库建表与默认配置
 * 跑法：node verify-billing-db.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile, billingDbPath } from './server/billing/db.mjs'
import { getBillingSettings } from './server/billing/settings.mjs'
import { openBillingDb } from './server/billing/db.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-'))
const file = path.join(dir, 'billing.sqlite')
process.env.BILLING_DB_PATH = file

const d1 = openBillingDbFile(file)
check('首次打开', Boolean(d1))
const d2 = openBillingDbFile(file)
check('二次打开', Boolean(d2))

openBillingDbFile(file)
const s = getBillingSettings()
check('billing_enabled 默认 false', s.billing_enabled === false)
check('signup_bonus 20', s.signup_bonus_credits === 20)
check('五档充值', s.recharge_packs?.length === 5)
check('starter credits 100', s.recharge_packs?.[0]?.credits_total === 100)

process.exit(bad ? 1 : 0)