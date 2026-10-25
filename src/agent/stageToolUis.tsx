import { useState } from 'react'
import { makeAssistantToolUI } from '@assistant-ui/react'
import { ToolCard, type ToolCardStatus } from '@/chat-ui/tools/ToolCard'
import { useWorkbenchChatContext } from './workbenchChatContext'
import type { WorkbenchSaveMode } from './workbenchChat'

const LABELS: Record<string, string> = {
  read_source: '原著',
  read_episodes: '分集',
  read_script: '剧本',
  read_characters: '角色表',
  read_episode: '本集',
  read_shots: '镜头表',
  read_designs: '场景/道具',
  submit_script: '剧本草稿',
  submit_characters: '角色草稿',
  submit_designs: '素材草稿',
  submit_shots: '镜头草稿',
  submit_prompts: '提示词草稿',
  builtin_action: '内置动作',
}

const BUILTIN_COUNT_LABELS: Record<string, string> = {
  episodes: '集',
  shots: '镜',
  total: '总数',
  added: '新增',
  updated: '更新',
  filled: '补全',
  skipped: '跳过',
  kept: '保留',
  unresolved: '占位符',
  failed: '失败',
  sceneFallback: '场次回退',
  groups: '批',
}

const BUILTIN_SAVE_LABEL: Record<WorkbenchSaveMode, string> = {
  explicit: '显式保存（未落库）',
  auto: '约 1 秒后自动落库',
  immediate: '已保存到项目',
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function StageToolCard({
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
  const ctx = useWorkbenchChatContext()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const label = LABELS[toolName] || toolName
  const r = record(result)
  const error = typeof r.error === 'string' ? r.error : ''
  const isBuiltin = toolName === 'builtin_action'
  const isSubmit = toolName.startsWith('submit_')
  const counts = record(r.counts)
  const total = Number(r.total)
  const saveMode = ctx?.saveMode
  const savedNow = saved || (saveMode === 'explicit' && ctx?.dirty === false)
  const canSave = Boolean(
    isSubmit && !running && !error && saveMode === 'explicit' && ctx?.onSave && !savedNow,
  )

  if (isBuiltin) {
    const builtinLabel = String(args?.label || r.label || label)
    const scope = String(args?.scope || r.scope || 'episode')
    const cancelled = Boolean(r.cancelled)
    const builtinSaveMode = (r.saveMode as WorkbenchSaveMode | undefined) ?? saveMode
    const summary = running ? '正在运行…' : cancelled ? '已取消' : String(r.summary || (r.ok === false ? '失败' : '完成'))
    const status: ToolCardStatus = running
      ? 'running'
      : cancelled
        ? 'warn'
        : r.ok === false || error
          ? 'error'
          : 'ok'
    const title = running
      ? `正在运行${builtinLabel}…`
      : cancelled
        ? `${builtinLabel}：已取消`
        : error
          ? `${builtinLabel}失败：${error}`
          : `${builtinLabel}${scope === 'script' ? ' · 全剧' : ' · 当前集'}：${summary}`
    const showSave = !cancelled && r.ok !== false && Boolean(builtinSaveMode)
    const countItems = Object.entries(counts)
      .filter(([, v]) => Number(v) > 0)
      .slice(0, 5)
    return (
      <ToolCard tool={toolName} status={status} title={title}>
        {!running && (
          <div
            data-chat-builtin-receipt
            data-save-mode={builtinSaveMode}
            className="flex flex-wrap items-center gap-1.5"
          >
            {showSave && builtinSaveMode ? (
              <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                {BUILTIN_SAVE_LABEL[builtinSaveMode]}
              </span>
            ) : null}
            {countItems.map(([k, v]) => (
              <span key={k} className="text-muted-foreground">
                {BUILTIN_COUNT_LABELS[k] || k} {String(v)}
              </span>
            ))}
            {r.modelLabel ? (
              <span className="text-muted-foreground">模型 {String(r.modelLabel)}</span>
            ) : null}
            {Number(r.elapsedMs) > 0 ? (
              <span className="text-muted-foreground">
                {(Math.max(0.1, Number(r.elapsedMs)) / 1000).toFixed(1)}s
              </span>
            ) : null}
          </div>
        )}
      </ToolCard>
    )
  }

  const title = running
    ? isSubmit
      ? `正在提交${label}…`
      : `正在读取${label}…`
    : error
      ? `${label}失败：${error}`
      : isSubmit
        ? `${label}：${savedNow ? '已保存' : String(r.summary || '已写入草稿')}`
        : `${label}：已读取`

  const handleSave = async () => {
    if (!ctx?.onSave || saving) return
    setSaving(true)
    try {
      await ctx.onSave()
      setSaved(true)
    } catch {
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  if (!isSubmit) {
    return (
      <div
        data-chat-tool={toolName}
        data-status={running ? 'running' : error ? 'error' : 'ok'}
        className="my-0.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className={`mt-1 size-1.5 shrink-0 rounded-full ${
            running
              ? 'animate-pulse bg-primary motion-reduce:animate-none'
              : error
                ? 'bg-destructive'
                : 'bg-[var(--ok)]'
          }`}
        />
        <span className={error ? 'min-w-0 break-words text-destructive' : 'min-w-0 break-words'}>
          {label}：{running ? '正在读取…' : error ? error : `已读取${Number.isFinite(total) ? ` ${total} 项` : ''}`}
        </span>
      </div>
    )
  }

  return (
    <ToolCard
      tool={toolName}
      status={running ? 'running' : error ? 'error' : 'ok'}
      title={title}
    >
      {!running && !error && isSubmit && (
        <div data-chat-receipt data-save-mode={saveMode} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">
            {Number(counts.added) > 0 && `新增 ${Number(counts.added)} `}
            {Number(counts.updated) > 0 && `更新 ${Number(counts.updated)} `}
            {Number(counts.kept) > 0 && `保留 ${Number(counts.kept)} `}
            {!Number(counts.added) && !Number(counts.updated) && '草稿已更新'}
          </span>
          {saveMode === 'explicit' && (
            <span className="rounded bg-[var(--warn-dim)] px-1 text-[10px] text-[var(--warn)]">
              {savedNow ? '已保存' : '草稿未保存'}
            </span>
          )}
          {saveMode === 'auto' && (
            <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
              写入后自动保存（约 1 秒）
            </span>
          )}
          {saveMode === 'immediate' && (
            <span className="rounded bg-[var(--ok-dim)] px-1 text-[10px] text-[var(--ok)]">
              已保存到项目
            </span>
          )}
          {canSave && (
            <button
              type="button"
              className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted disabled:opacity-50"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存草稿'}
            </button>
          )}
          {saveMode === 'explicit' && !canSave && !savedNow && (
            <span className="text-[10px] text-muted-foreground">在左侧点保存</span>
          )}
        </div>
      )}
      {!running && !error && !isSubmit && Number.isFinite(total) && (
        <span className="text-muted-foreground">共 {total} 项</span>
      )}
    </ToolCard>
  )
}

const TOOL_NAMES = Object.keys(LABELS)
const UIS = TOOL_NAMES.map((toolName) =>
  makeAssistantToolUI({
    toolName,
    render: ({ status, result, args }) => (
      <StageToolCard
        toolName={toolName}
        running={status.type === 'running'}
        result={result}
        args={args as Record<string, unknown> | undefined}
      />
    ),
  }),
)

/** 阶段工作台的通用工具卡；3D 仍使用自己的专用卡。 */
export function StageToolUis() {
  return (
    <>
      {UIS.map((Ui, i) => (
        <Ui key={`${TOOL_NAMES[i]}-${i}`} />
      ))}
    </>
  )
}
