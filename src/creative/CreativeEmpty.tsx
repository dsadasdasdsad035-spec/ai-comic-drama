type Props = {
  loading: boolean
  expertMode?: boolean
  expertName?: string
  onOpenAllSkills?: () => void
  onOpenMcp?: () => void
  onOpenExperts?: () => void
}

/** 空态：聚焦对话起点，弱化配置说明书感 */
export function CreativeEmpty({
  loading,
  expertMode,
  expertName,
  onOpenAllSkills,
  onOpenMcp,
  onOpenExperts,
}: Props) {
  return (
    <div data-creative-empty className="creative-empty">
      <div className="creative-empty-hero">
        <div className="creative-empty-glow" aria-hidden />
        <p className="creative-empty-eyebrow">创意工作室</p>
        <h3>{loading ? '正在准备会话…' : expertMode && expertName ? `以「${expertName}」开始` : '从这里开聊'}</h3>
        <p className="creative-empty-lead">
          {loading
            ? '正在加载会话与技能目录。'
            : expertMode
              ? '本轮使用专家 soul 与白名单工具；需要换工作方式时，可让 Pi 调用 list_experts。'
              : '直接说想法即可。Pi 会先 list_installed_skills，再按需 read_skill_text 读 SKILL。'}
        </p>

        {!loading ? (
          <>
            <div className="creative-empty-modes">
              <article className={`creative-empty-mode${expertMode ? '' : ' is-primary'}`}>
                <h4>技能目录</h4>
                <p>不选专家时，Pi 用 list_installed_skills 帮你发现包；顶栏「偏好技能」可指定默认 id。</p>
              </article>
              <article className={`creative-empty-mode${expertMode ? ' is-primary' : ''}`}>
                <h4>专家模式</h4>
                <p>顶栏选专家后，system 仅 expert soul，工具与技能走白名单。</p>
              </article>
            </div>

            {(onOpenAllSkills || onOpenMcp || onOpenExperts) && (
              <div className="creative-empty-actions">
                {onOpenExperts ? (
                  <button type="button" className="btn-mini" onClick={onOpenExperts}>
                    管理专家
                  </button>
                ) : null}
                {onOpenAllSkills ? (
                  <button type="button" className="btn-mini primary" onClick={onOpenAllSkills}>
                    技能市场
                  </button>
                ) : null}
                {onOpenMcp ? (
                  <button type="button" className="btn-mini ghost" onClick={onOpenMcp}>
                    MCP
                  </button>
                ) : null}
              </div>
            )}
            <p className="creative-empty-hint">下方短语可一键填入；Enter 发送，Shift+Enter 换行。</p>
          </>
        ) : null}
      </div>
    </div>
  )
}