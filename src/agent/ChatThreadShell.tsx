import { useRef, type ReactNode, type ComponentType, type RefObject } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  type AssistantRuntime,
} from '@assistant-ui/react'
import { ChatRoot } from '@/chat-ui/ChatRoot'
import { ChatViewport } from '@/chat-ui/ChatViewport'
import { ChatComposer } from '@/chat-ui/ChatComposer'
import { ChatEmpty } from '@/chat-ui/ChatEmpty'
import { ChatAttachmentBar, type AttachmentOption } from './ChatAttachmentBar'
import type { ChatAttachment } from './chatAttachments'
import { buttonVariants } from '@/chat-ui/ui/button'

/**
 * 聊天壳：只负责 provider、作用域和工具 UI 宿主。
 * 3D 与阶段工作台各自提供消息转换、上下文托盘和工具卡。
 */
export function ChatThreadShell({
  runtime,
  running,
  toolUis,
  scope,
  children,
}: {
  runtime: AssistantRuntime
  running: boolean
  toolUis?: ReactNode
  /** 聊天作用域标识：3D 与工作台聊天可能同屏，测试与样式需要区分根节点 */
  scope?: string
  children: ReactNode
}) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {toolUis}
      <ChatRoot
        data-running={running ? 'true' : 'false'}
        {...(scope ? { 'data-chat-scope': scope } : {})}
      >
        {children}
      </ChatRoot>
    </AssistantRuntimeProvider>
  )
}

/** 输入框上方的示例：点击只预填，不发送。必须位于 Composer 上下文内。 */
function ComposerSuggestions({
  items,
  inputRef,
}: {
  items: string[]
  inputRef: RefObject<HTMLTextAreaElement>
}) {
  const composer = unstable_useComposerInput()
  return (
    <div data-chat-suggestions className="flex flex-wrap gap-1.5 pb-1.5">
      {items.map((text) => (
        <button
          key={text}
          type="button"
          data-chat-suggestion
          className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground hover:bg-muted"
          onClick={() => {
            inputRef.current?.focus()
            composer.setText(text)
            requestAnimationFrame(() => composer.setText(text))
          }}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * 输入区的附件槽位。宿主只声明「有哪些附件、能怎么加、归属谁」，
 * 附件的理解与写入由宿主自己的 sink 完成，本组件不感知。
 */
export type ComposerAttachmentSlot = {
  items: ChatAttachment[]
  /** 单次上限；所有类型共享同一计数 */
  limit: number
  /** 快捷可选项（已选与可选合并成一条带展示） */
  available?: AttachmentOption[]
  busy?: boolean
  understood?: number
  warning?: string
  hint?: string
  /** 是否禁用移除与新增（例如正在运行） */
  locked?: boolean
  onAdd?: (item: AttachmentOption) => void
  onRemove: (key: string) => void
  onClear?: () => void
  onUpload?: () => void
  uploadBusy?: boolean
  onPick?: () => void
  picking?: boolean
  /** 每项的附加控件，例如 3D 的 brief 开关 */
  extra?: (item: ChatAttachment) => ReactNode
  /** 条带右上的附加控件，例如 3D 的「查看将发送」 */
  actions?: ReactNode
  /**
   * 只带附件发送。assistant-ui 的发送能力在输入框为空时被硬性禁用
   * （库的 canSend 判定），所以这条路径必须由宿主自己发起，
   * 不能依赖 Composer 的发送按钮。不提供时不显示该按钮。
   */
  onSendAttachmentsOnly?: () => void
}

/** 消息视口 + 输入框；消息组件由调用方决定。 */
export function ChatThreadBody({
  UserMessage,
  AssistantMessage,
  empty,
  placeholder,
  inputLabel,
  suggestions,
  disabled,
  /** 额外禁用条件：只拦发送，不拦输入（例如参考图还在理解） */
  sendDisabled,
  /** 发送被额外条件拦住时显示的说明 */
  sendBlockedNote,
  hint,
  attachments,
  composerTop,
  onComposerDraftChange,
  cancelLabel = '取消',
  emptyAlign = 'top',
}: {
  UserMessage: ComponentType
  AssistantMessage: ComponentType
  empty?: ReactNode
  placeholder?: string
  inputLabel?: string
  suggestions?: string[]
  disabled?: boolean
  sendDisabled?: boolean
  sendBlockedNote?: string
  hint?: string
  attachments?: ComposerAttachmentSlot
  /**
   * 输入区内、文本框上方的附加条（例如创意会话的「粘链接 / 上传视频」）。
   * 与 attachments 同属输入区，但不表示「逐轮附件」——它编辑的是宿主自己的数据。
   */
  composerTop?: ReactNode
  /** 实时同步输入框草稿（未发送文字） */
  onComposerDraftChange?: (text: string) => void
  cancelLabel?: string
  emptyAlign?: 'top' | 'bottom'
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  return (
    <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
      <ChatViewport>
        <ThreadPrimitive.Empty>
          {emptyAlign === 'bottom' ? (
            <div className="flex min-h-full flex-col justify-end">{empty ?? <ChatEmpty />}</div>
          ) : (
            empty ?? <ChatEmpty />
          )}
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
      </ChatViewport>
      <ChatComposer>
        {attachments ? (
          <ChatAttachmentBar {...attachments} locked={attachments.locked ?? disabled} />
        ) : null}
        {suggestions && suggestions.length > 0 && (
          <ComposerSuggestions items={suggestions} inputRef={inputRef} />
        )}
        {composerTop}
        <ComposerPrimitive.Input
          ref={inputRef}
          data-chat-input
          submitMode="enter"
          disabled={disabled}
          className="flex max-h-[180px] min-h-[44px] w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={placeholder || '输入消息…'}
          aria-label={inputLabel || '聊天输入'}
          onInput={(e) => onComposerDraftChange?.(e.currentTarget.value)}
          onChange={(e) => onComposerDraftChange?.(e.currentTarget.value)}
        />
        <div data-chat-actions className="flex items-center gap-2 pt-1.5">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {sendBlockedNote || hint || ''}
          </span>
          {attachments?.onSendAttachmentsOnly && attachments.items.length > 0 ? (
            <button
              type="button"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              onClick={() => attachments.onSendAttachmentsOnly?.()}
              disabled={disabled || sendDisabled}
              title="只把当前附件发给模型，不输入文字"
              data-chat-send-attachments
            >
              发送附件
            </button>
          ) : null}
          <ComposerPrimitive.Cancel className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {cancelLabel}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send
            className={buttonVariants({ size: 'sm' })}
            {...(sendDisabled ? { disabled: true } : {})}
            {...(sendDisabled && sendBlockedNote ? { title: sendBlockedNote } : {})}
          >
            发送
          </ComposerPrimitive.Send>
        </div>
      </ChatComposer>
    </ThreadPrimitive.Root>
  )
}
