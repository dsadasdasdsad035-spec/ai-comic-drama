import type { AgentFrame, AgentReview } from '@/agent/sceneAgentTypes'
import { Button } from '@/chat-ui/ui/button'
import { Code2, Flag, ImageIcon, ListChecks, Play, ScanEye } from 'lucide-react'
import { ToolCard, type ToolCardStatus } from './ToolCard'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function statusOf(running: boolean, result: unknown): ToolCardStatus {
  if (running) return 'running'
  const r = record(result)
  return r.error ? 'error' : 'ok'
}

export function ContextTool({ running }: { running: boolean }) {
  return (
    <ToolCard
      tool="get_shot_context"
      status={running ? 'running' : 'ok'}
      title={running ? '正在读取镜头上下文…' : '已读取镜头上下文'}
      aside={<ScanEye className="size-3.5 text-muted-foreground" />}
    />
  )
}

export function CodeTool({
  running,
  result,
  onOpenCode,
}: {
  running: boolean
  result: unknown
  onOpenCode: () => void
}) {
  const r = record(result)
  const error = typeof r.error === 'string' ? r.error : ''
  return (
    <ToolCard
      tool="set_scene_code"
      status={statusOf(running, result)}
      title={running ? '正在提交代码…' : error ? '代码未接受' : '代码草稿'}
      aside={<Code2 className="size-3.5 text-muted-foreground" />}
    >
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {Number(r.lineCount || 0)} 行 · <span className="font-mono">{String(r.codeHash || '—').slice(0, 10)}</span>
          </span>
          {!running && <Button variant="outline" size="sm" onClick={onOpenCode}>查看代码</Button>}
        </div>
      )}
    </ToolCard>
  )
}

export function SandboxTool({ running, result }: { running: boolean; result: unknown }) {
  const r = record(result)
  const error = typeof r.error === 'string' ? r.error : ''
  const status = statusOf(running, result)
  return (
    <ToolCard
      tool="run_sandbox"
      status={status}
      title={running ? '沙箱运行中…' : error ? `沙箱未通过：${error}` : '沙箱通过'}
      aside={<Play className="size-3.5 text-muted-foreground" />}
    />
  )
}

export function FramesTool({ running, result }: { running: boolean; result: unknown }) {
  const r = record(result)
  const frames = Array.isArray(r.frames) ? (r.frames as AgentFrame[]) : []
  const error = typeof r.error === 'string' ? r.error : ''
  return (
    <ToolCard
      tool="capture_frames"
      status={statusOf(running, result)}
      title={running ? '正在抓取关键帧…' : error ? `抓帧失败：${error}` : `关键帧 · ${frames.length} 张`}
      aside={<ImageIcon className="size-3.5 text-muted-foreground" />}
    >
      {frames.length > 0 && (
        <div data-chat-frames className="flex gap-1.5 overflow-x-auto pb-0.5">
          {frames.map((frame) => (
            <a
              key={`${frame.t}-${frame.url.slice(0, 12)}`}
              href={frame.url}
              target="_blank"
              rel="noreferrer"
              title={`${frame.t.toFixed(2)}s`}
              className="relative h-14 w-[92px] shrink-0 overflow-hidden rounded border border-border bg-muted"
            >
              <img src={frame.url} alt={`${frame.t.toFixed(2)}s`} className="h-full w-full object-cover" />
              <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-px text-[9px] text-white">
                {frame.t.toFixed(1)}s
              </span>
            </a>
          ))}
        </div>
      )}
    </ToolCard>
  )
}

export function ReviewTool({ running, result }: { running: boolean; result: unknown }) {
  const review = result as (AgentReview & { error?: string }) | undefined
  const error = review?.error || ''
  const status: ToolCardStatus = running ? 'running' : error ? 'error' : review?.needsHumanReview ? 'warn' : review?.passed ? 'ok' : 'error'
  return (
    <ToolCard
      tool="review_frames"
      status={status}
      title={running ? '正在做视觉验收…' : error ? '验收失败' : review?.needsHumanReview ? '需人工验收' : review?.passed ? '验收通过' : '验收未通过'}
      aside={<ListChecks className="size-3.5 text-muted-foreground" />}
    >
      <div data-chat-review>
        {error && <p className="text-destructive">{error}</p>}
        {(review?.items?.length ?? 0) > 0 && (
          <ul className="space-y-0.5">
            {review?.items.map((item) => (
              <li key={item.key} className={item.ok ? 'text-emerald-500' : 'text-destructive'}>
                {item.ok ? '✓' : '✗'} {item.label}
                {item.reason ? ` · ${item.reason}` : ''}
              </li>
            ))}
          </ul>
        )}
        {review?.summary && <p className="mt-1 text-muted-foreground">{review.summary}</p>}
      </div>
    </ToolCard>
  )
}

export function FinishTool({ running, result }: { running: boolean; result: unknown }) {
  const r = record(result)
  return (
    <ToolCard
      tool="finish"
      status={statusOf(running, result)}
      title={running ? '正在收尾…' : '场景完成'}
      aside={<Flag className="size-3.5 text-muted-foreground" />}
    >
      {typeof r.summary === 'string' && <p>{r.summary}</p>}
    </ToolCard>
  )
}
