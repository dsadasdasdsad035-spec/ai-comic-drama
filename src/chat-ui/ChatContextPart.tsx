import type { AgentContextPart } from '@/agent/sceneAgentTypes'

/** 每轮模型调用的上下文审计卡：只显示标识、数量和元数据。 */
export function ChatContextPart({ data }: { data: AgentContextPart }) {
  const total = data.keys.length
  return (
    <details
      data-chat-context-turn
      className="mb-1 rounded-md border border-dashed border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground"
    >
      <summary className="cursor-pointer select-none">
        本轮上下文 · {total} 项（{data.counts.image} 图 / {data.counts.video} 视频 /{' '}
        {data.counts.text} 文本）
      </summary>
      <div className="mt-1 space-y-1">
        <div>
          镜头 {data.metadata.no || '未编号'} · {data.metadata.duration.toFixed(1)}s ·{' '}
          {data.metadata.aspect}
        </div>
        {total > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.keys.map((key) => (
              <code key={key} className="rounded bg-muted px-1 py-0.5 text-[9px]">
                {key}
              </code>
            ))}
          </div>
        )}
        {total === 0 && <div>本轮没有附件，只发送镜头元数据。</div>}
      </div>
    </details>
  )
}
