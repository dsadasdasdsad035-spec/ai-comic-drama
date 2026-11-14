/**
 * 桌面端场景验证：完全不依赖环境变量，只通过设置页写入的库配置发信。
 *
 * 这是用户实际会走的路径 —— Electron 子进程没有 .env 加载机制，
 * 唯一可行的是在「设置 → 计费 → 验证邮件」里填 SMTP。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { patchBillingSettings, publicBillingSettings, getBillingSettings } from './server/billing/settings.mjs'
import { resolveEmailConfig, resetEmailTransport } from './server/billing/email.mjs'
import { registerAndNotify, verifyEmail } from './server/billing/auth.mjs'
import { getWalletSummary } from './server/billing/wallet.mjs'
import { startFakeSmtp } from './tests/fake-smtp.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) bad++
}

// 清掉所有邮件相关环境变量，确保结果只可能来自库配置
for (const k of [
  'BILLING_EMAIL_DRIVER',
  'BILLING_SMTP_HOST',
  'BILLING_SMTP_PORT',
  'BILLING_SMTP_SECURE',
  'BILLING_SMTP_USER',
  'BILLING_SMTP_PASS',
  'BILLING_EMAIL_FROM',
]) {
  delete process.env[k]
}

const mail = await startFakeSmtp()

process.env.BILLING_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-settings-mail-')), 'billing.sqlite')
openBillingDbFile(process.env.BILLING_DB_PATH)

// ---- 1. 默认状态：没有任何邮件配置时回落 console ----
check('默认驱动为 console', resolveEmailConfig().driver === 'console')

// ---- 2. 通过设置页写入 SMTP 配置（模拟 UI 的 PATCH） ----
patchBillingSettings({
  email_driver: 'smtp',
  smtp_host: '127.0.0.1',
  smtp_port: String(mail.port),
  smtp_secure: false,
  smtp_user: 'no-reply@example.com',
  smtp_pass: 'secret-pass',
  email_from: '短剧创作台 <no-reply@example.com>',
})
resetEmailTransport()

const cfg = resolveEmailConfig()
check('驱动来自库配置', cfg.driver === 'smtp', cfg.driver)
check('服务器来自库配置', cfg.host === '127.0.0.1', cfg.host)
check('端口来自库配置', cfg.port === mail.port, String(cfg.port))
check('关闭 TLS 来自库配置', cfg.secure === false)

// ---- 3. 密码不得回传前端 ----
const pub = publicBillingSettings()
check('设置接口不回传密码明文', pub.smtp_pass === '', JSON.stringify(pub.smtp_pass))
check('设置接口告知密码已设置', pub.smtp_pass_set === true)

// ---- 4. 只改其他字段时密码不能被冲掉 ----
patchBillingSettings({ signup_bonus_credits: 30 })
check('改其他字段保留密码', getBillingSettings().smtp_pass === 'secret-pass')
const maskedAfter = publicBillingSettings()
check('改其他字段后仍标记已设置', maskedAfter.smtp_pass_set === true)

// ---- 5. 真正走一遍注册发信 ----
const out = await registerAndNotify('desktop@example.com', 'password123', 'http://127.0.0.1:5273')
check('桌面端配置下注册发信成功', out.emailSent === true, out.emailError || `driver=${out.driver}`)
check('假 SMTP 收到邮件', mail.received.length === 1, `实际 ${mail.received.length} 封`)

const msg = mail.received[0] || { data: '', to: '' }
check('收件人正确', String(msg.to).includes('desktop@example.com'), msg.to)

// ---- 6. 从邮件正文取 token 完成验证 ----
function decodeQp(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}
function extractToken(raw) {
  const direct = decodeQp(raw).match(/token=([a-f0-9]{64})/)
  if (direct) return direct[1]
  for (const run of raw.match(/[A-Za-z0-9+/=\r\n]{200,}/g) || []) {
    try {
      const text = Buffer.from(run.replace(/\s+/g, ''), 'base64').toString('utf8')
      const hit = text.match(/token=([a-f0-9]{64})/)
      if (hit) return hit[1]
    } catch {
      /* 跳过非法 base64 */
    }
  }
  return null
}
const token = extractToken(msg.data)
check('邮件含验证链接', Boolean(token))
if (token) {
  verifyEmail(token)
  check('验证后发放积分', getWalletSummary(out.userId).credits >= 20)
}

// ---- 7. 环境变量兜底仍然生效（部署场景） ----
patchBillingSettings({ email_driver: '', smtp_host: '', smtp_port: '', smtp_secure: '', smtp_user: '', smtp_pass: '' })
process.env.BILLING_EMAIL_DRIVER = 'smtp'
process.env.BILLING_SMTP_HOST = 'mail.example.com'
process.env.BILLING_SMTP_PORT = '587'
const envCfg = resolveEmailConfig()
check('库为空时回落环境变量驱动', envCfg.driver === 'smtp', envCfg.driver)
check('库为空时回落环境变量服务器', envCfg.host === 'mail.example.com', envCfg.host)
check('587 端口自动判定 STARTTLS', envCfg.secure === false, String(envCfg.secure))

// ---- 8. 库配置优先于环境变量 ----
patchBillingSettings({ smtp_host: 'db.example.com' })
check('库配置优先于环境变量', resolveEmailConfig().host === 'db.example.com', resolveEmailConfig().host)

await mail.close()
console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
