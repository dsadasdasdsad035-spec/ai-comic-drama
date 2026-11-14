import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
/**
 * 计费 UI 的位置随重构变过几次：设置页内嵌 → 独立的 account 页 → 再拆成
 * Auth/Recharge/Wallet/Ledger/Admin 若干面板。这里按候选清单取实际存在的文件，
 * 避免某次拆分把校验变成「文件不存在」而不是「功能缺失」。
 */
const CANDIDATES = [
  'src/account/AccountPage.tsx',
  'src/account/AuthPanel.tsx',
  'src/account/WalletPanel.tsx',
  'src/account/RechargePanel.tsx',
  'src/account/LedgerPanel.tsx',
  'src/account/AdminPanel.tsx',
  'src/account/useBillingAccount.ts',
  'src/settings/SettingsPage.tsx',
]
const files = CANDIDATES.filter((f) => fs.existsSync(path.join(root, f)))
if (!files.length) {
  console.error('❌ 找不到任何计费 UI 文件，检查是否又被重构到别处')
  process.exit(1)
}
const txt = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n')
let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}
check('计费分区', /BillingPane|renderBilling|data-settings-pane="(billing|account)"|section === 'billing'/.test(txt))
check('平台积分文案', /积分/.test(txt))
check('余额与可用额分开展示', /available_credits/.test(txt))
check('充值轮询终态', txt.includes('fetchRechargeOrderStatus'))
check('管理员配置只对管理员可见', /is_admin|isAdmin/.test(txt))
process.exit(bad ? 1 : 0)
