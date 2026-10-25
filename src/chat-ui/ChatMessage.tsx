import type { ReactNode } from 'react'
import { MessagePrimitive } from '@assistant-ui/react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatMessage({
  role,
  variant = 'default',
  children,
  className,
}: {
  role: 'user' | 'assistant'
  /** workbench：助手正文去卡片、只留左侧轮次轨；default 保持 3D 聊天的原样。 */
  variant?: 'default' | 'workbench'
  children: ReactNode
  className?: string
}) {
  const style =
    variant === 'workbench'
      ? role === 'user'
        ? 'ml-auto rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-[13px] text-foreground'
        : 'border-l border-border pl-3 pr-1 py-0.5 text-[13px] text-foreground'
      : role === 'user'
        ? 'rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-xs text-foreground'
        : 'rounded-lg border border-border bg-secondary px-2.5 py-2 text-xs text-secondary-foreground'
  return (
    <MessagePrimitive.Root
      data-chat-message={role}
      className={cn('mb-3 max-w-[94%] [overflow-wrap:anywhere] leading-relaxed', style, className)}
    >
      {children}
    </MessagePrimitive.Root>
  )
}
