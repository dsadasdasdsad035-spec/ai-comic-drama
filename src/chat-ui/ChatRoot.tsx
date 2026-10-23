import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatRoot({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-chat-root className={cn('chat-ui flex min-h-0 flex-1 flex-col bg-background text-foreground', className)} {...props}>
      {children}
    </div>
  )
}
