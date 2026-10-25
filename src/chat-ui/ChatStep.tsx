import type { ReactNode } from 'react'
import { cn } from '@/chat-ui/lib/utils'

export function ChatStep({
  turn,
  phase = 'end',
  children,
  className,
}: {
  turn: number
  phase?: 'start' | 'end' | 'error'
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      data-chat-step={turn}
      data-phase={phase}
      className={cn(
        'my-2 flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground first:mt-0 first:border-0 first:pt-0',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          phase === 'start' && 'animate-pulse bg-primary motion-reduce:animate-none',
          phase === 'end' && 'bg-[var(--ok)]',
          phase === 'error' && 'bg-destructive',
        )}
      />
      <span className="shrink-0 font-medium">第 {turn} 轮</span>
      <span className={cn('min-w-0', phase === 'error' && 'text-destructive')}>
        {children || '模型调用完成'}
      </span>
    </div>
  )
}
