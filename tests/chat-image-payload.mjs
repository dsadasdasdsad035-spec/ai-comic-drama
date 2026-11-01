/**
 * 渠道图片转换与消息归一化。
 * 跑法：node tests/chat-image-payload.mjs
 */
import assert from 'node:assert/strict'
import { classifyChatImage, convertChatMessages, MAX_CHAT_IMAGE_BYTES, placeholderText } from '../server/chat-image-payload.mjs'
import { normalizeChatMessages } from '../server/text-tools.mjs'

let bad = 0
function check(name, fn) {
  try {
    fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.log(`❌ ${name}\n   ${e.message}`)
  }
}

const png = { label: '甲', mimeType: 'image/png', data: 'AAAA', bytes: 3 }
const opts = (over) => ({ providerKind: 'apimart', vision: true, ...over })

check('Agent Plan 变成占位且不含 dataURL', () => {
  const out = convertChatMessages(
    [{ role: 'user', content: [{ type: 'text', text: '看这张' }, { type: 'image', ...png }] }],
    opts({ providerKind: 'ark-plan' }),
  )
  assert.equal(typeof out[0].content, 'string')
  assert.equal(out[0].content.includes('data:'), false)
  assert.ok(out[0].content.includes(placeholderText('甲', 'Agent Plan 渠道不接收图片')))
  assert.ok(out[0].content.includes('看这张'))
})

check('没有 vision 能力时占位', () => {
  const decision = classifyChatImage(png, opts({ vision: false }))
  assert.equal(decision.sent, false)
  assert.equal(decision.reason, '当前模型不能看图')
})

check('可看图渠道转成 image_url', () => {
  const out = convertChatMessages(
    [{ role: 'user', content: [{ type: 'text', text: '看这张' }, { type: 'image', ...png }] }],
    opts(),
  )
  const content = out[0].content
  assert.ok(Array.isArray(content))
  const image = content.find((part) => part.type === 'image_url')
  assert.equal(image.image_url.url, 'data:image/png;base64,AAAA')
})

check('超过 4MB 只占位该张', () => {
  const out = convertChatMessages(
    [{
      role: 'user',
      content: [
        { type: 'image', ...png },
        { type: 'image', label: '乙', mimeType: 'image/png', data: 'BBBB', bytes: MAX_CHAT_IMAGE_BYTES + 1 },
      ],
    }],
    opts(),
  )
  const content = out[0].content
  assert.equal(content.filter((part) => part.type === 'image_url').length, 1)
  assert.ok(content.some((part) => part.type === 'text' && part.text.includes('单张超过 4MB')))
})

check('损坏的 base64 占位', () => {
  const decision = classifyChatImage({ label: '坏', mimeType: 'image/png', data: '@@@' }, opts())
  assert.equal(decision.sent, false)
  assert.equal(decision.reason, '图片无法解码')
})

check('没有图片时仍是字符串', () => {
  const out = convertChatMessages([{ role: 'user', content: '只有文字' }], opts())
  assert.equal(out[0].content, '只有文字')
})

check('字符串消息保持不变', () => {
  const out = normalizeChatMessages([{ role: 'user', content: '你好' }])
  assert.equal(out[0].content, '你好')
})

check('图片块保留，未知块丢弃', () => {
  const out = normalizeChatMessages([{
    role: 'user',
    content: [
      { type: 'text', text: '看' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png', label: '甲' },
      { type: 'audio', data: 'nope' },
    ],
  }])
  assert.deepEqual(out[0].content, [
    { type: 'text', text: '看' },
    { type: 'image', data: 'AAAA', mimeType: 'image/png', label: '甲' },
  ])
})

if (bad) {
  console.log(`\n${bad} 项失败`)
  process.exit(1)
}
console.log('\n全部通过')
