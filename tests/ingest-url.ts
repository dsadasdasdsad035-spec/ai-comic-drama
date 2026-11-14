import assert from 'node:assert/strict'
import { extractIngestUrl, isPlatformMediaUrl } from '../src/ingestUrl'

let bad = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${(e as Error).message}`)
  }
}

check('纯 B 站链接', () => {
  const u = 'https://www.bilibili.com/video/BV1xx411c7mD'
  assert.equal(extractIngestUrl(u), u)
  assert.ok(isPlatformMediaUrl(u))
})

check('口令里的抖音短链', () => {
  const text = '7.48 复制打开抖音，看看【标题】 https://v.douyin.com/AbCdEf/ 大米'
  assert.equal(extractIngestUrl(text), 'https://v.douyin.com/AbCdEf/')
})

check('b23 短链', () => {
  const u = 'https://b23.tv/xxxxxx'
  assert.equal(extractIngestUrl(u), u)
})

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)