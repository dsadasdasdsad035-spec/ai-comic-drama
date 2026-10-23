import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader } from '@/chat-ui/ui/card'
import { Badge } from '@/chat-ui/ui/badge'
import { cn } from '@/chat-ui/lib/utils'

export type ToolCardStatus = 'running' | 'ok' | 'warn' | 'error'

const statusLabel: Record<ToolCardStatus, string> = {
  running: '运行中',
  ok: '完成',
  warn: '需注意',
  error: '失败',
}

const statusVariant: Record<ToolCardStatus, 'secondary' | 'success' | 'warning' | 'destructive'> = {
  running: 'secondary',
  ok: 'success',
  warn: 'warning',
  error: 'destructive',
}

export function ToolCard({
  tool,
  status,
  title,
  aside,
  children,
  className,
}: {
  tool: string
  status: ToolCardStatus
  title: string
  aside?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <Card
      data-chat-tool={tool}
      data-status={status}
      className={cn('my-1 overflow-hidden bg-card/70 shadow-sm', className)}
    >
      <CardHeader className="justify-between gap-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
          <span className="truncate text-[11px] font-medium text-card-foreground">{title}</span>
        </div>
        {aside}
      </CardHeader>
      {children && <CardContent className="pt-0 text-[10px] leading-relaxed">{children}</CardContent>}
    </Card>
  )
}
