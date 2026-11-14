import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { isPlatformApimartKey, billingDecision } from './server/billing/guard.mjs'
import { patchBillingSettings } from './server/billing/settings.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
openBillingDbFile(file)

process.env.APIMART_API_KEY = 'platform-key'
check('BYOK skip', isPlatformApimartKey({ kind: 'apimart', apiKey: 'user-key' }) === false)
check('平台 Key', isPlatformApimartKey({ kind: 'apimart', apiKey: '' }) === true)

patchBillingSettings({ billing_enabled: true })
const dec = billingDecision({ kind: 'apimart', apiKey: '' }, { headers: {} })
check('未登录需鉴权', dec.error?.code === 'login_required')

process.exit(bad ? 1 : 0)