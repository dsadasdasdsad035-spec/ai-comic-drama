import type { ReactNode } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatComposer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ComposerPrimitive.Root data-chat-composer className={cn('shrink-0 border-t border-border px-2.5 py-2', className)}>
      {children}
    </ComposerPrimitive.Root>
  )
}
