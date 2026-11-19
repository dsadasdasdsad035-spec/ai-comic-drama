/**
 * 运行时基线校验的回归测试。
 *
 * 这里锁死三件事：
 * 1. 版本比较按数字段比较，不能按字符串比较（否则 24.10 < 24.9 会判错）；
 * 2. 低于基线时返回 false 并打印含「当前版本 / 需要版本」的中文提示；
 * 3. 解析不出可比版本时跳过校验，不能因为版本串奇怪就拒绝启动。
 */
import assert from 'node:assert/strict'
import { assertNodeVersion, nodeVersionAtLeast, parseNodeVersion } from '../server/runtime-version.mjs'

let bad = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`✅ ${name}`))
    .catch((e) => {
      bad += 1
      console.error(`❌ ${name}\n   ${e?.message || e}`)
    })
}

await check('解析常见版本串', () => {
  assert.deepEqual(parseNodeVersion('v24.9.0'), [24, 9, 0])
  assert.deepEqual(parseNodeVersion('22.23.2'), [22, 23, 2])
  assert.deepEqual(parseNodeVersion('24.9'), [24, 9, 0])
  assert.equal(parseNodeVersion('not-a-version'), null)
})

await check('按数字段比较而不是字符串比较', () => {
  assert.equal(nodeVersionAtLeast('24.10.0', '24.9.0'), true)
  assert.equal(nodeVersionAtLeast('24.9.0', '24.9.0'), true)
  assert.equal(nodeVersionAtLeast('24.8.9', '24.9.0'), false)
  assert.equal(nodeVersionAtLeast('22.23.2', '24.9.0'), false)
  assert.equal(nodeVersionAtLeast('25.0.0', '24.9.0'), true)
})

await check('版本串无法解析时跳过校验', () => {
  assert.equal(nodeVersionAtLeast('weird', '24.9.0'), true)
  assert.equal(nodeVersionAtLeast('24.9.0', 'weird'), true)
})

await check('低于基线：返回 false 并给出可读中文错误', () => {
  const lines = []
  const ok = assertNodeVersion({ current: '22.23.2', log: (line) => lines.push(line) })
  assert.equal(ok, false)
  const text = lines.join('\n')
  assert.match(text, /Node 版本过低/)
  assert.match(text, /22\.23\.2/)
  assert.match(text, /24\.9\.0/)
  assert.match(text, /nvm install 24/)
})

await check('达标：返回 true 且不打印错误', () => {
  const lines = []
  const ok = assertNodeVersion({ current: '24.22.3', log: (line) => lines.push(line) })
  assert.equal(ok, true)
  assert.deepEqual(lines, [])
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 运行时基线校验全部通过')
process.exit(bad ? 1 : 0)
