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
      className={cn('my-1 flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground', className)}
    >
      <span className="mt-px shrink-0 font-mono">第 {turn} 轮</span>
      <span className={cn(phase === 'error' && 'text-destructive')}>{children || '模型调用完成'}</span>
    </div>
  )
}
