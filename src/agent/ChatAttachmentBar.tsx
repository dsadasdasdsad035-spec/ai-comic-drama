/**
 * 聊天输入区的附件条：显示本次对话已选的附件，按类型渲染，并提供上传与选素材入口。
 *
 * 位置固定在输入框上方、与发送操作同属一个输入区（见 ChatThreadBody）。
 * 这里只负责展示与选择；附件怎么被理解、最终写到哪里由调用方（sink）决定，
 * 所以本组件不发任何网络请求。
 *
 * 交互沿用既有约定：点击已选项移除，点击可选项加入。
 */
import type { ReactNode } from 'react'
import type { AttachmentKind, ChatAttachment } from './chatAttachments'

/** 可直接加入的可选项（快捷缩略图）；真正的全库选择走 onPick */
export type AttachmentOption = { key: string; label: string; url: string }

export type ChatAttachmentBarProps = {
  /** 本次对话已选 */
  items: ChatAttachment[]
  /** 单次附件上限；所有类型共享同一计数 */
  limit: number
  /** 可快速点选的来源；与已选合并成一条带 */
  available?: AttachmentOption[]
  /** 正在理解图片 */
  busy?: boolean
  /** 理解成功时的简短回执，例如「已理解 2 张」 */
  understood?: number
  /** 降级原因或其它需要就地说明的情况 */
  warning?: string
  hint?: string
  /** 是否禁用移除与新增（例如正在运行） */
  locked?: boolean
  onAdd?: (item: AttachmentOption) => void
  onRemove: (key: string) => void
  onClear?: () => void
  /** 上传入口；不提供时不显示 */
  onUpload?: () => void
  uploadBusy?: boolean
  /** 从项目素材里选；不提供时不显示 */
  onPick?: () => void
  picking?: boolean
  /** 每项的附加控件（3D 的 brief 排除开关用它接入） */
  extra?: (item: ChatAttachment) => ReactNode
  /** 条带右上的附加控件（3D 的「查看将发送」用它接入） */
  actions?: ReactNode
}

function kindLabel(kind: AttachmentKind): string {
  if (kind === 'image') return '图'
  if (kind === 'video') return '视频'
  if (kind === 'doc') return '文档'
  return '文本'
}

function AttachmentThumb({ item }: { item: ChatAttachment }) {
  if (item.kind === 'image' && item.url) {
    return <img src={item.url} alt={item.label} data-ca-thumb-img />
  }
  // 视频与文档没有可靠缩略图：给类型标记，而不是空框或注定加载失败的 <img>
  return (
    <span className="ca-thumb-kind" data-ca-thumb-kind={item.kind}>
      {kindLabel(item.kind)}
    </span>
  )
}

export function ChatAttachmentBar({
  items,
  limit,
  available = [],
  busy,
  understood,
  warning,
  hint,
  locked,
  onAdd,
  onRemove,
  onClear,
  onUpload,
  uploadBusy,
  onPick,
  picking,
  extra,
  actions,
}: ChatAttachmentBarProps) {
  const full = items.length >= limit
  const chosen = new Set(items.map((s) => s.key))
  /** 可选但还没加入的快捷项；已选的由 items 单独渲染，避免同一条目出现两次 */
  const options = available.filter((a) => !chosen.has(a.key))
  const showEntries = Boolean(items.length || options.length || onUpload || onPick)

  return (
    <div className="ca-bar" data-chat-attachments>
      <div className="ca-head">
        <span className="ca-title">附件</span>
        <span className="ca-count" data-ca-count>
          {items.length}/{limit}
        </span>
        {busy ? <span className="ca-badge busy">正在理解图片…</span> : null}
        {!busy && understood && understood > 0 ? (
          <span className="ca-badge ok" data-ca-understood>
            已理解 {understood} 张
          </span>
        ) : null}
        {!busy && warning ? (
          <span className="ca-badge warn" data-ca-warning>
            {warning}
          </span>
        ) : null}
        <span className="spacer" />
        {actions}
        {onUpload ? (
          <button
            type="button"
            className="ca-link"
            onClick={onUpload}
            disabled={locked || uploadBusy || full}
            title={full ? `已达 ${limit} 项上限` : '上传本地图片'}
            data-ca-upload
          >
            {uploadBusy ? '上传中…' : '+ 上传'}
          </button>
        ) : null}
        {onPick ? (
          <button
            type="button"
            className="ca-link"
            onClick={onPick}
            disabled={locked || picking || full}
            title={full ? `已达 ${limit} 项上限` : '从当前项目的素材中选择'}
            data-ca-pick-project
          >
            {picking ? '选择中…' : '从素材选'}
          </button>
        ) : null}
        {items.length > 0 && onClear ? (
          <button type="button" className="ca-link" onClick={onClear} disabled={locked} data-ca-clear>
            清空
          </button>
        ) : null}
      </div>

      {hint ? <div className="ca-hint">{hint}</div> : null}

      {showEntries ? (
        <div className="ca-strip">
          {items.map((item) => (
            <span
              key={`sel:${item.key}`}
              className="ca-chip on"
              role="button"
              tabIndex={0}
              aria-label={`移除 ${item.label}`}
              data-ca-pick={item.key}
              data-ca-item={item.key}
              data-ca-kind={item.kind}
              title={`移除 ${item.label}`}
              onClick={() => {
                if (!locked) onRemove(item.key)
              }}
              onKeyDown={(e) => {
                if (locked) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onRemove(item.key)
                }
              }}
            >
              <AttachmentThumb item={item} />
              <span className="ca-thumb-label">{item.label}</span>
              {extra ? extra(item) : null}
              <span className="ca-remove" aria-hidden="true" data-ca-remove>
                ×
              </span>
            </span>
          ))}
          {options.map((item) => (
            <button
              key={`opt:${item.key}`}
              type="button"
              className="ca-chip"
              title={full ? `已达 ${limit} 项上限` : `加入 ${item.label}`}
              disabled={locked || full}
              onClick={() => onAdd?.(item)}
              data-ca-pick={item.key}
            >
              <img src={item.url} alt={item.label} />
              <span className="ca-thumb-label">{item.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="ca-empty" data-ca-empty>
          {full ? `已达 ${limit} 项上限` : '还没有可用的附件来源。'}
        </div>
      )}
    </div>
  )
}
