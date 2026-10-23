import { useState } from 'react'
import { ChevronDown, Code2 } from 'lucide-react'
import { Button } from '@/chat-ui/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/chat-ui/ui/collapsible'
import { cn } from '@/chat-ui/lib/utils'

export function ChatCodeBlock({
  code,
  language = 'text',
  className,
}: {
  code: string
  language?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const lines = code ? code.split('\n').length : 0
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      data-chat-code
      data-open={open ? 'true' : 'false'}
      className={cn('my-1.5 overflow-hidden rounded-md border border-border bg-background', className)}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-chat-code-toggle
          className="flex w-full justify-between rounded-none px-2 text-muted-foreground"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Code2 className="size-3.5 shrink-0" />
            <span className="truncate text-[10px]">{language || 'text'} · {lines} 行</span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[10px]">
            {open ? '收起代码' : '展开代码'}
            <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-64 overflow-auto border-t border-border bg-[#07101a] p-2 text-[10px] leading-relaxed text-[#cfe3f7]">
          <code>{code}</code>
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
