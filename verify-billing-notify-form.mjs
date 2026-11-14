/**
 * 虎皮椒异步通知（form-urlencoded）回归：
 * 线上真实回调是 application/x-www-form-urlencoded，且必须回纯文本 success。
 * 曾因按 JSON 解析导致 500、支付成功却不入账。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { openBillingDbFile, getBillingDb } from './server/billing/db.mjs'
import { registerUser } from './server/billing/auth.mjs'
import { getWalletSummary } from './server/billing/wallet.mjs'
import { makeSign } from './server/billing/xunhupay.mjs'
import { handleBillingHttp } from './server/billing/http.mjs'

let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) bad++
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bill-notify-'))
const file = path.join(root, 'billing.sqlite')
process.env.BILLING_DB_PATH = file
process.env.XUNHUPAY_SECRET = 'notify-secret'
process.env.XUNHUPAY_APPID = '201906181960'
openBillingDbFile(file)

const { userId } = registerUser('notify@example.com', 'password12345')
const trade = 'order_notify_1'
getBillingDb()
  .prepare(
    `INSERT INTO payment_orders (user_id, trade_order_id, pack_id, amount_cny, credits_micro, status)
     VALUES (?, ?, 'starter', 72.5, ?, 'pending')`,
  )
  .run(userId, trade, 100 * 1_000_000)

function mockReq(formBody) {
  const req = Readable.from([Buffer.from(formBody, 'utf8')])
  req.method = 'POST'
  req.url = '/api/billing/xunhupay/notify'
  req.headers = {
    'content-type': 'application/x-www-form-urlencoded',
    host: '127.0.0.1:5273',
  }
  return req
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[String(k).toLowerCase()] = v
    },
    end(chunk) {
      if (chunk) this.body += String(chunk)
    },
  }
}

const params = {
  trade_order_id: trade,
  total_fee: '72.50',
  transaction_id: 'tx_1',
  open_order_id: 'HPJ1',
  status: 'OD',
  appid: '201906181960',
  time: '1794662575',
  nonce_str: 'abc',
}
params.hash = makeSign(params, process.env.XUNHUPAY_SECRET)
const form = new URLSearchParams(params).toString()

const readJson = async (req) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const res = mockRes()
await handleBillingHttp(mockReq(form), res, '/api/billing/xunhupay/notify', readJson, root)

check('HTTP 200', res.statusCode === 200, `got ${res.statusCode} ${res.body}`)
check('正文为 success', res.body.trim() === 'success', `got ${res.body}`)
const order = getBillingDb().prepare('SELECT * FROM payment_orders WHERE trade_order_id = ?').get(trade)
check('订单已 paid', order?.status === 'paid', String(order?.status))
check('入账 100 Credits', getWalletSummary(userId).credits === 100, String(getWalletSummary(userId).credits))

// 重复回调：仍返回 success，且不重复入账
const res2 = mockRes()
await handleBillingHttp(mockReq(form), res2, '/api/billing/xunhupay/notify', readJson, root)
check('重复回调幂等', res2.statusCode === 200 && getWalletSummary(userId).credits === 100)

// 签名错误：400
const badParams = { ...params, hash: 'deadbeef' }
const res3 = mockRes()
await handleBillingHttp(
  mockReq(new URLSearchParams(badParams).toString()),
  res3,
  '/api/billing/xunhupay/notify',
  readJson,
  root,
)
check('错误签名 400', res3.statusCode === 400, String(res3.statusCode))

process.exit(bad ? 1 : 0)
