import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { registerUser } from './server/billing/auth.mjs'
import { appendLedger, getWalletSummary, listLedger } from './server/billing/wallet.mjs'
import { microFromCredits } from './server/billing/constants.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
openBillingDbFile(file)
const { userId } = registerUser('w@example.com', 'password12345')

appendLedger(userId, 'adjust', microFromCredits(10), 'test', '1', {})
const w = getWalletSummary(userId)
const rows = listLedger(userId, 10, 0)
check('balance_after 一致', rows[0]?.balance_after_credits === w.credits)

process.exit(bad ? 1 : 0)