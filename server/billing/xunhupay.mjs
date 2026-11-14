import crypto from 'node:crypto'

export function xunhuConfigured() {
  return Boolean(
    String(process.env.XUNHUPAY_APPID || '').trim() && String(process.env.XUNHUPAY_SECRET || '').trim(),
  )
}

export function xunhuGateway() {
  return String(process.env.XUNHUPAY_GATEWAY || 'https://api.xunhupay.com').replace(/\/+$/, '')
}

export function makeSign(params, secret) {
  const filtered = {}
  for (const [k, v] of Object.entries(params)) {
    if (v === '' || v === null || v === undefined || k === 'hash') continue
    filtered[k] = String(v)
  }
  const query = Object.keys(filtered)
    .sort()
    .map((k) => `${k}=${filtered[k]}`)
    .join('&')
  return crypto.createHash('md5').update(query + secret).digest('hex')
}

export function verifyNotify(params, secret) {
  const hash = String(params.hash || '')
  const copy = { ...params }
  delete copy.hash
  return makeSign(copy, secret) === hash
}

export async function createPayment({ tradeOrderId, totalFeeCny, title, notifyUrl, returnUrl = '', callbackUrl = '' }) {
  const appid = process.env.XUNHUPAY_APPID
  const secret = process.env.XUNHUPAY_SECRET
  if (!appid || !secret) throw new Error('虎皮椒未配置：请设置 XUNHUPAY_APPID 与 XUNHUPAY_SECRET')
  const params = {
    version: '1.1',
    appid,
    trade_order_id: tradeOrderId,
    total_fee: Number(totalFeeCny).toFixed(2),
    title,
    notify_url: notifyUrl,
    return_url: returnUrl,
    callback_url: callbackUrl,
    time: String(Math.floor(Date.now() / 1000)),
    nonce_str: crypto.randomBytes(16).toString('hex'),
  }
  params.hash = makeSign(params, secret)
  const resp = await fetch(`${xunhuGateway()}/payment/do.html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(params),
  })
  const result = await resp.json().catch(() => ({}))
  if (Number(result.errcode) !== 0) {
    throw new Error(result.errmsg || '虎皮椒发起支付失败')
  }
  return result
}