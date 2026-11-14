import type { AppSettings, Stage } from '../api'
import { StageModelSelect, type StagePick } from '../ModelSelect'

const MODE_LABEL: Record<string, string> = {
  running: '运行中',
  error: '未就绪',
  ready: '就绪',
}

/** 创意聊天头部：会话标题、状态、模型/专家/技能情境条 */
export function CreativeHeader({
  sessionTitle,
  settings,
  stagePick,
  onPickStage,
  modelKey,
  hostSkillId,
  skillChoices,
  onHostSkillChange,
  hideHostSkill,
  expertId,
  expertChoices,
  onExpertChange,
  onOpenExperts,
  inspectOpen,
  canInspect,
  onToggleInspect,
  skillError,
  running,
  onOpenList,
  onOpenAllSkills,
  onOpenMcp,
  mcpToolCount,
  hostSkillOptions,
  totalSkillsCount,
  catalogEmpty,
  projectName,
  epNo,
  showEpisode = true,
}: {
  sessionTitle: string
  settings: AppSettings | null
  stagePick?: StagePick
  onPickStage?: (stage: Stage, key: string) => void
  modelKey: string
  hostSkillId: string
  skillChoices: Array<{ id: string; label: string }>
  onHostSkillChange: (id: string) => void
  /** 选中专家时隐藏顶栏偏好技能 */
  hideHostSkill?: boolean
  expertId?: string
  expertChoices?: Array<{ id: string; label: string }>
  onExpertChange?: (id: string) => void
  onOpenExperts?: () => void
  inspectOpen: boolean
  canInspect: boolean
  onToggleInspect: () => void
  skillError: string
  running: boolean
  onOpenList: () => void
  onOpenAllSkills?: () => void
  onOpenMcp?: () => void
  mcpToolCount?: number
  hostSkillOptions?: number
  totalSkillsCount?: number
  /** 无已安装 Agent 包时的提示（不阻断聊天） */
  catalogEmpty?: boolean
  projectName?: string
  epNo?: number
  /** 角色/素材等项目级专家为 false */
  showEpisode?: boolean
}) {
  const statusKey = running ? 'running' : skillError ? 'error' : 'ready'
  const expertLabel =
    expertId && expertChoices?.length
      ? expertChoices.find((e) => e.id === expertId)?.label || expertId
      : ''
  const notice =
    skillError && !running
      ? { tone: 'alert' as const, text: skillError }
      : hideHostSkill && !running
        ? {
            tone: 'info' as const,
            text: expertLabel
              ? `专家「${expertLabel}」：对话仅使用该 soul 与白名单工具。`
              : '专家模式：换专家请顶栏下拉或让 Pi 调用 list_experts。',
          }
        : catalogEmpty && !skillError && !running && !hideHostSkill
          ? {
              tone: 'info' as const,
              text: '尚未安装 Agent 包：仍可对话，但 list_installed_skills 为空。可到技能市场安装。',
            }
          : null

  return (
    <header data-creative-header className="creative-header">
      <div className="creative-header-bar">
        <button
          type="button"
          data-creative-action="toggle-list"
          className="creative-list-toggle"
          onClick={onOpenList}
          aria-label="打开会话列表"
        >
          会话
        </button>
        <div className="creative-header-title-block">
          <h1 className="creative-header-title">{sessionTitle || '未命名会话'}</h1>
          <span
            className={`creative-status-dot is-${statusKey}`}
            title={skillError || MODE_LABEL[statusKey]}
            aria-label={MODE_LABEL[statusKey]}
          />
        </div>
        <button
          type="button"
          className={`creative-header-inspect${inspectOpen ? ' is-on' : ''}`}
          onClick={onToggleInspect}
          disabled={!canInspect}
          aria-expanded={inspectOpen}
          aria-controls="workbench-chat-inspector"
          title="查看下一轮会发给模型的内容"
        >
          {inspectOpen ? '收起预览' : '发送预览'}
        </button>
      </div>

      {projectName ? (
        <p className="creative-header-project" data-creative-project>
          <span className="creative-context-crumb">
            {showEpisode ? `${projectName} · 第 ${epNo ?? 1} 集` : projectName}
          </span>
          <span className="creative-context-crumb-sub">
            {showEpisode ? '仅此项目的创意会话' : '项目级 · 角色/素材不绑集号与分镜'}
          </span>
        </p>
      ) : null}

      <div data-chat-context-bar className="creative-context-bar" aria-label="对话上下文">
        <div className="creative-context-fields">
          {onPickStage ? (
            <div className={`creative-context-field${!modelKey ? ' is-missing' : ''}`}>
              <span className="creative-context-field-label">模型</span>
              <StageModelSelect
                stage="creative"
                settings={settings}
                pick={stagePick}
                onChange={onPickStage}
                compact
                className="creative-meta-model wb-field wb-context-model"
              />
            </div>
          ) : (
            <span className={`creative-context-field is-missing`}>
              <span className="creative-context-field-label">模型</span>
              <span className="creative-context-field-value">未绑定</span>
            </span>
          )}

          {onExpertChange ? (
            <label className={`creative-context-field${expertId ? ' is-accent' : ''}`}>
              <span className="creative-context-field-label">专家</span>
              <select
                data-creative-expert
                value={expertId || ''}
                onChange={(e) => onExpertChange(e.target.value)}
                title="选中后仅使用专家 soul 与白名单工具；留空则自动技能目录模式"
                className="creative-context-select"
              >
                <option value="">无（技能目录）</option>
                {(expertChoices || []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {!hideHostSkill ? (
            <label className="creative-context-field">
              <span className="creative-context-field-label">偏好技能</span>
              <select
                data-creative-host-skill
                value={hostSkillId}
                onChange={(e) => onHostSkillChange(e.target.value)}
                title="可选：指定默认 Agent 包；留空时由 Pi 通过 list_installed_skills 发现"
                className="creative-context-select"
              >
                <option value="">自动（技能目录）</option>
                {skillChoices.length > 0
                  ? skillChoices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))
                  : null}
              </select>
            </label>
          ) : null}
        </div>

        <div className="creative-context-actions" data-creative-context>
          {onOpenExperts ? (
            <button
              type="button"
              className="creative-context-link"
              data-creative-action="experts"
              onClick={onOpenExperts}
              title="设置 → 创意专家"
            >
              专家
            </button>
          ) : null}
          {onOpenAllSkills ? (
            <button
              type="button"
              className="creative-context-link"
              data-creative-action="all-skills"
              onClick={onOpenAllSkills}
              title={
                totalSkillsCount
                  ? `已安装创意技能 ${hostSkillOptions ?? skillChoices.length}。打开 SkillHub。`
                  : '设置 → SkillHub 安装 Agent 包'
              }
            >
              技能
            </button>
          ) : null}
          {onOpenMcp ? (
            <button
              type="button"
              className="creative-context-link"
              data-creative-action="mcp"
              onClick={onOpenMcp}
              title={
                mcpToolCount
                  ? `创意聊天已接入 ${mcpToolCount} 个 MCP 工具`
                  : '设置 → MCP 并勾选创意聊天'
              }
            >
              MCP{mcpToolCount ? ` · ${mcpToolCount}` : ''}
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p
          className={notice.tone === 'alert' ? 'creative-header-alert' : 'creative-header-hint'}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}
    </header>
  )
}