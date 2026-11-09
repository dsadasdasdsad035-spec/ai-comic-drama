import type { ReactNode } from 'react'
import { cn } from '@/chat-ui/lib/utils'
import type { AppSettings, Stage } from '../api'
import { StageModelSelect, type StagePick } from '../ModelSelect'
import type { Skill } from '../skills/types'
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
  settings,
  stagePick,
  onPickStage,
  modelKey,
  hostSkillId,
  skillChoices,
  onHostSkillChange,
  readonlySkills,
  availableReadonly,
  onLoadReadonly,
  onRemoveReadonly,
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
  settings: AppSettings | null
  stagePick?: StagePick
  onPickStage?: (stage: Stage, key: string) => void
  modelKey: string
  hostSkillId: string
  skillChoices: Array<{ id: string; label: string }>
  onHostSkillChange: (id: string) => void
  readonlySkills: Skill[]
  availableReadonly: Skill[]
  onLoadReadonly: (id: string) => void
  onRemoveReadonly: (id: string) => void
  skillError: string
  running: boolean
  sources: number
  artifacts: number
  onOpenList: () => void
  onRefresh: () => void
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
            {running ? <span className="shrink-0 text-[10px] text-primary">正在处理…</span> : null}
          </div>
          <div data-creative-context className="creative-header-meta">
            {onPickStage ? (
              <StageModelSelect
                stage="creative"
                settings={settings}
                pick={stagePick}
                onChange={onPickStage}
                compact
                className={cn('creative-meta-model wb-field', !modelKey && 'text-destructive')}
              />
            ) : (
              <span className={cn('creative-meta-item', !modelKey && 'text-destructive')}>未绑定文本模型</span>
            )}
            <span aria-hidden="true" className="creative-meta-sep">
              ·
            </span>
            <label className="creative-meta-item flex items-center gap-1">
              <span className="sr-only">宿主技能</span>
              <select
                value={hostSkillId}
                onChange={(e) => onHostSkillChange(e.target.value)}
                title="宿主技能；正文用 read_skill 读取"
                className="max-w-[140px] truncate rounded border border-border bg-transparent text-[11px]"
              >
                {skillChoices.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <span aria-hidden="true" className="creative-meta-sep">
              ·
            </span>
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value
                if (id) onLoadReadonly(id)
              }}
              title="挂只读参考技能"
              className="max-w-[120px] rounded border border-border bg-transparent text-[10px] text-muted-foreground"
            >
              <option value="">+ 只读技能</option>
              {availableReadonly
                .filter((s) => !readonlySkills.some((r) => r.id === s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
            </select>
            {readonlySkills.map((s) => (
              <span key={s.id} className="skill-chip readonly text-[10px]">
                参考：{s.id}
                <button type="button" onClick={() => onRemoveReadonly(s.id)} aria-label={`卸载 ${s.id}`}>
                  ×
                </button>
              </span>
            ))}
            <span aria-hidden="true" className="creative-meta-sep">
              ·
            </span>
            <span className="creative-meta-item">
              源 {sources} · 产物 {artifacts}
            </span>
            {skillError ? (
              <>
                <span aria-hidden="true" className="creative-meta-sep">
                  ·
                </span>
                <span className="creative-meta-item text-destructive" title={skillError}>
                  {skillError}
                </span>
              </>
            ) : null}
            <button
              type="button"
              className="creative-meta-item creative-meta-btn"
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
              className={cn(mode === m.id && 'on')}
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
