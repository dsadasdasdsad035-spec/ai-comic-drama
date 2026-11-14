/**
 * 验证邮件发送。
 *
 * 配置来源有两处，库内设置优先于环境变量：
 * 1. 设置页「计费 → 邮箱」写入 billing_settings（桌面端唯一可行的方式，因为 Electron
 *    子进程没有 .env 加载机制，用户也无处设置环境变量）；
 * 2. 环境变量 BILLING_*（服务端/容器部署时更方便，无需进 UI 配置）。
 *
 * 驱动：
 * - console（默认）：只把验证链接打到服务端日志，便于本地/测试；
 * - smtp：真实投递。
 *
 * 约定：发送失败一律抛错，由调用方决定如何告知用户。
 * 不在这里吞异常，否则注册接口会谎报「邮件已发送」。
 */
import nodemailer from 'nodemailer'
import { getBillingSettings } from './settings.mjs'

let cachedTransporter = null
let cachedConfigKey = ''

function envStr(name) {
  return String(process.env[name] || '').trim()
}

function pick(settings, key, envName) {
  const fromSettings = String(settings?.[key] ?? '').trim()
  if (fromSettings) return fromSettings
  return envName ? envStr(envName) : ''
}

/**
 * 解析生效的邮件配置。
 * 空字符串字段表示「未配置」，由调用方决定是回落还是报错。
 */
export function resolveEmailConfig(settings = safeSettings()) {
  const driver = (pick(settings, 'email_driver', 'BILLING_EMAIL_DRIVER') || 'console').toLowerCase()
  const host = pick(settings, 'smtp_host', 'BILLING_SMTP_HOST')
  const portRaw = pick(settings, 'smtp_port', 'BILLING_SMTP_PORT')
  const port = Number(portRaw) || 465

  // secure 是布尔，不能用空串判断「未配置」，要单独判断是否显式给了值
  let secure
  const settingsSecure = settings?.smtp_secure
  const envSecure = envStr('BILLING_SMTP_SECURE').toLowerCase()
  if (typeof settingsSecure === 'boolean') secure = settingsSecure
  else if (envSecure) secure = envSecure === '1' || envSecure === 'true'
  // 都不给时按端口推断：465 走隐式 TLS，其余（如 587）走 STARTTLS
  else secure = port === 465

  return {
    driver,
    host,
    port,
    secure,
    user: pick(settings, 'smtp_user', 'BILLING_SMTP_USER'),
    pass: pick(settings, 'smtp_pass', 'BILLING_SMTP_PASS'),
    from: pick(settings, 'email_from', 'BILLING_EMAIL_FROM'),
  }
}

/** 库未打开时不阻塞取默认值 */
function safeSettings() {
  try {
    return getBillingSettings()
  } catch {
    return {}
  }
}

export function emailDriver() {
  return resolveEmailConfig().driver
}

function configKey(c) {
  return [c.host, c.port, c.secure, c.user, c.pass].join('|')
}

function getTransporter(cfg) {
  const key = configKey(cfg)
  if (cachedTransporter && cachedConfigKey === key) return cachedTransporter
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  })
  cachedConfigKey = key
  return cachedTransporter
}

function fromAddress(cfg) {
  if (cfg.from) return cfg.from
  if (cfg.user) return cfg.user
  throw new Error('未配置发信人：请在设置页填写「发信人」，或配置 BILLING_EMAIL_FROM')
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

/** 校验 smtp 配置是否齐全，返回缺失项的中文提示；齐全时返回 null */
function smtpConfigProblem(cfg) {
  if (!cfg.host) return '未配置 SMTP 服务器地址（设置页「SMTP 服务器」或 BILLING_SMTP_HOST）'
  if (!cfg.user) return '未配置 SMTP 用户名（设置页「SMTP 用户名」或 BILLING_SMTP_USER）'
  if (!cfg.pass) return '未配置 SMTP 密码（设置页「SMTP 密码」或 BILLING_SMTP_PASS）'
  if (!Number.isFinite(cfg.port) || cfg.port <= 0) return 'SMTP 端口不合法'
  return null
}

/**
 * 发送邮箱验证邮件。
 * @returns {Promise<{ ok: true, driver: string }>}
 */
export async function sendVerificationEmail(email, verifyUrl) {
  const cfg = resolveEmailConfig()

  if (cfg.driver === 'console') {
    console.log(`[billing] 验证邮箱 ${email} → ${verifyUrl}`)
    return { ok: true, driver: cfg.driver }
  }

  if (cfg.driver === 'smtp') {
    const problem = smtpConfigProblem(cfg)
    if (problem) throw new Error(problem)
    const mail = verificationMail(email, verifyUrl)
    await getTransporter(cfg).sendMail({
      from: fromAddress(cfg),
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return { ok: true, driver: cfg.driver }
  }

  throw new Error(`未配置的邮件驱动：${cfg.driver}（可用：console、smtp）`)
}

/**
 * 发送一封测试邮件，用于设置页自检。
 * 与验证邮件走同一条代码路径，因此能真实反映注册时会不会发得出去。
 */
export async function sendTestEmail(to) {
  const cfg = resolveEmailConfig()
  if (cfg.driver !== 'smtp') {
    throw new Error(`当前驱动为 ${cfg.driver}，测试邮件仅在 smtp 驱动下发送`)
  }
  const problem = smtpConfigProblem(cfg)
  if (problem) throw new Error(problem)
  await getTransporter(cfg).sendMail({
    from: fromAddress(cfg),
    to,
    subject: '短剧创作台 · 邮件配置测试',
    text: '如果你收到这封邮件，说明设置页里的 SMTP 配置可用。',
    html: '<p>如果你收到这封邮件，说明设置页里的 SMTP 配置可用。</p>',
  })
  return { ok: true, driver: cfg.driver }
}

/** 配置变更后丢弃缓存的 transporter，让新配置立即生效 */
export function resetEmailTransport() {
  cachedTransporter = null
  cachedConfigKey = ''
}
