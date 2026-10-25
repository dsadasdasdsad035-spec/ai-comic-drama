import type { ReactNode } from 'react'
import { cn } from '@/chat-ui/lib/utils'
import type { CreativeMode } from './sessionStore'

const MODES: Array<{ id: CreativeMode; label: string; hint: string }> = [
  { id: 'plan', label: '策划', hint: '把想法拆成方向与镜头草案' },
  { id: 'reverse', label: '反推', hint: '从参考视频逐镜反推提示词' },
  { id: 'remake', label: '复刻', hint: '用提示词包生成复刻片段' },
]

/** 会话头部：模式、模型、技能与运行状态一眼可见 */
export function CreativeHeader({
  mode,
  onModeChange,
  sessionTitle,
  modelKey,
  modelLabel,
  skillId,
  skillError,
  running,
  sources,
  artifacts,
  onOpenList,
  onRefresh,
  capabilityTray,
}: {
  mode: CreativeMode
  onModeChange: (mode: CreativeMode) => void
  sessionTitle: string
  modelKey: string
  modelLabel: string
  skillId: string
  skillError: string
  running: boolean
  sources: number
  artifacts: number
  onOpenList: () => void
  onRefresh: () => void
  /** 能力托盘；由宿主注入，避免头部依赖模型表 */
  capabilityTray?: ReactNode
}) {
  return (
    <header data-creative-header className="creative-header">
      <div className="creative-header-row">
        <button
          type="button"
          data-creative-action="toggle-list"
          className="creative-list-toggle"
          onClick={onOpenList}
          aria-label="打开会话列表"
        >
          ☰
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold">{sessionTitle || '未命名会话'}</span>
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                running ? 'animate-pulse bg-primary' : skillError ? 'bg-destructive' : 'bg-[var(--ok)]',
              )}
              title={running ? '运行中' : skillError ? '技能不可用' : '就绪'}
            />
            {running ? <span className="text-[10px] text-primary">正在处理…</span> : null}
          </div>
          <div data-creative-context className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
            <span className={cn(!modelKey && 'text-destructive')} title="文本模型决定对话主循环">
              模型 {modelLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span title="宿主技能随模式切换">技能 {skillId}</span>
            <span aria-hidden="true">·</span>
            <span>
              源 {sources} · 产物 {artifacts}
            </span>
            {skillError ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-destructive">{skillError}</span>
              </>
            ) : null}
            <button
              type="button"
              className="ml-1 rounded border border-border px-1 text-[9px] hover:bg-muted"
              onClick={onRefresh}
              title="重新读取会话的源与产物"
            >
              刷新
            </button>
            {capabilityTray}
          </div>
        </div>
        <div data-creative-modes role="tablist" aria-label="创意模式" className="creative-modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              data-mode={m.id}
              title={m.hint}
              className={cn('creative-mode', mode === m.id && 'on')}
              onClick={() => onModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}
