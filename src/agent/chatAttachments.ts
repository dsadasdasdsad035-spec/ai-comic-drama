/**
 * 工作台聊天附件的类型与上限。
 * 图片怎么送给模型由渠道转换决定，这里不再做参考板或视觉摘要。
 */

/** 附件类型决定附件条怎么渲染、sink 怎么消费。 */
export type AttachmentKind = 'image' | 'video' | 'doc' | 'text'

export type ChatAttachment = {
  /** 稳定键：image/video 用 url，doc 用内容哈希，text 用来源键 */
  key: string
  kind: AttachmentKind
  label: string
  /** image / video 的站内地址 */
  url?: string
  /** doc / text 的正文；doc 由切片 2 产生 */
  text?: string
  /** 原始字节数，仅用于展示与上限提示 */
  bytes?: number
  /** 3D 面用来定位 manifest 条目（brief 开关与检查器） */
  manifestKey?: string
}

/**
 * 单轮聊天附件的数量上限。
 * 与角色的 REFERENCE_LIMIT（角色参考图 = 资产容量）数值相同但语义不同：
 * 这里是单轮上下文容量，将来任一方的调整不该牵动另一方。
 */
export const CHAT_ATTACHMENT_LIMIT = 4

/** 只有带地址的图片会进入本轮用户消息。 */
export function imageAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.filter((a) => a.kind === 'image' && Boolean(a.url))
}
