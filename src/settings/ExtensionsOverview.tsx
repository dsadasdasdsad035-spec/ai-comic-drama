import type { SettingsPane } from './settingsNav'

type Card = {
  pane: SettingsPane
  title: string
  hint: string
  stat?: string
}

type Props = {
  skillCount: number
  onOpen: (pane: SettingsPane) => void
}

export default function ExtensionsOverview({ skillCount, onOpen }: Props) {
  const cards: Card[] = [
    { pane: 'agent', title: 'Agent', hint: '宿主模式、轮次与工具限制', stat: '配置' },
    { pane: 'creative', title: '创意', hint: '创意工作室适配器与环节默认', stat: '配置' },
    { pane: 'skills', title: '技能', hint: 'SkillHub 与已安装 Agent 包', stat: `${skillCount} 个` },
    { pane: 'mcp', title: 'MCP', hint: '市场安装与凭据', stat: '管理' },
    { pane: 'experts', title: '创意专家', hint: 'Soul 模板与工具白名单', stat: '管理' },
    { pane: 'stock', title: '素材库', hint: '在线素材渠道 Key', stat: '配置' },
  ]

  return (
    <section className="st-sec" data-settings-pane="overview">
      <header className="st-sec-head">
        <h3>扩展总览</h3>
        <span className="st-hint">从摘要进入子页进行完整配置</span>
      </header>
      <div className="st-ext-overview-grid">
        {cards.map((c) => (
          <button
            key={c.pane}
            type="button"
            className="st-ext-overview-card"
            onClick={() => onOpen(c.pane)}
          >
            <b>{c.title}</b>
            <span className="st-hint">{c.hint}</span>
            {c.stat && <span className="st-ext-overview-stat">{c.stat}</span>}
          </button>
        ))}
      </div>
    </section>
  )
}