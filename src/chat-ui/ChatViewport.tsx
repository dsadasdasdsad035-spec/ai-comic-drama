import type { ReactNode } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatViewport({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ThreadPrimitive.Viewport
      data-chat-viewport
      className={cn('min-h-0 flex-1 overflow-y-auto px-2.5 py-2', className)}
    >
      {children}
    </ThreadPrimitive.Viewport>
  )
}
