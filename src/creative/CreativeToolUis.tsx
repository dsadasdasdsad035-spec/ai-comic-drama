import { useMemo } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { ToolCard, type ToolCardStatus } from '@/chat-ui/tools/ToolCard'
import { Badge } from '@/chat-ui/ui/badge'

const LABELS: Record<string, { title: string; kind: 'read' | 'media' | 'write' | 'paid' }> = {
  read_skill: { title: '技能全文', kind: 'read' },
  read_skill_text: { title: '技能原文', kind: 'read' },
  list_installed_skills: { title: '技能目录', kind: 'read' },
  list_experts: { title: '专家目录', kind: 'read' },
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
}: {
  toolName: string
  running: boolean
  result: unknown
}) {
  const isMcp = toolName.startsWith('mcp.')
  const meta =
    LABELS[toolName] ||
    (isMcp
      ? { title: `MCP ${toolName.replace(/^mcp\./, '')}`, kind: 'read' as const }
      : { title: toolName, kind: 'read' as const })
  const r = asRecord(result)
  const error = typeof r.error === 'string' ? r.error : ''
  const status: ToolCardStatus = running ? 'running' : r.ok === false || error ? 'error' : 'ok'

  const title = running
    ? `${meta.title}…`
    : error
      ? `${meta.title}失败：${error}`
      : toolName === 'read_skill' && r.id
        ? `${meta.title}：${String(r.id)}`
        : toolName === 'list_installed_skills' && typeof r.count === 'number'
          ? `${meta.title}：${r.count} 个`
          : toolName === 'list_experts' && typeof r.count === 'number'
            ? `${meta.title}：${r.count} 个`
            : toolName === 'read_skill_text' && r.id
            ? `${meta.title}：${String(r.id)}`
            : `${meta.title}：完成`

  return (
    <ToolCard
      tool={toolName}
      status={status}
      title={title}
      aside={<Badge variant="secondary">{KIND_LABEL[meta.kind]}</Badge>}
    />
  )
}

const NATIVE_UIS = Object.keys(LABELS).map((toolName) =>
  makeAssistantToolUI({
    toolName,
    render: ({ status, result }) => (
      <CreativeToolCard toolName={toolName} running={status.type === 'running'} result={result} />
    ),
  }),
)

type Props = {
  /** 当前创意聊天已接入的 MCP 工具名（mcp.serverId.toolName） */
  mcpToolNames?: string[]
}

export function CreativeToolUis({ mcpToolNames = [] }: Props) {
  const mcpUis = useMemo(
    () =>
      mcpToolNames.map((toolName) =>
        makeAssistantToolUI({
          toolName,
          render: ({ status, result }) => (
            <CreativeToolCard toolName={toolName} running={status.type === 'running'} result={result} />
          ),
        }),
      ),
    [mcpToolNames],
  )

  return (
    <>
      {NATIVE_UIS.map((Ui, i) => (
        <Ui key={`creative-tool-ui-${i}`} />
      ))}
      {mcpUis.map((Ui, i) => (
        <Ui key={`creative-mcp-ui-${mcpToolNames[i]}-${i}`} />
      ))}
    </>
  )
}
