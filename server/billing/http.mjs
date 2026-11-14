import crypto from 'node:crypto'
import { openBillingDb } from './db.mjs'
import {
  registerAndNotify,
  resendVerification,
  loginUser,
  logoutToken,
  verifyEmail,
  sessionFromToken,
  parseSessionCookie,
  parseBearer,
  isBillingAdmin,
  grantSignupBonusOnce,
} from './auth.mjs'
import { getBillingSettings, patchBillingSettings, publicBillingSettings } from './settings.mjs'
import { getWalletSummary, listLedger, creditWallet } from './wallet.mjs'
import { microFromCredits, testPackEnabled } from './constants.mjs'
import { createPayment, verifyNotify, xunhuConfigured, queryPayment } from './xunhupay.mjs'
import { getBillingDb, withBillingTxn } from './db.mjs'
import { seedPriceCatalogIfEmpty } from './price-catalog.mjs'
import { buildReconciliationReport, simulatePaymentPaid } from './reconcile.mjs'
import { sendTestEmail, resolveEmailConfig, resetEmailTransport } from './email.mjs'

let billingRoot = ''

export function initBilling(appRoot) {
  billingRoot = appRoot
  openBillingDb(appRoot)
  seedPriceCatalogIfEmpty()
}

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `sb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`,
  )
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
}

function requireSession(req) {
  const raw = parseBearer(req.headers?.authorization) || parseSessionCookie(req.headers?.cookie)
  const s = sessionFromToken(raw)
  if (!s) throw Object.assign(new Error('未登录'), { status: 401, kind: 'auth' })
  return { ...s, rawToken: raw }
}

/** 虎皮椒异步通知是 form-urlencoded（部分网关调试会发 JSON），两种都要吃 */
async function readNotifyParams(req, readJson) {
  const ct = String(req.headers?.['content-type'] || '').toLowerCase()
  if (ct.includes('application/json')) return await readJson(req)
  const raw = await new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 256 * 1024) {
        reject(new Error('回调内容过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
  const text = String(raw || '').trim()
  if (!text) return {}
  if (ct.includes('x-www-form-urlencoded') || text.includes('=')) {
    return Object.fromEntries(new URLSearchParams(text))
  }
  try {
    return JSON.parse(text)
  } catch {
    return Object.fromEntries(new URLSearchParams(text))
  }
}

function plainText(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(body)
}

/** 订单入账（幂等）：已 paid 直接返回 */
function settleOrderPaid(order, payload = {}) {
  const d = getBillingDb()
  if (order.status === 'paid') return false
  d.prepare(
    `UPDATE payment_orders SET status = 'paid', paid_at = datetime('now'), notify_payload = ? WHERE trade_order_id = ?`,
  ).run(JSON.stringify(payload), order.trade_order_id)
  const credits = order.credits_micro / 1_000_000
  creditWallet(order.user_id, credits, 'recharge', 'payment_order', order.trade_order_id, {
    pack_id: order.pack_id,
  })
  return true
}

function publicBase(req) {
  const host = req.headers?.host || '127.0.0.1:5273'
  const proto = String(req.headers['x-forwarded-proto'] || 'http')
  return `${proto}://${host}`
}

export async function handleBillingHttp(req, res, url, readJson, appRoot) {
  if (!url.startsWith('/api/auth/') && !url.startsWith('/api/billing/')) return false

  try {
    initBilling(appRoot || billingRoot || process.cwd())

    if (url === '/api/auth/register' && req.method === 'POST') {
      const body = await readJson(req)
      const out = await registerAndNotify(body.email, body.password, publicBase(req))
      // 邮件没发出去时不谎报：注册仍然成功，但要明确告知并用 resend 重试
      if (!out.emailSent) {
        json(res, 200, {
          ok: true,
          email: out.email,
          email_sent: false,
          message: `账户已创建，但验证邮件发送失败：${out.emailError || '未知原因'}。请检查邮件服务配置后点击「重发验证邮件」。`,
        })
        return true
      }
      json(res, 200, {
        ok: true,
        email: out.email,
        email_sent: true,
        message:
          out.driver === 'console'
            ? '账户已创建。当前为 console 邮件驱动，验证链接已打印到服务端日志。'
            : '验证邮件已发送，请查收后在邮箱中完成验证。',
      })
      return true
    }

    if (url === '/api/auth/resend-verify' && req.method === 'POST') {
      const body = await readJson(req)
      const out = await resendVerification(body.email, publicBase(req))
      // 成功与「已存在/已跳过」用同一句话，避免通过响应差异探测邮箱是否注册过。
      // 仅当确实尝试发信且发信失败时才明确报错，否则运维无法发现邮件服务故障。
      json(res, 200, {
        ok: true,
        message:
          out.skipped || out.emailSent
            ? '如果该邮箱已注册且未验证，验证邮件会很快送达。'
            : '验证邮件发送失败，请稍后重试或联系管理员。',
      })
      return true
    }

    if (url.startsWith('/api/auth/verify') && req.method === 'GET') {
      const q = new URL(req.url || '', 'http://x')
      const token = q.searchParams.get('token') || ''
      verifyEmail(token)
      json(res, 200, { ok: true, message: '邮箱已验证，可以登录' })
      return true
    }

    if (url === '/api/auth/login' && req.method === 'POST') {
      const body = await readJson(req)
      const out = loginUser(body.email, body.password)
      setSessionCookie(res, out.token)
      json(res, 200, { ok: true, user: out.user })
      return true
    }

    if (url === '/api/auth/logout' && req.method === 'POST') {
      const raw = parseBearer(req.headers?.authorization) || parseSessionCookie(req.headers?.cookie)
      logoutToken(raw)
      clearSessionCookie(res)
      json(res, 200, { ok: true })
      return true
    }

    if (url === '/api/auth/me' && req.method === 'GET') {
      const raw = parseBearer(req.headers?.authorization) || parseSessionCookie(req.headers?.cookie)
      const s = sessionFromToken(raw)
      if (!s) {
        json(res, 200, { ok: true, user: null })
        return true
      }
      json(res, 200, {
        ok: true,
        user: { id: s.userId, email: s.email, email_verified: s.emailVerified, is_admin: isBillingAdmin(s.email) },
        wallet: getWalletSummary(s.userId),
      })
      return true
    }

      // 会话探测：只回答「有没有有效登录态」，供 nginx auth_request 给静态媒体放行。
      // 不用 /api/auth/me，因为它对未登录也返回 200，auth_request 无法据此区分。
    if (url === '/api/auth/session-check' && req.method === 'GET') {
      const raw = parseBearer(req.headers?.authorization) || parseSessionCookie(req.headers?.cookie)
      const s = sessionFromToken(raw)
      if (!s) {
        json(res, 401, { ok: false, kind: 'auth', code: 'login_required', message: '未登录' })
        return true
      }
      json(res, 200, { ok: true, user_id: s.userId })
      return true
    }

    if (url === '/api/billing/wallet' && req.method === 'GET') {
      const s = requireSession(req)
      json(res, 200, { ok: true, wallet: getWalletSummary(s.userId) })
      return true
    }

    if (url === '/api/billing/ledger' && req.method === 'GET') {
      const s = requireSession(req)
      const q = new URL(req.url || '', 'http://x')
      const limit = Math.min(100, Math.max(1, Number(q.searchParams.get('limit')) || 50))
      const offset = Math.max(0, Number(q.searchParams.get('offset')) || 0)
      json(res, 200, { ok: true, entries: listLedger(s.userId, limit, offset) })
      return true
    }

    if (url === '/api/billing/packs' && req.method === 'GET') {
      const packs = getBillingSettings().recharge_packs.filter((p) => p.enabled !== false)
      json(res, 200, { ok: true, packs })
      return true
    }

    if (url.startsWith('/api/billing/order') && req.method === 'GET') {
      const s = requireSession(req)
      const q = new URL(req.url || '', 'http://x')
      const tradeId = String(q.searchParams.get('trade_order_id') || '').trim()
      if (!tradeId) {
        json(res, 400, { ok: false, message: '缺少 trade_order_id' })
        return true
      }
      const order = getBillingDb()
        .prepare('SELECT * FROM payment_orders WHERE trade_order_id = ? AND user_id = ?')
        .get(tradeId, s.userId)
      if (!order) {
        json(res, 404, { ok: false, message: '订单不存在' })
        return true
      }
      // 回调可能丢失（被反代拦截、网络抖动），待支付时主动查上游补单
      if (order.status === 'pending' && xunhuConfigured()) {
        try {
          const up = await queryPayment(tradeId)
          if (up.paid) {
            settleOrderPaid(order, { source: 'xunhupay_query', ...up.data })
            const fresh = getBillingDb()
              .prepare('SELECT status, paid_at FROM payment_orders WHERE trade_order_id = ?')
              .get(tradeId)
            order.status = fresh?.status || 'paid'
            order.paid_at = fresh?.paid_at || null
          }
        } catch (e) {
          console.warn('[billing] 主动查单失败', tradeId, (e && e.message) || e)
        }
      }
      json(res, 200, {
        ok: true,
        status: order.status,
        pack_id: order.pack_id,
        amount_cny: order.amount_cny,
        credits: order.credits_micro / 1_000_000,
        paid_at: order.paid_at,
      })
      return true
    }

    if (url === '/api/billing/settings' && req.method === 'GET') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      json(res, 200, { ok: true, settings: publicBillingSettings() })
      return true
    }

    if (url === '/api/billing/settings' && req.method === 'PATCH') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      const body = await readJson(req)
      const next = patchBillingSettings(body || {})
      // 邮件配置可能变了，丢弃缓存的 transporter，否则要用旧账号才生效
      resetEmailTransport()
      json(res, 200, { ok: true, settings: publicBillingSettings(next) })
      return true
    }

    if (url === '/api/billing/email-status' && req.method === 'GET') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      const cfg = resolveEmailConfig()
      json(res, 200, {
        ok: true,
        driver: cfg.driver,
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        user: cfg.user,
        from: cfg.from,
        pass_set: Boolean(cfg.pass),
      })
      return true
    }

    if (url === '/api/billing/email-test' && req.method === 'POST') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      const body = await readJson(req)
      const to = String(body.to || s.email).trim()
      if (!to) {
        json(res, 400, { ok: false, message: '请填写收件邮箱' })
        return true
      }
      try {
        await sendTestEmail(to)
        json(res, 200, { ok: true, message: `测试邮件已发送至 ${to}` })
      } catch (e) {
        json(res, 400, { ok: false, message: `发送失败：${e?.message || String(e)}` })
      }
      return true
    }

    if (url === '/api/billing/recharge' && req.method === 'POST') {
      const s = requireSession(req)
      if (!xunhuConfigured()) {
        json(res, 503, { ok: false, kind: 'config', message: '虎皮椒未配置：请设置 XUNHUPAY_APPID 与 XUNHUPAY_SECRET' })
        return true
      }
      const body = await readJson(req)
      const packId = String(body.packId || '')
      const pack = getBillingSettings().recharge_packs.find((p) => p.id === packId && p.enabled !== false)
      if (!pack) {
        json(res, 400, { ok: false, message: '无效的充值档位' })
        return true
      }
      // 低于 1 元的档位只允许在测试开关下购买，避免测试档被公开薅积分
      if (Number(pack.price_cny) < 1 && !testPackEnabled()) {
        json(res, 403, { ok: false, message: '该测试档位未启用（需 BILLING_TEST_PACK=1）' })
        return true
      }
      const tradeOrderId = `sb_${s.userId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
      const creditsMicro = microFromCredits(pack.credits_total)
      const d = getBillingDb()
      d.prepare(
        `INSERT INTO payment_orders (user_id, trade_order_id, pack_id, amount_cny, credits_micro, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
      ).run(s.userId, tradeOrderId, packId, pack.price_cny, creditsMicro)
      const notifyUrl = String(process.env.XUNHUPAY_NOTIFY_URL || `${publicBase(req)}/api/billing/xunhupay/notify`)
      const pay = await createPayment({
        tradeOrderId,
        totalFeeCny: pack.price_cny,
        title: `积分充值-${pack.title}`,
        notifyUrl,
        returnUrl: String(body.returnUrl || ''),
      })
      d.prepare('UPDATE payment_orders SET xunhu_open_order_id = ? WHERE trade_order_id = ?').run(
        String(pay.open_order_id || ''),
        tradeOrderId,
      )
      json(res, 200, {
        ok: true,
        trade_order_id: tradeOrderId,
        url: pay.url,
        url_qrcode: pay.url_qrcode,
        credits: pack.credits_total,
      })
      return true
    }

    if (url === '/api/billing/reconcile' && req.method === 'GET') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      json(res, 200, { ok: true, report: buildReconciliationReport() })
      return true
    }

    if (url === '/api/billing/simulate-paid' && req.method === 'POST') {
      const s = requireSession(req)
      if (!isBillingAdmin(s.email)) {
        json(res, 403, { ok: false, message: '需要计费管理员权限' })
        return true
      }
      const body = await readJson(req)
      const out = simulatePaymentPaid(String(body.trade_order_id || ''))
      json(res, 200, { ok: true, ...out })
      return true
    }

    if (url === '/api/billing/xunhupay/notify' && req.method === 'POST') {
      // 虎皮椒要求：处理成功返回纯文本 success，否则会重复通知
      const body = await readNotifyParams(req, readJson)
      const secret = process.env.XUNHUPAY_SECRET
      if (!secret || !verifyNotify(body, secret)) {
        plainText(res, 400, 'fail: sign')
        return true
      }
      const tradeId = String(body.trade_order_id || '')
      const d = getBillingDb()
      const order = d.prepare('SELECT * FROM payment_orders WHERE trade_order_id = ?').get(tradeId)
      if (!order) {
        plainText(res, 404, 'fail: order not found')
        return true
      }
      if (order.status === 'paid') {
        plainText(res, 200, 'success')
        return true
      }
      const status = String(body.status || 'OD')
      if (status !== 'OD') {
        plainText(res, 200, 'success')
        return true
      }
      const paidFee = Number(body.total_fee)
      if (!Number.isFinite(paidFee) || Math.abs(paidFee - Number(order.amount_cny)) > 0.01) {
        plainText(res, 400, 'fail: amount mismatch')
        return true
      }
      settleOrderPaid(order, body)
      plainText(res, 200, 'success')
      return true
    }

    json(res, 404, { ok: false, message: '未知计费接口' })
    return true
  } catch (e) {
    const status = e.status || 500
    json(res, status, { ok: false, kind: e.kind || 'api', message: e.message || String(e) })
    return true
  }
}