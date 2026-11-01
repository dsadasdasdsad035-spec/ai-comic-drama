/**
 * 聊天图片在发往渠道前的转换。
 * 不依赖 Node API，界面预览与 /api/text 用同一份规则。
 */

export const MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024

const IMAGE_MIME = /^image\/(png|jpe?g|webp)$/

function decodedByteLength(data) {
  const clean = String(data || '').replace(/\s/g, '')
  if (!clean || clean.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return null
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.floor((clean.length * 3) / 4) - pad
}

export function placeholderText(label, reason) {
  return `图片「${label}」未送入模型：${reason}`
}

/**
 * 判断一张图是送出还是占位。
 * 解码失败和超限优先于渠道能力，这样原因与渠道无关。
 */
export function classifyChatImage(image, { providerKind, vision }) {
  const label = String(image?.label || '').trim() || '未命名'
  const declared = Number(image?.bytes)
  const bytes = Number.isFinite(declared) && declared >= 0 ? declared : decodedByteLength(image?.data)
  if (bytes == null) return { label, sent: false, reason: '图片无法解码' }
  if (bytes > MAX_CHAT_IMAGE_BYTES) return { label, sent: false, reason: '单张超过 4MB' }
  const mimeType = String(image?.mimeType || '')
  if (!IMAGE_MIME.test(mimeType)) return { label, sent: false, reason: '图片无法解码' }
  if (!String(image?.data || '').trim()) return { label, sent: false, reason: '图片无法解码' }
  if (providerKind === 'ark-plan') return { label, sent: false, reason: 'Agent Plan 渠道不接收图片' }
  if (!vision) return { label, sent: false, reason: '当前模型不能看图' }
  return { label, sent: true, mimeType }
}

function textOf(block) {
  return String(block?.text || '')
}

/**
 * 把用户消息里的图片块转成渠道报文。
 * 没有图片时保持原字符串。占位全部是文字时收成字符串，避免不能看图的渠道收到内容数组。
 */
export function convertChatMessages(messages, options) {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => {
    if (!message || message.role !== 'user' || typeof message.content === 'string' || !Array.isArray(message.content)) {
      return message
    }
    const parts = []
    let sawImage = false
    for (const block of message.content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text') {
        const text = textOf(block)
        if (text) parts.push({ type: 'text', text })
        continue
      }
      if (block.type !== 'image') continue
      sawImage = true
      const decision = classifyChatImage(block, options || {})
      if (decision.sent) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${decision.mimeType};base64,${String(block.data)}` },
        })
      } else {
        parts.push({ type: 'text', text: placeholderText(decision.label, decision.reason) })
      }
    }
    if (!sawImage && parts.length === 1 && parts[0].type === 'text') {
      return { ...message, content: parts[0].text }
    }
    if (!parts.some((part) => part.type === 'image_url')) {
      return { ...message, content: parts.map((part) => part.text).filter(Boolean).join('\n') }
    }
    return { ...message, content: parts }
  })
}

export function imageContextLines(items) {
  return (items || []).map((item) =>
    item.sent ? `${item.label}：已作为图片送出` : `${item.label}：未送入模型（${item.reason || '未送入模型'}）`,
  )
}
