import type { ReactNode } from 'react'
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV_GROUPS, NAV_ITEMS, type ViewId } from './nav'

export type SideNavProps = {
  view: ViewId
  onNavigate: (view: ViewId) => void
  /** 当前项目名块；由外壳注入，左栏自己不知道项目从哪来 */
  projectSlot: ReactNode
  /** 折叠状态：外壳统一持有，左栏只负责呈现 */
  collapsed: boolean
  onToggleCollapsed: () => void
  onReturnHub: () => void
  /** 角色 / 素材数量徽标 */
  counts?: Partial<Record<'characters' | 'assets', number>>
  /** 底部全局工具（主题开关等） */
  footer: ReactNode
}

/**
 * 项目工作区左栏。
 *
 * 只放项目身份、项目菜单、视图导航与全局工具；视图自己的范围/设置/动作
 * 一律留在内容列的视图工具条里，避免左栏随着某个视图膨大。
 * 折叠态用 `data-collapsed` 驱动 CSS，标签隐藏但 aria-label 保留。
 */
export default function SideNav({
  view,
  onNavigate,
  projectSlot,
  collapsed,
  onToggleCollapsed,
  onReturnHub,
  counts = {},
  footer,
}: SideNavProps) {
  return (
    <aside className="rail" data-collapsed={collapsed ? 'true' : 'false'} aria-label="项目导航">
      <div className="rail-head">
        {projectSlot}
        <button
          type="button"
          className="rail-hub-back"
          onClick={onReturnHub}
          title="返回项目大厅"
          aria-label="返回项目大厅"
        >
          <ChevronLeft size={14} aria-hidden />
          <span className="rail-label">项目大厅</span>
        </button>
      </div>

      <nav className="rail-nav viewtabs" aria-label="项目视图">
        {NAV_GROUPS.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group.id)
          if (!items.length) return null
          return (
            <div className="rail-group" role="group" aria-label={group.label} key={group.id}>
              <div className="rail-group-title" aria-hidden>
                {group.label}
              </div>
              {items.map((item) => {
                const count = item.countKey ? counts[item.countKey] : undefined
                const active = item.id === view
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? 'on' : ''}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon size={16} aria-hidden className="rail-icon" />
                    <span className="rail-label">{item.label}</span>
                    {typeof count === 'number' && count > 0 ? (
                      <span className="rail-count">{count}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )
        })}
      </nav>

      <div className="rail-foot">
        {footer}
        <button
          type="button"
          className="rail-collapse"
          onClick={onToggleCollapsed}
          aria-pressed={collapsed}
          title={collapsed ? '展开侧栏 [ ' : '折叠侧栏 [ '}
          aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
        >
          {collapsed ? (
            <PanelLeftOpen size={15} aria-hidden />
          ) : (
            <PanelLeftClose size={15} aria-hidden />
          )}
          <span className="rail-label">折叠</span>
        </button>
      </div>
    </aside>
  )
}
