import type { ContextManifest } from '@/contextManifest'
import { cn } from '@/chat-ui/lib/utils'

export function ChatContextTray({
  manifest,
  onRemove,
  onToggleBrief,
  onClear,
  onInspect,
  inspecting,
}: {
  manifest: ContextManifest
  onRemove: (key: string) => void
  onToggleBrief?: (key: string) => void
  onClear?: () => void
  onInspect: () => void
  inspecting: boolean
}) {
  const count = manifest.attachments.length
  return (
    <div
      data-chat-context-tray
      className="max-h-[120px] shrink-0 overflow-y-auto border-b border-border px-2.5 py-1.5"
    >
      {count === 0 ? (
        <span className="text-[10px] text-muted-foreground">
          还没有附件：在左侧浏览后点「加入上下文」
        </span>
      ) : (
        <>
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>本次上下文 {count} 项</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  'rounded border border-border px-1.5 py-0.5 hover:bg-muted',
                  inspecting && 'bg-muted text-foreground',
                )}
                onClick={onInspect}
              >
                {inspecting ? '收起' : '查看将发送'}
              </button>
              {onClear && (
                <button
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                  onClick={onClear}
                >
                  清空
                </button>
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {manifest.attachments.map((item) => {
              const isMedia = item.kind === 'image' || item.kind === 'video'
              const briefOn = isMedia ? item.includeBrief : false
              return (
                <span
                  key={item.key}
                  className={cn(
                    'inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground',
                    isMedia && !briefOn && 'border-dashed',
                  )}
                  title={item.key}
                >
                  <span className="shrink-0 text-muted-foreground">
                    {item.kind === 'image' ? '图' : item.kind === 'video' ? '视频' : '文本'}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {isMedia && onToggleBrief && (
                    <button
                      type="button"
                      className={cn(
                        'shrink-0 rounded px-1 text-[9px]',
                        briefOn ? 'text-foreground' : 'text-muted-foreground line-through',
                      )}
                      title={briefOn ? '排除这份媒体 brief' : '恢复这份媒体 brief'}
                      onClick={() => onToggleBrief(item.key)}
                    >
                      brief
                    </button>
                  )}
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={`移除 ${item.label}`}
                    onClick={() => onRemove(item.key)}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
