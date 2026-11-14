import crypto from 'node:crypto'
import { isBillingEnabled } from './settings.mjs'
import {
  sessionFromToken,
  parseSessionCookie,
  parseBearer,
} from './auth.mjs'
import { holdCredits, releaseHold, settleFromHold } from './wallet.mjs'
import {
  estimateTextCredits,
  settleTextCredits,
  estimateImageCredits,
  estimateVideoCredits,
  creditsToMicro,
  seedPriceCatalogIfEmpty,
} from './price-catalog.mjs'
import { creditsFromMicro } from './constants.mjs'

export function isPlatformApimartKey(provider) {
  const own = String(provider?.apiKey || '').trim()
  if (own) return false
  const env = String(process.env.APIB_API_KEY || process.env.APIMART_API_KEY || '').trim()
  return Boolean(env)
}

export function sessionFromRequest(req) {
  const bearer = parseBearer(req.headers?.authorization)
  const cookie = parseSessionCookie(req.headers?.cookie)
  return sessionFromToken(bearer || cookie)
}

export function billingDecision(provider, req) {
  if (!isBillingEnabled()) return { skipBilling: true, reason: 'disabled' }
  try {
    seedPriceCatalogIfEmpty()
  } catch {
    /* 库未初始化时仅做 BYOK/开关判断 */
  }
  if (provider?.kind !== 'apimart') return { skipBilling: true, reason: 'not-apimart' }
  if (!isPlatformApimartKey(provider)) return { skipBilling: true, reason: 'byok' }
  const session = sessionFromRequest(req)
  if (!session) {
    return {
      skipBilling: false,
      error: { status: 401, kind: 'auth', code: 'login_required', message: '平台代调用需要先登录' },
    }
  }
  if (!session.emailVerified) {
    return {
      skipBilling: false,
      error: {
        status: 403,
        kind: 'auth',
        code: 'email_unverified',
        message: '请先完成邮箱验证后再使用平台积分',
      },
    }
  }
  return { skipBilling: false, session, traceId: crypto.randomBytes(8).toString('hex') }
}

export function guardApimartText({ provider, req, model, body }) {
  const base = billingDecision(provider, req)
  if (base.skipBilling) return base
  if (base.error) return base
  const promptEst = Math.ceil(String(body?.prompt || JSON.stringify(body?.messages || '')).length / 4)
  const maxOut = Number(body?.maxTokens) || 8192
  const est = estimateTextCredits(model, promptEst, maxOut)
  try {
    holdCredits(base.session.userId, est)
  } catch {
    return {
      error: {
        status: 402,
        kind: 'billing',
        code: 'user_insufficient_credits',
        message: '平台积分不足，请充值后再试',
      },
    }
  }
  return { ...base, cap: 'text', model, holdCredits: est, estimateCredits: est }
}

export function finalizeApimartText(ctx, usage) {
  if (ctx?.skipBilling || !ctx?.session) return
  const actual = settleTextCredits(ctx.model, usage)
  const hold = ctx.holdCredits ?? ctx.estimateCredits ?? actual
  try {
    settleFromHold(ctx.session.userId, hold, actual, {
      cap: 'text',
      model: ctx.model,
      trace_id: ctx.traceId,
      usage,
    })
  } catch (e) {
    releaseHold(ctx.session.userId, hold)
    throw e
  }
  if (actual < hold) releaseHold(ctx.session.userId, hold - actual)
}

export function guardApimartImage({ provider, req, model, n = 1, specKey = 'default' }) {
  const base = billingDecision(provider, req)
  if (base.skipBilling) return base
  if (base.error) return base
  const est = estimateImageCredits(model, n, specKey)
  try {
    holdCredits(base.session.userId, est)
  } catch {
    return {
      error: {
        status: 402,
        kind: 'billing',
        code: 'user_insufficient_credits',
        message: '平台积分不足，请充值后再试',
      },
    }
  }
  return { ...base, cap: 'image', model, holdCredits: est, estimateCredits: est, qty: n }
}

export function finalizeApimartImage(ctx, actualCredits = null) {
  if (ctx?.skipBilling || !ctx?.session) return
  const actual = actualCredits ?? ctx.estimateCredits
  const hold = ctx.holdCredits ?? actual
  settleFromHold(ctx.session.userId, hold, actual, {
    cap: 'image',
    model: ctx.model,
    qty: ctx.qty ?? 1,
    trace_id: ctx.traceId,
  })
}

export function guardApimartVideo({ provider, req, model, seconds, res = '480p' }) {
  const base = billingDecision(provider, req)
  if (base.skipBilling) return base
  if (base.error) return base
  const est = estimateVideoCredits(model, seconds, res)
  try {
    holdCredits(base.session.userId, est)
  } catch {
    return {
      error: {
        status: 402,
        kind: 'billing',
        code: 'user_insufficient_credits',
        message: '平台积分不足，请充值后再试',
      },
    }
  }
  return { ...base, cap: 'video', model, holdCredits: est, estimateCredits: est, seconds }
}

export function finalizeApimartVideo(ctx, actualCredits = null) {
  if (ctx?.skipBilling || !ctx?.session) return
  const actual = actualCredits ?? ctx.estimateCredits
  const hold = ctx.holdCredits ?? actual
  settleFromHold(ctx.session.userId, hold, actual, {
    cap: 'video',
    model: ctx.model,
    qty: ctx.seconds,
    trace_id: ctx.traceId,
  })
}

export function releaseApimartHold(ctx) {
  if (ctx?.skipBilling || !ctx?.session || !ctx.holdCredits) return
  releaseHold(ctx.session.userId, ctx.holdCredits)
}

export function upstreamApimartBillingMessage(err) {
  return {
    kind: 'billing',
    code: 'upstream_apimart_balance',
    message: '平台上游 APIMart 余额不足，请联系管理员处理',
    detail: err?.message || '',
  }
}

export function microEstimateSummary(ctx) {
  if (!ctx?.estimateCredits) return null
  return { credits: ctx.estimateCredits, micro: creditsToMicro(ctx.estimateCredits) }
}
