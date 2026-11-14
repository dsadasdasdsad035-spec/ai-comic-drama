/**
 * 验证邮件驱动：console / 未配置 / smtp 配置缺失 三种情况都不得崩溃，
 * 且发信失败时必须如实返回 emailSent=false。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openBillingDbFile } from './server/billing/db.mjs'
import { registerAndNotify, resendVerification } from './server/billing/auth.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) bad++
}

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mail-')), 'billing.sqlite')
process.env.BILLING_DB_PATH = file
process.env.BILLING_ALLOW_SIMULATE = '1'
openBillingDbFile(file)

const BASE = 'http://127.0.0.1:5273'

// 1) console 驱动：正常返回已发送（链接进日志）
delete process.env.BILLING_EMAIL_DRIVER
const r1 = await registerAndNotify('a@example.com', 'password123', BASE)
check('console 驱动注册不崩溃', r1.emailSent === true, `driver=${r1.driver}`)

// 2) 未知驱动：必须不崩溃，且如实报告失败
process.env.BILLING_EMAIL_DRIVER = 'carrier-pigeon'
const r2 = await registerAndNotify('b@example.com', 'password123', BASE)
check('未知驱动不崩溃', true)
check('未知驱动如实报失败', r2.emailSent === false, r2.emailError)
check('未配置驱动错误信息可读', /未配置的邮件驱动/.test(r2.emailError || ''), r2.emailError)

// 3) smtp 但缺配置：必须不崩溃，且给出明确原因
process.env.BILLING_EMAIL_DRIVER = 'smtp'
delete process.env.BILLING_SMTP_HOST
const r3 = await registerAndNotify('c@example.com', 'password123', BASE)
check('smtp 缺 host 不崩溃', true)
check('smtp 缺 host 如实报失败', r3.emailSent === false, r3.emailError)
check('缺 host 提示指向具体变量', /BILLING_SMTP_HOST/.test(r3.emailError || ''), r3.emailError)

// 4) smtp 有 host 但连接不上：不得崩溃，如实报失败
process.env.BILLING_SMTP_HOST = '127.0.0.1'
process.env.BILLING_SMTP_PORT = '2'
process.env.BILLING_SMTP_USER = 'u@example.com'
process.env.BILLING_SMTP_PASS = 'x'
const r4 = await registerAndNotify('d@example.com', 'password123', BASE)
check('smtp 连接失败不崩溃', true)
check('smtp 连接失败如实报失败', r4.emailSent === false, String(r4.emailError).slice(0, 60))

// 5) 重发：已注册未验证 → 走真实发送；已验证 → skipped
process.env.BILLING_EMAIL_DRIVER = 'console'
const r5 = await resendVerification('a@example.com', BASE)
check('重发已注册未验证', r5.skipped === false && r5.emailSent === true)
const r6 = await resendVerification('nobody@example.com', BASE)
check('重发未注册返回跳过（不泄露）', r6.skipped === true)

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)
