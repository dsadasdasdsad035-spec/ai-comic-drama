import type { AgentContextPart } from '@/agent/sceneAgentTypes'

function PreBlock({ label, text }: { label: string; text: string }) {
  if (!text.trim()) return null
  return (
    <details className="mt-1 rounded border border-border/60 bg-muted/30 px-1.5 py-1">
      <summary className="cursor-pointer select-none text-foreground/80">
        {label}（{text.length} 字）
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[9px] text-foreground/90">
        {text}
      </pre>
    </details>
  )
}

/** 每轮发给大模型的上下文审计卡（可展开全文）。 */
export function ChatContextPart({ data }: { data: AgentContextPart }) {
  const total = data.keys.length
  const hasPayload = Boolean(data.systemPrompt || data.userPrompt || data.contextPayload)
  return (
    <details
      data-chat-context-turn
      open={hasPayload}
      className="mb-1 rounded-md border border-dashed border-border bg-background/40 px-2 py-1 text-[10px] text-muted-foreground"
    >
      <summary className="cursor-pointer select-none text-foreground/85">
        本轮发给模型
        {hasPayload
          ? ` · 系统 ${data.systemPrompt?.length ?? 0} 字 · 用户 ${data.userPrompt?.length ?? 0} 字 · 镜头上下文 ${data.contextPayload?.length ?? 0} 字`
          : ` · 附件 ${total} 项（${data.counts.image} 图 / ${data.counts.video} 视频 / ${data.counts.text} 文本）`}
      </summary>
      <div className="mt-1 space-y-1">
        <div>{data.metadata.title}</div>
        {total > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.keys.map((key) => (
              <code key={key} className="rounded bg-muted px-1 py-0.5 text-[9px]">
                {key}
              </code>
            ))}
          </div>
        )}
        {total === 0 && !hasPayload && <div>本轮没有附件，只发送镜头元数据。</div>}
        <PreBlock label="系统提示 system" text={data.systemPrompt || ''} />
        <PreBlock label="用户消息 user" text={data.userPrompt || ''} />
        <PreBlock label="镜头与附件正文（工具上下文）" text={data.contextPayload || ''} />
        <p className="text-[9px] text-muted-foreground">
          后续轮次还会带上工具调用与结果；完整多轮 messages 可在发送前用「查看将发送」对照附件与系统提示。
        </p>
      </div>
    </details>
  )
}
