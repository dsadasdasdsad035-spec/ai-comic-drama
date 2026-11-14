/** 测试档位开关：BILLING_TEST_PACK 控制默认档位是否含 0.01 元档 */
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ' ' + extra}`)
  if (!cond) bad++
}

delete process.env.BILLING_TEST_PACK
const off = await import('./server/billing/constants.mjs')
check('默认 5 档', off.defaultRechargePacks().length === 5)
check('默认不含测试档', !off.defaultRechargePacks().some((p) => p.id === 'test-001'))

process.env.BILLING_TEST_PACK = '1'
const on = await import(`./server/billing/constants.mjs?t=${Date.now()}`)
const packs = on.defaultRechargePacks()
check('开启后 6 档', packs.length === 6, String(packs.length))
const test = packs.find((p) => p.id === 'test-001')
check('测试档 0.01 元 1 Credit', test?.price_cny === 0.01 && test?.credits_total === 1)
check('测试档置顶', packs[0]?.id === 'test-001')

process.exit(bad ? 1 : 0)
