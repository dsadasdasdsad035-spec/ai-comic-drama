import type { Shot3DContextItem } from '@/shot3dContextCatalog'
import { cn } from '@/chat-ui/lib/utils'

export function ChatChips({
  items,
  onRemove,
}: {
  items: Shot3DContextItem[]
  onRemove: (key: string) => void
}) {
  return (
    <div data-chat-chips className="flex max-h-[86px] flex-wrap items-center gap-1 overflow-y-auto px-2.5 pb-1.5">
      {items.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">还没有参考：在左侧勾选后会出现在这里</span>
      ) : (
        <>
          {items.slice(0, 8).map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                'inline-flex max-w-[170px] items-center gap-1 truncate rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground hover:bg-muted',
                item.missing && 'border-destructive/40 text-destructive',
              )}
              onClick={() => onRemove(item.key)}
            >
              <span className="truncate">{item.label}</span>
              <span aria-hidden="true" className="text-muted-foreground">×</span>
            </button>
          ))}
          {items.length > 8 && <span className="text-[10px] text-muted-foreground">+{items.length - 8}</span>}
          <span className="text-[10px] text-muted-foreground">工具轨迹 · 不展示隐藏推理</span>
        </>
      )}
    </div>
  )
}
