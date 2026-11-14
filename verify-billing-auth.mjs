/**
 * 注册 → 验证 → 登录 → 401
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import {
  registerUser,
  createVerifyToken,
  verifyEmail,
  loginUser,
  sessionFromToken,
  grantSignupBonusOnce,
} from './server/billing/auth.mjs'
import { getWalletSummary } from './server/billing/wallet.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
openBillingDbFile(file)

const { userId } = registerUser('test@example.com', 'password123')
const token = createVerifyToken(userId)
verifyEmail(token)
const w1 = getWalletSummary(userId)
grantSignupBonusOnce(userId)
const w2 = getWalletSummary(userId)
check('注册赠送单次', w1.credits === w2.credits && w1.credits >= 20)

const { token: sess } = loginUser('test@example.com', 'password123')
check('登录会话', Boolean(sessionFromToken(sess)))
check('无效 token', !sessionFromToken('bad'))

process.exit(bad ? 1 : 0)