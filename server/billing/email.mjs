/**
 * 验证邮件发送。
 *
 * 驱动由 BILLING_EMAIL_DRIVER 决定：
 * - console（默认）：只把验证链接打到服务端日志，便于本地/测试；
 * - smtp：真实投递，需配置 BILLING_SMTP_HOST 等变量。
 *
 * 约定：发送失败一律抛错，由调用方决定如何告知用户。
 * 不在这里吞异常，否则注册接口会谎报「邮件已发送」。
 */
import nodemailer from 'nodemailer'

let cachedTransporter = null

export function emailDriver() {
  return String(process.env.BILLING_EMAIL_DRIVER || 'console').trim().toLowerCase()
}

function envStr(name) {
  return String(process.env[name] || '').trim()
}

function smtpConfig() {
  const host = envStr('BILLING_SMTP_HOST')
  if (!host) throw new Error('BILLING_EMAIL_DRIVER=smtp 但未配置 BILLING_SMTP_HOST')
  const port = Number(envStr('BILLING_SMTP_PORT') || 465)
  const secureRaw = envStr('BILLING_SMTP_SECURE').toLowerCase()
  // 465 走隐式 TLS，587 走 STARTTLS；显式配置优先
  const secure = secureRaw ? secureRaw === '1' || secureRaw === 'true' : port === 465
  const user = envStr('BILLING_SMTP_USER')
  const pass = String(process.env.BILLING_SMTP_PASS || '')
  if (!user || !pass) throw new Error('BILLING_EMAIL_DRIVER=smtp 但未配置 BILLING_SMTP_USER / BILLING_SMTP_PASS')
  return { host, port, secure, auth: { user, pass } }
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter
  cachedTransporter = nodemailer.createTransport(smtpConfig())
  return cachedTransporter
}

/** 发信人：优先 BILLING_EMAIL_FROM，缺省回落到 SMTP 账号 */
function fromAddress() {
  const from = envStr('BILLING_EMAIL_FROM')
  if (from) return from
  const user = envStr('BILLING_SMTP_USER')
  if (user) return user
  throw new Error('未配置发信人：请设置 BILLING_EMAIL_FROM 或 BILLING_SMTP_USER')
}

function verificationMail(email, verifyUrl) {
  const text = [
    '你好，',
    '',
    '感谢注册。请点击下面的链接完成邮箱验证（24 小时内有效）：',
    '',
    verifyUrl,
    '',
    '如果这不是你本人的操作，忽略本邮件即可。',
  ].join('\n')
  const html = `<!doctype html>
<html lang="zh-CN"><body style="font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;line-height:1.7;color:#1a1a1a">
  <p>你好，</p>
  <p>感谢注册。请点击下面的链接完成邮箱验证（24 小时内有效）：</p>
  <p><a href="${verifyUrl}" style="color:#4f46e5">${verifyUrl}</a></p>
  <p style="color:#888;font-size:13px">如果这不是你本人的操作，忽略本邮件即可。</p>
</body></html>`
  return { subject: '请验证你的邮箱', text, html }
}

/**
 * 发送邮箱验证邮件。
 * @returns {Promise<{ ok: true, driver: string }>}
 */
export async function sendVerificationEmail(email, verifyUrl) {
  const driver = emailDriver()

  if (driver === 'console') {
    console.log(`[billing] 验证邮箱 ${email} → ${verifyUrl}`)
    return { ok: true, driver }
  }

  if (driver === 'smtp') {
    const mail = verificationMail(email, verifyUrl)
    await getTransporter().sendMail({
      from: fromAddress(),
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return { ok: true, driver }
  }

  throw new Error(`未配置的邮件驱动：${driver}（可用：console、smtp）`)
}

/** 测试用：丢弃缓存的 transporter，让新的 SMTP 配置生效 */
export function resetEmailTransport() {
  cachedTransporter = null
}
