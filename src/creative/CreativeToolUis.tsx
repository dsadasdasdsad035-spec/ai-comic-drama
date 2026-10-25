import { makeAssistantToolUI } from '@assistant-ui/react'
import { ToolCard, type ToolCardStatus } from '@/chat-ui/tools/ToolCard'
import { Badge } from '@/chat-ui/ui/badge'

const LABELS: Record<string, { title: string; kind: 'read' | 'media' | 'write' | 'paid' }> = {
  read_creative_session: { title: '会话概览', kind: 'read' },
  read_creative_source: { title: '源视频信息', kind: 'read' },
  read_video_shots: { title: '镜头切分', kind: 'read' },
  read_frame_detail: { title: '证据帧分析', kind: 'paid' },
  ingest_source: { title: '摄取源视频', kind: 'media' },
  probe_source: { title: '探测媒体信息', kind: 'media' },
  split_scenes: { title: '切分镜头', kind: 'media' },
  extract_frames: { title: '抽取证据帧', kind: 'media' },
  submit_reverse_pack: { title: '提示词包', kind: 'write' },
  generate_image: { title: '生成图片', kind: 'paid' },
  generate_video: { title: '生成视频', kind: 'paid' },
  generate_voice: { title: '生成配音', kind: 'paid' },
}

const KIND_LABEL: Record<string, string> = {
  read: '读取',
  media: '媒体',
  write: '产物',
  paid: '付费',
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function CreativeToolCard({
  toolName,
  running,
  result,
  args,
}: {
  toolName: string
  running: boolean
  result: unknown
  args?: Record<string, unknown>
}) {
  const meta = LABELS[toolName] || { title: toolName, kind: 'read' as const }
  const r = asRecord(result)
  const error = typeof r.error === 'string' ? r.error : ''
  const summary = typeof r.summary === 'string' ? r.summary : ''
  const status: ToolCardStatus = running ? 'running' : r.ok === false || error ? 'error' : 'ok'

  const title = running
    ? `${meta.title}…`
    : error
      ? `${meta.title}失败：${error}`
      : `${meta.title}${summary ? `：${summary}` : '：完成'}`

  // 读取类给范围，媒体类给结果数量，付费类给模型
  const details: string[] = []
  if (toolName === 'read_video_shots') {
    details.push(`共 ${String(r.total ?? 0)} 镜`)
  }
  if (toolName === 'extract_frames') {
    const shots = Array.isArray(r.shots) ? r.shots.length : 0
    details.push(`${shots} 镜已处理`)
  }
  if (toolName === 'submit_reverse_pack') {
    details.push(`${String(r.shots ?? 0)} 镜`)
  }
  if (toolName === 'read_frame_detail') {
    const frames = Array.isArray(r.frames) ? r.frames.length : 0
    details.push(`${frames} 帧`)
    if (r.modelLabel) details.push(`模型 ${String(r.modelLabel)}`)
    const warnings = Array.isArray(r.warnings) ? r.warnings.length : 0
    if (warnings) details.push(`${warnings} 帧失败`)
  }
  if (meta.kind === 'paid' && r.modelLabel && toolName !== 'read_frame_detail') {
    details.push(`模型 ${String(r.modelLabel)}`)
  }
  if (Array.isArray(args?.shotIndexes) && args.shotIndexes.length) {
    details.push(`镜头 ${args.shotIndexes.join(',')}`)
  }
  if (typeof args?.url === 'string' && args.url) {
    details.push(String(args.url).slice(0, 60))
  }

  return (
    <ToolCard
      tool={toolName}
      status={status}
      title={title}
      aside={<Badge variant={meta.kind === 'paid' ? 'warning' : 'secondary'}>{KIND_LABEL[meta.kind]}</Badge>}
    >
      {details.length ? <span className="text-muted-foreground">{details.join(' · ')}</span> : null}
    </ToolCard>
  )
}

const TOOL_NAMES = Object.keys(LABELS)
const UIS = TOOL_NAMES.map((toolName) =>
  makeAssistantToolUI({
    toolName,
    render: ({ status, result, args }) => (
      <CreativeToolCard
        toolName={toolName}
        running={status.type === 'running'}
        result={result}
        args={args as Record<string, unknown> | undefined}
      />
    ),
  }),
)

/** 创意会话的工具卡：读取 / 媒体 / 产物 / 付费四类，付费卡标出实际模型 */
export function CreativeToolUis() {
  return (
    <>
      {UIS.map((Ui, i) => (
        <Ui key={`${TOOL_NAMES[i]}-${i}`} />
      ))}
    </>
  )
}
