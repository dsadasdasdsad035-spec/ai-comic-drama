import { manifestCounts, manifestText, type ContextManifest } from '@/contextManifest'
import type { PreparedCodeContext } from '@/sceneCodePrepare'

export function ChatContextInspector({
  manifest,
  prepared,
  systemPrompt,
  onClose,
}: {
  manifest: ContextManifest
  prepared?: PreparedCodeContext | null
  systemPrompt: string
  onClose: () => void
}) {
  const counts = manifestCounts(manifest)
  const briefs: Record<string, string> = {}
  for (const item of prepared?.mediaBrief.items ?? []) {
    if (item.key && item.description) briefs[item.key] = item.description
  }
  const text = manifestText(manifest, briefs)
  const briefFor = (key: string) => briefs[key]

  return (
    <section
      data-chat-context-inspector
      className="max-h-[46vh] shrink-0 overflow-y-auto border-b border-border bg-background px-2.5 py-2 text-[10px] leading-relaxed text-foreground"
    >
      <header className="mb-1.5 flex items-center justify-between">
        <b>查看将发送</b>
        <button
          type="button"
          className="rounded border border-border px-1.5 py-0.5 text-muted-foreground hover:bg-muted"
          onClick={onClose}
        >
          关闭
        </button>
      </header>

      <div className="text-muted-foreground">
        镜头 {manifest.shot.no || '未编号'} · {manifest.shot.duration.toFixed(1)}s ·{' '}
        {manifest.shot.aspect}
      </div>
      <div className="mb-1.5 text-muted-foreground">
        视觉模型收到 {counts.image + counts.video} 个媒体附件；代码模型收到{' '}
        {manifest.attachments.length} 个附件（{counts.text} 文本 / {counts.image} 图 /{' '}
        {counts.video} 视频）
      </div>

      <details className="mb-1.5 rounded border border-border px-1.5 py-1">
        <summary className="cursor-pointer select-none text-muted-foreground">
          系统提示（{systemPrompt.length} 字）
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[9px] text-muted-foreground">
          {systemPrompt}
        </pre>
      </details>

      <div className="space-y-1">
        {manifest.attachments.length === 0 && (
          <div className="text-muted-foreground">没有附件；只发送镜号、时长和画幅。</div>
        )}
        {manifest.attachments.map((item) => (
          <div key={item.key} className="rounded border border-border px-1.5 py-1">
            <div className="flex flex-wrap items-center gap-1">
              <code className="rounded bg-muted px-1 py-0.5 text-[9px]">{item.key}</code>
              <span>{item.label}</span>
              <span className="text-muted-foreground">
                {item.kind === 'image'
                  ? `图片 · ${item.source}`
                  : item.kind === 'video'
                    ? `视频${item.duration ? ` · ${item.duration.toFixed(2)}s` : ''}`
                    : '文本'}
              </span>
            </div>
            {item.kind === 'text' && (
              <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[9px]">
                {item.text}
              </pre>
            )}
            {item.kind === 'video' && item.frameTimes.length > 0 && (
              <div className="mt-0.5 text-muted-foreground">
                关键帧 {item.frameTimes.map((t) => `${t.toFixed(2)}s`).join(' / ')}
              </div>
            )}
            {(item.kind === 'image' || item.kind === 'video') && (
              <div className="mt-0.5 text-muted-foreground">
                {!item.includeBrief
                  ? 'brief 已排除'
                  : briefFor(item.key)
                    ? `brief：${briefFor(item.key)}`
                    : 'brief 首次发送时生成'}
              </div>
            )}
          </div>
        ))}
      </div>

      {prepared?.missing.length ? (
        <div className="mt-1.5 text-destructive">
          缺失：{prepared.missing.map((m) => `${m.label}（${m.reason}）`).join('；')}
        </div>
      ) : null}
      {prepared?.warnings.length ? (
        <div className="mt-1 text-muted-foreground">提示：{prepared.warnings.join('；')}</div>
      ) : null}
      <div className="mt-1.5 text-muted-foreground">
        预计代码模型输入约 {text.length} 字符（不含系统提示与工具结果）。
      </div>
    </section>
  )
}
