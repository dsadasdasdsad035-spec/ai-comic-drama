import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/chat-ui/ui/card'
import { Badge } from '@/chat-ui/ui/badge'
import { cn } from '@/chat-ui/lib/utils'
import type { CreativeArtifact, CreativeShot, CreativeSource } from './sessionStore'

function fmtSeconds(n: number | null | undefined): string {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '—'
  return `${v.toFixed(1)}s`
}

/** 源视频卡：封面、技术信息、平台与来源；动作由外部注入 */
export function SourceCard({
  source,
  onSplit,
  onFrames,
  onPreview,
  busy,
}: {
  source: CreativeSource
  onSplit?: () => void
  onFrames?: () => void
  onPreview?: () => void
  busy?: boolean
}) {
  const meta = [source.platform || '本地', fmtSeconds(source.duration), source.width && source.height ? `${source.width}×${source.height}` : '', source.hasAudio ? '有音轨' : '无音轨']
    .filter(Boolean)
    .join(' · ')
  return (
    <Card data-creative-card="source" data-source-id={source.id} className="my-2 overflow-hidden">
      <CardHeader className="justify-between gap-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant="secondary">源视频</Badge>
          <span className="truncate text-[12px] font-medium">{source.title || source.file.split('/').pop() || source.id}</span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span>
      </CardHeader>
      <CardContent className="flex gap-2 pt-0">
        {source.cover ? (
          <button
            type="button"
            className="size-[68px] shrink-0 overflow-hidden rounded border border-border"
            onClick={onPreview}
            title="查看源视频"
          >
            <img src={source.cover} alt="" className="size-full object-cover" />
          </button>
        ) : (
          <div className="grid size-[68px] shrink-0 place-items-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
            无封面
          </div>
        )}
        <div className="min-w-0 flex-1">
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[10px] text-muted-foreground hover:text-foreground"
              title={source.url}
            >
              {source.url}
            </a>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              data-creative-action="split"
              className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-50"
              onClick={onSplit}
              disabled={busy}
            >
              切分镜头
            </button>
            <button
              type="button"
              data-creative-action="frames"
              className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-50"
              onClick={onFrames}
              disabled={busy}
            >
              抽证据帧
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** 镜头卡：时间范围、状态、证据帧缩略图 */
export function ShotsCard({
  shots,
  onPick,
}: {
  shots: CreativeShot[]
  onPick?: (index: number) => void
}) {
  if (!shots.length) return null
  return (
    <Card data-creative-card="shots" className="my-2 overflow-hidden">
      <CardHeader className="justify-between gap-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">镜头切分</Badge>
          <span className="text-[12px] font-medium">{shots.length} 镜</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {shots.map((s) => (
          <button
            key={s.index}
            type="button"
            data-shot-index={s.index}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted"
            onClick={() => onPick?.(s.index)}
          >
            <span className="w-9 shrink-0 font-mono text-[10px] text-muted-foreground">
              #{String(s.index).padStart(2, '0')}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {s.start.toFixed(2)}–{s.end.toFixed(2)}s
            </span>
            <span className="flex min-w-0 flex-1 gap-1 overflow-hidden">
              {s.frames.slice(0, 3).map((f) => (
                <img key={f} src={f} alt="" className="h-6 w-10 rounded object-cover" />
              ))}
            </span>
            <span
              className={cn(
                'shrink-0 rounded px-1 text-[9px]',
                s.status === 'analyzed'
                  ? 'bg-[var(--ok)]/15 text-[var(--ok)]'
                  : s.status === 'stale'
                    ? 'bg-[var(--warn)]/15 text-[var(--warn)]'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {s.status === 'analyzed' ? '已分析' : s.status === 'stale' ? '已过期' : s.frames.length ? '有帧' : '待处理'}
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  )
}

type ReverseShot = {
  index?: number
  start: number
  end: number
  size?: string
  camera?: string
  keyframe_prompt?: string
  video_prompt?: string
  evidence_frames?: string[]
  confidence?: number
}

/** 提示词包卡：逐镜折叠 + 复制/导出/晋升 */
export function ReversePackCard({
  artifact,
  onCopy,
  onExport,
  onPromote,
  onOpenMessage,
  busy,
}: {
  artifact: CreativeArtifact
  onCopy?: (text: string) => void
  onExport?: () => void
  onPromote?: () => void
  onOpenMessage?: () => void
  busy?: boolean
}) {
  const payload = (artifact.payload || {}) as { shots?: ReverseShot[]; global_style?: string; negative_prompt?: string }
  const shots = Array.isArray(payload.shots) ? payload.shots : []
  const [open, setOpen] = useState<number | null>(null)
  const asText = () =>
    shots
      .map((s, i) => {
        const head = `镜头 ${i + 1}　${Number(s.start).toFixed(2)}s–${Number(s.end).toFixed(2)}s${s.size ? `　${s.size}` : ''}`
        return `${head}\n首帧提示词：${s.keyframe_prompt || ''}\n运动提示词：${s.video_prompt || ''}`
      })
      .join('\n\n')
  return (
    <Card data-creative-card="reverse-pack" data-artifact-id={artifact.id} className="my-2 overflow-hidden">
      <CardHeader className="justify-between gap-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Badge variant="success">提示词包</Badge>
          <span className="truncate text-[12px] font-medium">{artifact.title || '反推结果'}</span>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {shots.length} 镜{artifact.modelLabel ? ` · ${artifact.modelLabel}` : ''}
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        {payload.global_style ? (
          <p className="mb-1 line-clamp-2 text-[10px] text-muted-foreground">风格：{payload.global_style}</p>
        ) : null}
        <div className="max-h-[220px] space-y-1 overflow-y-auto">
          {shots.map((s, i) => (
            <div key={i} data-pack-shot={i + 1} className="rounded border border-border/60">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-1.5 py-1 text-left hover:bg-muted"
                onClick={() => setOpen(open === i ? null : i)}
              >
                <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {Number(s.start).toFixed(2)}–{Number(s.end).toFixed(2)}s
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{s.keyframe_prompt}</span>
                {s.confidence != null ? (
                  <span className="shrink-0 text-[9px] text-muted-foreground">{Math.round(Number(s.confidence) * 100)}%</span>
                ) : null}
              </button>
              {open === i ? (
                <div className="space-y-1 border-t border-border/60 px-1.5 py-1 text-[10px] leading-relaxed">
                  <p>
                    <b>首帧</b>：{s.keyframe_prompt}
                  </p>
                  <p>
                    <b>运动</b>：{s.video_prompt}
                  </p>
                  <div className="flex gap-1">
                    {(s.evidence_frames || []).slice(0, 3).map((f) => (
                      <img key={f} src={f} alt="" className="h-10 w-14 rounded object-cover" />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button
            type="button"
            data-creative-action="copy-pack"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => onCopy?.(asText())}
          >
            复制提示词
          </button>
          <button
            type="button"
            data-creative-action="export-pack"
            className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={onExport}
          >
            导出 JSON
          </button>
          <button
            type="button"
            data-creative-action="promote-pack"
            className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] hover:bg-primary/20 disabled:opacity-50"
            onClick={onPromote}
            disabled={busy}
          >
            晋升项目
          </button>
          {onOpenMessage ? (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted"
              onClick={onOpenMessage}
            >
              在对话中查看
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** 生成结果卡：图/视频/音频统一入口 */
export function GeneratedCard({
  kind,
  url,
  modelLabel,
  note,
}: {
  kind: 'image' | 'video' | 'audio'
  url: string
  modelLabel?: string
  note?: string
}) {
  return (
    <Card data-creative-card={`generated-${kind}`} className="my-2 overflow-hidden">
      <CardHeader className="justify-between gap-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary">{kind === 'image' ? '生成图片' : kind === 'video' ? '生成视频' : '生成配音'}</Badge>
          {modelLabel ? <span className="text-[10px] text-muted-foreground">{modelLabel}</span> : null}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {kind === 'image' ? <img src={url} alt="" className="max-h-[220px] rounded" /> : null}
        {kind === 'video' ? <video src={url} controls className="max-h-[240px] w-full rounded" /> : null}
        {kind === 'audio' ? <audio src={url} controls className="w-full" /> : null}
        {note ? <p className="mt-1 text-[10px] text-muted-foreground">{note}</p> : null}
      </CardContent>
    </Card>
  )
}
