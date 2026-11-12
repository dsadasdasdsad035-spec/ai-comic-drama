import type { ReactNode } from 'react'
import SideNav from './SideNav'
import { navItemOf, type ViewId } from './nav'

export type AppShellProps = {
  view: ViewId
  projectTitle: string
  onNavigate: (view: ViewId) => void
  onReturnHub: () => void
  /** 左栏顶部的项目身份块（含项目菜单） */
  projectSlot: ReactNode
  /** 头部的集选择器；没有集概念的视图传 null */
  episodeSlot: ReactNode | null
  /** 头部右端全局工具（任务中心、导出等） */
  globalTools: ReactNode
  /** 左栏底部全局工具（主题开关） */
  railFooter: ReactNode
  counts?: Partial<Record<'characters' | 'assets', number>>
  collapsed: boolean
  onToggleCollapsed: () => void
  children: ReactNode
}

/**
 * 工作区外壳：头部（面包屑 + 集选择器 + 全局工具）+ 左栏 + 内容列。
 *
 * 视图只作为插槽塞进内容列，因此 Canvas / CharacterBoard / AssetBoard /
 * Settings / CreativeStudio 内部结构不用改。头部沿用 `.topbar` 类名是因为
 * 主题与动效规则挂在它上面，换名会连带丢掉过渡与窄屏规则。
 */
export default function AppShell({
  view,
  projectTitle,
  onNavigate,
  onReturnHub,
  projectSlot,
  episodeSlot,
  globalTools,
  railFooter,
  counts,
  collapsed,
  onToggleCollapsed,
  children,
}: AppShellProps) {
  const item = navItemOf(view)

  return (
    <div className="app" data-rail={collapsed ? 'collapsed' : 'expanded'}>
      <header className="topbar">
        <nav className="crumbs" aria-label="位置">
          <button type="button" className="crumb crumb-hub" onClick={onReturnHub} title="返回项目大厅">
            项目
          </button>
          <span className="crumb-sep" aria-hidden>
            /
          </span>
          <span className="crumb crumb-project" title={projectTitle}>
            {projectTitle}
          </span>
          <span className="crumb-sep" aria-hidden>
            /
          </span>
          <span className="crumb crumb-view" aria-current="page">
            {item.crumb}
          </span>
        </nav>

        {episodeSlot && <div className="topbar-ep">{episodeSlot}</div>}

        <div className="spacer" />
        <div className="topbar-tools">{globalTools}</div>
      </header>

      <div className="app-body">
        <SideNav
          view={view}
          onNavigate={onNavigate}
          projectSlot={projectSlot}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onReturnHub={onReturnHub}
          counts={counts}
          footer={railFooter}
        />
        <div className="app-main">{children}</div>
      </div>
    </div>
  )
}
