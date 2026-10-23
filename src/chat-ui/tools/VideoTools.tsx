import type { DataMessagePartProps } from '@assistant-ui/react'
import type { AgentFrame, AgentReviewItem, AgentVideoPart, AgentVideoReviewPart, AgentVideoStatus } from '@/agent/sceneAgentTypes'
import { Button } from '@/chat-ui/ui/button'
import { ListChecks, Play, RefreshCw, Save, Wrench } from 'lucide-react'
import { ToolCard, type ToolCardStatus } from './ToolCard'
import { useVideoUi } from './videoUiContext'

function cardStatus(status: AgentVideoStatus): ToolCardStatus {
  if (status === 'running') return 'running'
  if (status === 'passed') return 'ok'
  if (status === 'needs_human') return 'warn'
  return 'error'
}

function phaseLabel(video: AgentVideoPart): string {
  if (video.status !== 'running') return ''
  if (video.phase === 'rendering') {
    const pct = typeof video.progress === 'number' ? ` ${Math.round(video.progress * 100)}%` : ''
    return `正在渲染 MP4${pct}`
  }
  if (video.phase === 'saving') return '正在保存 MP4'
  if (video.phase === 'extracting') return '正在从 MP4 抽帧'
  if (video.phase === 'reviewing') return '正在验收 MP4 帧'
  return '正在准备视频验收'
}

function videoTitle(video: AgentVideoPart): string {
  if (video.status === 'running') return phaseLabel(video)
  if (video.status === 'passed') return video.saved ? 'MP4 视频验收通过' : 'MP4 帧验收通过 · 待保存'
  if (video.status === 'rejected') return 'MP4 视频验收未通过'
  if (video.status === 'needs_human') return 'MP4 已生成 · 需人工验收'
  if (video.status === 'cancelled') return 'MP4 视频验收已取消'
  if (video.status === 'timeout') return 'MP4 视频验收超时'
  if (video.errorCode === 'save_failed') return 'MP4 验收通过 · 保存失败'
  return 'MP4 视频验收失败'
}

function staleOf(part: { codeHash: string }, currentCodeHash?: string): boolean {
  return Boolean(currentCodeHash && part.codeHash && currentCodeHash !== part.codeHash)
}

export function VideoPart({ data: video }: DataMessagePartProps<AgentVideoPart>) {
  const { currentCodeHash, onAdopt, onRetry } = useVideoUi()
  const stale = staleOf(video, currentCodeHash)
  const superseded = Boolean(video.superseded)
  const inactive = stale || superseded
  const canAdopt =
    !inactive &&
    (video.status === 'needs_human' ||
      (video.status === 'failed' && video.errorCode === 'save_failed'))
  const canRetry =
    !inactive &&
    (video.status === 'failed' || video.status === 'timeout' || video.status === 'cancelled' || video.status === 'needs_human')
  const pct =
    video.status === 'running' && typeof video.progress === 'number'
      ? Math.max(0, Math.min(100, Math.round(video.progress * 100)))
      : 0
  return (
    <ToolCard
      tool="agent-video"
      status={cardStatus(video.status)}
      title={videoTitle(video)}
      aside={<Play className="size-3.5 text-muted-foreground" />}
      className={inactive ? 'opacity-60' : undefined}
    >
      <div data-chat-video data-status={video.status} data-code-hash={video.codeHash} data-stale={stale ? 'true' : 'false'} className="space-y-1.5">
        {stale && <p className="text-amber-500">旧版本 · 代码已变化，请重新验收</p>}
        {superseded && !stale && <p className="text-amber-500">已被新的视频验收替代</p>}
        {video.status === 'running' && (
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              data-chat-video-progress
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
          <span className="font-mono">{video.codeHash.slice(0, 10)}</span>
          <span>{video.duration.toFixed(1)}s</span>
          <span>{video.aspect}</span>
          <span>帧来自 MP4</span>
          {video.saved && <span className="text-emerald-500">已保存</span>}
        </div>
        {video.videoUrl && (
          <div className="space-y-1">
            <video
              data-chat-video-player
              src={video.videoUrl}
              controls
              playsInline
              preload="metadata"
              className="max-h-[180px] w-full rounded border border-border bg-black"
            />
            <a href={video.videoUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline">
              打开 MP4
            </a>
          </div>
        )}
        {video.frames.length > 0 && (
          <div data-chat-video-frames className="flex gap-1.5 overflow-x-auto pb-0.5">
            {video.frames.map((frame: AgentFrame) => (
              <a
                key={`${frame.t}-${frame.url.slice(0, 12)}`}
                href={frame.url}
                target="_blank"
                rel="noreferrer"
                title={`MP4 ${frame.t.toFixed(2)}s`}
                className="relative h-14 w-[92px] shrink-0 overflow-hidden rounded border border-border bg-muted"
              >
                <img src={frame.url} alt={`MP4 ${frame.t.toFixed(2)}s`} className="h-full w-full object-cover" />
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-px text-[9px] text-white">
                  {frame.t.toFixed(1)}s
                </span>
              </a>
            ))}
          </div>
        )}
        {video.error && video.status !== 'passed' && <p className="text-destructive">{video.error}</p>}
        {(canAdopt || canRetry) && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {canAdopt && onAdopt && (
              <Button variant="outline" size="sm" onClick={() => onAdopt(video)}>
                <Save className="size-3.5" />
                {video.errorCode === 'save_failed' ? '重试保存' : '人工采用并保存'}
              </Button>
            )}
            {canRetry && onRetry && (
              <Button variant="ghost" size="sm" onClick={() => onRetry(video)}>
                <RefreshCw className="size-3.5" />
                重试视频验收
              </Button>
            )}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

export function VideoReviewPart({ data: review }: DataMessagePartProps<AgentVideoReviewPart>) {
  const { currentCodeHash, onContinueRepair } = useVideoUi()
  const stale = staleOf(review, currentCodeHash)
  const superseded = Boolean(review.superseded)
  const inactive = stale || superseded
  const counts = {
    ok: review.items.filter((x: AgentReviewItem) => x.ok).length,
    total: review.items.length,
  }
  return (
    <ToolCard
      tool="agent-video-review"
      status={review.passed ? 'ok' : review.needsHumanReview ? 'warn' : 'error'}
      title={
        review.passed
          ? `MP4 帧验收通过 · ${counts.ok}/${counts.total}`
          : review.needsHumanReview
            ? 'MP4 帧验收 · 需人工'
            : `MP4 帧验收未通过 · ${counts.ok}/${counts.total}`
      }
      aside={<ListChecks className="size-3.5 text-muted-foreground" />}
      className={inactive ? 'opacity-60' : undefined}
    >
      <div data-chat-video-review data-status={review.passed ? 'passed' : review.needsHumanReview ? 'needs_human' : 'rejected'} data-code-hash={review.codeHash} data-stale={stale ? 'true' : 'false'} className="space-y-1">
        {stale && <p className="text-amber-500">旧版本 · 代码已变化，此验收不再对应当前视频</p>}
        {superseded && !stale && <p className="text-amber-500">已被新的视频验收替代</p>}
        <p className="text-muted-foreground">
          帧来源：最终 MP4{review.modelKey ? ` · 视觉模型 ${review.modelKey}` : ''}
          {review.saved ? ' · 已保存' : ''}
        </p>
        {review.videoUrl && (
          <a href={review.videoUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline">
            查看这次验收的 MP4
          </a>
        )}
        {review.items.length > 0 && (
          <ul className="space-y-0.5">
            {review.items.map((item: AgentReviewItem) => (
              <li key={item.key} className={item.ok ? 'text-emerald-500' : 'text-destructive'}>
                {item.ok ? '✓' : '✗'} {item.label}
                {item.reason ? ` · ${item.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
        {review.summary && <p className="text-muted-foreground">{review.summary}</p>}
        {review.error && !review.passed && <p className="text-destructive">{review.error}</p>}
        {!inactive && !review.passed && !review.needsHumanReview && onContinueRepair && (
          <Button variant="outline" size="sm" onClick={() => onContinueRepair(review)}>
            <Wrench className="size-3.5" />
            继续修复
          </Button>
        )}
      </div>
    </ToolCard>
  )
}
