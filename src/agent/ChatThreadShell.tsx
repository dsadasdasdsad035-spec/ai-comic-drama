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
import { buttonVariants } from '@/chat-ui/ui/button'

/**
 * 聊天壳：只负责 provider、作用域和工具 UI 宿主。
 * 3D 与阶段工作台各自提供消息转换、上下文托盘和工具卡。
 */
export function ChatThreadShell({
  runtime,
  running,
  toolUis,
  children,
}: {
  runtime: AssistantRuntime
  running: boolean
  toolUis?: ReactNode
  children: ReactNode
}) {
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {toolUis}
      <ChatRoot data-running={running ? 'true' : 'false'}>{children}</ChatRoot>
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

/** 消息视口 + 输入框；消息组件由调用方决定。 */
export function ChatThreadBody({
  UserMessage,
  AssistantMessage,
  empty,
  placeholder,
  inputLabel,
  suggestions,
  disabled,
  hint,
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
  hint?: string
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
        {suggestions && suggestions.length > 0 && (
          <ComposerSuggestions items={suggestions} inputRef={inputRef} />
        )}
        <ComposerPrimitive.Input
          ref={inputRef}
          data-chat-input
          submitMode="enter"
          disabled={disabled}
          className="flex max-h-[180px] min-h-[44px] w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={placeholder || '输入消息…'}
          aria-label={inputLabel || '聊天输入'}
        />
        <div data-chat-actions className="flex items-center gap-2 pt-1.5">
          {hint && <span className="mr-auto text-[11px] text-muted-foreground">{hint}</span>}
          <ComposerPrimitive.Cancel
            className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} ${hint ? '' : 'ml-auto'}`}
          >
            {cancelLabel}
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send className={buttonVariants({ size: 'sm' })}>发送</ComposerPrimitive.Send>
        </div>
      </ChatComposer>
    </ThreadPrimitive.Root>
  )
}
