/**
 * 端到端验证：注册 → smtp 驱动真实投递 → 从假 SMTP 收信 → 提取验证链接 → 完成验证。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { registerAndNotify, verifyEmail } from './server/billing/auth.mjs'
import { getWalletSummary } from './server/billing/wallet.mjs'
import { startFakeSmtp } from './tests/fake-smtp.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) bad++
}

const mail = await startFakeSmtp()

process.env.BILLING_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-smtp-')), 'billing.sqlite')
process.env.BILLING_EMAIL_DRIVER = 'smtp'
process.env.BILLING_SMTP_HOST = '127.0.0.1'
process.env.BILLING_SMTP_PORT = String(mail.port)
process.env.BILLING_SMTP_SECURE = '0'
process.env.BILLING_SMTP_USER = 'no-reply@example.com'
process.env.BILLING_SMTP_PASS = 'test-pass'
process.env.BILLING_EMAIL_FROM = '短剧创作台 <no-reply@example.com>'

openBillingDbFile(process.env.BILLING_DB_PATH)

const BASE = 'http://127.0.0.1:5273'
const out = await registerAndNotify('viewer@example.com', 'password123', BASE)
check('smtp 驱动注册成功', out.emailSent === true, `driver=${out.driver}`)
check('假 SMTP 收到 1 封邮件', mail.received.length === 1, `实际 ${mail.received.length} 封`)

const msg = mail.received[0] || { data: '', to: '', from: '' }
check('收件人正确', msg.to.includes('viewer@example.com'), msg.to)
check('发件人正确', msg.from.includes('no-reply@example.com'), msg.from)
check('主题为中文验证邮件', /Subject: .*验证/.test(msg.data) || /=\?/.test(msg.data))

// 从正文里提取验证 token。nodemailer 会把 text/html 各编码一次（quoted-printable 或 base64），
// 且 quoted-printable 的软换行会拆开链接，所以两种编码都要试。
function decodeQp(s) {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function extractToken(raw) {
  const direct = decodeQp(raw).match(/token=([a-f0-9]{64})/)
  if (direct) return direct[1]
  // 兜底：扫描长 base64 片段逐个解码
  for (const run of raw.match(/[A-Za-z0-9+/=\r\n]{200,}/g) || []) {
    try {
      const text = Buffer.from(run.replace(/\s+/g, ''), 'base64').toString('utf8')
      const hit = text.match(/token=([a-f0-9]{64})/)
      if (hit) return hit[1]
    } catch {
      /* 不是合法 base64，跳过 */
    }
  }
  return null
}

const token = extractToken(msg.data)
check('邮件正文含验证链接', Boolean(token), token ? '已提取 token' : '未找到 token')

if (token) {
  verifyEmail(token)
  const w = getWalletSummary(out.userId)
  check('验证后发放注册赠送积分', w.credits >= 20, `credits=${w.credits}`)
}

await mail.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
