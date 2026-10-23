import type { ReactNode } from 'react'
import { MessagePrimitive } from '@assistant-ui/react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatMessage({
  role,
  children,
  className,
}: {
  role: 'user' | 'assistant'
  children: ReactNode
  className?: string
}) {
  return (
    <MessagePrimitive.Root
      data-chat-message={role}
      className={cn(
        'mb-2 max-w-[94%] [overflow-wrap:anywhere] rounded-lg border px-2.5 py-2 text-xs leading-relaxed',
        role === 'user'
          ? 'ml-auto border-primary/30 bg-primary/10 text-foreground'
          : 'border-border bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {children}
    </MessagePrimitive.Root>
  )
}
