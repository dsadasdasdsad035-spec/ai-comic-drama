import { Sparkles, X } from 'lucide-react'
import { cn } from '@/chat-ui/lib/utils'
import type { Skill } from '../skills/types'
import {
  builtinAvailability,
  builtinLabel,
  type BuiltinAction,
  type WorkbenchProfile,
} from '../agent/workbenchChat'

export type WorkbenchContextStats = {
  entries: { key: string; label: string; chars: number; mode: 'inline' | 'tool' }[]
  total: number
  referenceCount: number
}

function fmtChars(chars: number) {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars)
}

/**
 * 工作台聊天头部：助手身份、编辑范围、当前模型和本轮上下文摘要。
 * 技能 id/版本/来源收进检查器；这里只保留一行可读信息。
 */
export function WorkbenchHeader({
  title,
  scope,
  hostSkillId,
  modelLabel,
  modelReady,
  running,
  busyLabel,
  status,
  stats,
  readonly,
  available,
  onLoadReadonly,
  onRemoveReadonly,
  actions,
  onRunAction,
  actionRunning,
  onCancelAction,
  actionsDisabled,
  inspectOpen,
  canInspect,
  onToggleInspect,
  onClose,
}: {
  title: string
  scope: string
  hostSkillId: string
  modelLabel: string
  modelReady: boolean
  running: boolean
  busyLabel?: string
  status: 'ready' | 'running' | 'error'
  stats: WorkbenchContextStats | null
  readonly: Skill[]
  available: Skill[]
  onLoadReadonly: (id: string) => void
  onRemoveReadonly: (id: string) => void
  actions?: BuiltinAction[]
  onRunAction?: (action: BuiltinAction) => void
  actionRunning?: { key: string; label: string } | null
  onCancelAction?: () => void
  actionsDisabled?: boolean
  inspectOpen: boolean
  canInspect: boolean
  onToggleInspect: () => void
  onClose?: () => void
}) {
  const summary = stats
    ? `${stats.entries.length} 项 · ${fmtChars(stats.total)} 字${
        stats.referenceCount ? ` · ${stats.referenceCount} 项按范围读取` : ''
      }`
    : '正在准备上下文…'

  return (
    <header data-chat-header className="shrink-0 border-b border-border bg-secondary/45">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
          <span
            className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={scope}
          >
            {scope}
          </span>
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              status === 'running' && 'animate-pulse bg-primary motion-reduce:animate-none',
              status === 'error' && 'bg-destructive',
              status === 'ready' && 'bg-[var(--ok)]',
            )}
            title={running ? '助手运行中' : status === 'error' ? '上一轮失败' : '助手就绪'}
          />
          {running && <span className="shrink-0 text-[10px] text-primary">{busyLabel || '正在改…'}</span>}
          <span className="sr-only" aria-live="polite">
            {running ? '助手正在改' : status === 'error' ? '上一轮失败' : '助手就绪'}
          </span>
        </div>
        <span className="skill-chip host" hidden>
          {hostSkillId}
        </span>
        <button
          type="button"
          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onToggleInspect}
          disabled={!canInspect}
          aria-expanded={inspectOpen}
          aria-controls="workbench-chat-inspector"
          title="查看本轮会发给模型的内容"
        >
          {inspectOpen ? '收起将发送' : '查看将发送'}
        </button>
        {onClose && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label="关闭助手"
            title="关闭助手"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div
        data-chat-context-bar
        className="flex max-h-[72px] flex-wrap items-center gap-x-1.5 gap-y-1 overflow-y-auto border-t border-border/60 px-3 py-1 text-[11px] leading-relaxed text-muted-foreground"
      >
        <span className={cn('shrink-0', !modelReady && 'text-destructive')} title={modelLabel}>
          模型 {modelLabel}
        </span>
        <span aria-hidden="true" className="text-border">·</span>
        <span className="min-w-0 truncate" title={summary}>
          本轮带入 {summary}
        </span>
        {readonly.map((skill) => (
          <span
            className="skill-chip readonly"
            key={skill.id}
            title={`${skill.manifest.description}（只读，不绑定写工具）`}
          >
            参考：{skill.id}
            <button
              type="button"
              onClick={() => onRemoveReadonly(skill.id)}
              aria-label={`卸载只读技能 ${skill.id}`}
            >
              ×
            </button>
          </span>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions && actions.length > 0 ? (
            actionRunning ? (
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-muted"
                onClick={onCancelAction}
                title="取消正在运行的内置动作"
              >
                停止 {actionRunning.label}
              </button>
            ) : (
              <select
                value=""
                onChange={(e) => {
                  const action = actions.find((x) => x.key === e.target.value)
                  if (action) onRunAction?.(action)
                }}
                disabled={actionsDisabled}
                aria-label="运行内置动作"
                title="运行工作台内置动作（从零生成 / 拆解）"
                className="max-w-[150px] rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">+ 内置动作</option>
                {actions.map((action) => {
                  const availability = builtinAvailability(action)
                  return (
                    <option
                      key={action.key}
                      value={action.key}
                      disabled={availability.disabled}
                      title={availability.reason || action.hint}
                    >
                      {builtinLabel(action)}
                      {action.scope === 'script' ? ' · 全剧' : ''}
                      {availability.disabled ? '（不可用）' : ''}
                    </option>
                  )
                })}
              </select>
            )
          ) : null}
          {/* 没有可加载的只读技能时（例如发布台）不渲染空下拉 */}
          {available.filter((s) => !readonly.some((r) => r.id === s.id)).length > 0 ? (
            <select
              value=""
              onChange={(e) => onLoadReadonly(e.target.value)}
              disabled={readonly.length >= 1}
              aria-label="加载只读技能"
              title={readonly.length >= 1 ? '最多一个只读技能' : '加载只读技能'}
              className="max-w-[150px] rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground disabled:opacity-50"
            >
              <option value="">+ 参考能力</option>
              {available
                .filter((s) => !readonly.some((r) => r.id === s.id))
                .map((s) => (
                  <option key={s.id} value={s.id} title={s.manifest.description}>
                    {s.id}
                  </option>
                ))}
            </select>
          ) : null}
        </div>
      </div>
    </header>
  )
}
