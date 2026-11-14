/** 开发默认：验证链接打到控制台；生产可扩展 SMTP */
export async function sendVerificationEmail(email, verifyUrl) {
  const driver = String(process.env.BILLING_EMAIL_DRIVER || 'console').toLowerCase()
  if (driver === 'console') {
    console.log(`[billing] 验证邮箱 ${email} → ${verifyUrl}`)
    return { ok: true, driver: 'console' }
  }
  throw new Error(`未配置的邮件驱动：${driver}`)
}