import { useState } from 'react'
import { FileCode2 } from 'lucide-react'
import type { AgentDraftPart, AgentDraftStatus } from '@/agent/sceneAgentTypes'
import { Button } from '@/chat-ui/ui/button'
import { sceneDraftClient } from '@/sceneDraft'
import { ToolCard, type ToolCardStatus } from './ToolCard'

const STATUS_LABEL: Record<AgentDraftStatus, string> = {
  staged: '暂存',
  committed: '已提交，待试运行',
  'trial-passed': '已生效',
  failed: '失败',
  discarded: '已丢弃',
}

const STATUS_CLASS: Record<AgentDraftStatus, string> = {
  staged: 'text-muted-foreground',
  committed: 'text-amber-500',
  'trial-passed': 'text-emerald-500',
  failed: 'text-destructive',
  discarded: 'text-muted-foreground',
}

function hintOf(part: AgentDraftPart): string {
  switch (part.status) {
    case 'staged':
      return '尚未提交到当前会话。'
    case 'committed':
      return '已暂存到会话；试运行通过前不会覆盖工作台草稿。'
    case 'trial-passed':
      return '渲染试运行已通过，已进入工作台草稿。'
    case 'failed':
      return part.error || '提交或试运行失败，旧代码未改变。'
    case 'discarded':
      return '草稿已删除；旧代码未改变。'
  }
}

function formatChars(chars: number): string {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars)
}

/** 草稿卡：只显示行数/状态；完整内容按需只读预览，不提供保存/运行入口。 */
export function DraftPart({ data }: { data: AgentDraftPart }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const previewable = data.status !== 'discarded'

  const preview = async () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (text != null || loading) return
    setLoading(true)
    setError('')
    try {
      setText(await sceneDraftClient.text(data.draftId))
    } catch (e) {
      setError((e as Error)?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-chat-draft className="my-1.5 rounded-md border border-border bg-background/60 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <FileCode2 className="size-3.5 text-muted-foreground" />
        <span className="font-medium">
          场景草稿 · {data.lines} 行 / {formatChars(data.chars)} 字符
        </span>
        <span className={STATUS_CLASS[data.status]}>{STATUS_LABEL[data.status]}</span>
      </div>
      <div className="mt-1 flex items-start justify-between gap-2">
        <span className={data.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
          {hintOf(data)}
        </span>
        {previewable && (
          <Button variant="outline" size="sm" onClick={() => void preview()} disabled={loading}>
            {loading ? '读取中…' : open ? '收起草稿' : '查看草稿'}
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-1.5 rounded border border-border bg-muted/40">
          <div className="border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
            只读预览 · {data.status === 'trial-passed' ? '已试运行' : '未试运行'}
            {data.codeHash ? ` · hash ${data.codeHash.slice(0, 10)}` : ''}
          </div>
          {error ? (
            <p className="p-2 text-destructive">{error}</p>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] leading-relaxed">
              {text ?? ''}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

const TITLES: Record<string, { running: string; done: string }> = {
  begin_scene_draft: { running: '正在创建场景草稿…', done: '场景草稿已创建' },
  append_scene_draft: { running: '正在追加草稿片段…', done: '草稿片段已追加' },
  read_scene_draft: { running: '正在读取草稿片段…', done: '草稿片段已读取' },
  patch_scene_draft: { running: '正在替换草稿片段…', done: '草稿片段已替换' },
  commit_scene_draft: { running: '正在提交场景草稿…', done: '场景草稿已提交' },
  discard_scene_draft: { running: '正在删除场景草稿…', done: '场景草稿已删除' },
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 草稿工具卡：不显示 chunk/code 参数，只显示结果摘要。 */
export function DraftTool({
  tool,
  running,
  result,
}: {
  tool: string
  running: boolean
  result: unknown
}) {
  const r = record(result)
  const error = typeof r.error === 'string' ? r.error : ''
  const status: ToolCardStatus = running ? 'running' : error ? 'error' : 'ok'
  const title = TITLES[tool]
  const lines = Number(r.lines)
  const totalLines = Number(r.totalLines)
  const codeHash = typeof r.codeHash === 'string' ? r.codeHash : ''
  const summary = typeof r.summary === 'string' ? r.summary : ''
  return (
    <ToolCard
      tool={tool}
      status={status}
      title={running ? title?.running || '处理草稿…' : error ? `草稿操作失败：${error}` : title?.done || '草稿操作完成'}
      aside={<FileCode2 className="size-3.5 text-muted-foreground" />}
    >
      {!error && (
        <div className="space-y-0.5 text-muted-foreground">
          {summary && <p>{summary}</p>}
          {Number.isFinite(lines) && lines > 0 && <p>当前 {lines} 行</p>}
          {Number.isFinite(totalLines) && totalLines > 0 && <p>草稿共 {totalLines} 行</p>}
          {codeHash && <p className="font-mono">hash {codeHash.slice(0, 10)}</p>}
          {tool === 'commit_scene_draft' && !running && (
            <p className="text-[10px]">提交只进入会话；run_render 通过后才更新工作台草稿。</p>
          )}
        </div>
      )}
    </ToolCard>
  )
}
