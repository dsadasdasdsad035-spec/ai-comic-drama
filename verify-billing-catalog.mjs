import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { seedPriceCatalogIfEmpty, estimateImageCredits, estimateTextCredits } from './server/billing/price-catalog.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' | ' + extra : ''}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
openBillingDbFile(file)
seedPriceCatalogIfEmpty()

const img = estimateImageCredits('seedream-5-0-pro-260628', 1)
check('seedream 图单价', img > 0.3 && img < 0.4, String(img))

const txt = estimateTextCredits('gpt-5.1', 1000, 500)
check('文本预估 >0', txt > 0, String(txt))

process.exit(bad ? 1 : 0)