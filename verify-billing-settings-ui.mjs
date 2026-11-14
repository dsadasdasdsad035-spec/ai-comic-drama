import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
/** 计费 UI 可能在 SettingsPage 或按 hub 拆分的 BillingPane 里 */
const FILES = ['src/settings/SettingsPage.tsx', 'src/settings/hubs/billing/BillingPane.tsx']
const txt = FILES.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}
check('计费分区', /BillingPane|renderBilling|section === 'billing'|data-settings-pane="billing"/.test(txt))
check('平台积分文案', txt.includes('平台积分'))
check('充值轮询终态', txt.includes('fetchRechargeOrderStatus'))
process.exit(bad ? 1 : 0)
