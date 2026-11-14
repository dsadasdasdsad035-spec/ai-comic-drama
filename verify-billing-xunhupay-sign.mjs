import { makeSign, verifyNotify } from './server/billing/xunhupay.mjs'

let bad = 0
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`)
  if (!cond) bad++
}

const secret = 'test_secret'
const params = { appid: 'a', trade_order_id: 't1', total_fee: '1.00', time: '1', nonce_str: 'n' }
const hash = makeSign(params, secret)
check('签名长度', hash.length === 32)
check('验签', verifyNotify({ ...params, hash }, secret))

process.exit(bad ? 1 : 0)