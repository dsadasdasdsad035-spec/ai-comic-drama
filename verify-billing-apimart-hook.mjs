/** billing_enabled=false 时不拦截 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { billingDecision } from './server/billing/guard.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
openBillingDbFile(file)
process.env.APIMART_API_KEY = 'k'

const d = billingDecision({ kind: 'apimart', apiKey: '' }, { headers: {} })
check('默认关闭 skip', d.skipBilling === true && d.reason === 'disabled')

process.exit(bad ? 1 : 0)