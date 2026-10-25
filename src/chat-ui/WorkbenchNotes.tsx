import { useWorkbenchChatContext } from '../agent/workbenchChatContext'

/** 失败可恢复：说明草稿未改变，并给一次显式重试。 */
export function ChatErrorNote({ message }: { message: string }) {
  const ctx = useWorkbenchChatContext()
  return (
    <div
      data-chat-error
      className="my-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[11px] leading-relaxed text-destructive"
    >
      <div className="font-medium">本轮没有完成</div>
      <div className="mt-0.5 whitespace-pre-wrap break-words">{message}</div>
      <div className="mt-1.5 flex items-center gap-2">
        {ctx?.onRetry && (
          <button
            type="button"
            className="rounded border border-destructive/40 px-1.5 py-0.5 text-[10px] hover:bg-destructive/10 disabled:opacity-50"
            onClick={ctx.onRetry}
            disabled={ctx.running}
          >
            重试
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">草稿保持上一版</span>
      </div>
    </div>
  )
}

/** 取消后的状态说明；明确本轮没有写入草稿。 */
export function ChatStoppedNote() {
  return (
    <div data-chat-stopped className="my-1.5 text-[11px] text-muted-foreground">
      已停止；本轮未写入草稿。
    </div>
  )
}
