import type { CreativeArtifact, CreativeSessionSummary } from './sessionStore'
import { GeneratedCard, ReversePackCard, ShotsCard, SourceCard } from './CreativeCards'

/** 对话框态：在工具请求上挂了 resolve，UI 关闭时回传结果 */
export type CostPrompt = {
  capability: NonNullable<import('./tools').CostRequest['capability']>
  modelLabel: string
  calls: number
  note?: string
  alwaysConfirm?: boolean
  resolve: (ok: boolean, remember?: boolean) => void
}

/**
 * 会话内产物区：源视频卡、镜头切分卡、提示词包卡。
 * 放在消息视口上方（不是消息里），因为产物属于会话状态而不是某一轮对话。
 */
export type GeneratedItem = { id: string; kind: 'image' | 'video' | 'audio'; url: string; modelLabel?: string; note?: string }

export function CreativeCards({
  session,
  generated = [],
  busy,
  busyAction,
  onSplit,
  onFrames,
  onCopy,
  onExport,
  onPromote,
}: {
  session: CreativeSessionSummary | null
  generated?: GeneratedItem[]
  busy: boolean
  busyAction: string
  onSplit: (sourceId: string) => void
  onFrames: (sourceId: string) => void
  onCopy: (text: string) => void
  onExport: (artifact: CreativeArtifact) => void
  onPromote: (artifact: CreativeArtifact) => void
}) {

  if (!session) return null
  const source = session.sources[0]
  const shots = source ? (session.shots || {})[source.id] || [] : []
  const artifacts = session.artifacts || []
  if (!source && !artifacts.length && !generated.length) return null

  return (
    <div data-creative-cards className="creative-cards">
      {source ? (
        <SourceCard
          source={source}
          busy={busy}
          onSplit={() => onSplit(source.id)}
          onFrames={() => onFrames(source.id)}
          onPreview={() => window.open(source.file, '_blank', 'noopener')}
        />
      ) : null}
      {source && shots.length ? <ShotsCard shots={shots} /> : null}
      {generated.map((g) => (
        <GeneratedCard key={g.id} kind={g.kind} url={g.url} modelLabel={g.modelLabel} note={g.note} />
      ))}
      {artifacts.map((a) => (
        <ReversePackCard
          key={a.id}
          artifact={a}
          busy={busyAction === 'promote'}
          onCopy={onCopy}
          onExport={() => onExport(a)}
          onPromote={() => onPromote(a)}
        />
      ))}
    </div>
  )
}
