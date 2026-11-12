import {
  Clapperboard,
  Images,
  LayoutDashboard,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * 项目视图导航的唯一清单。
 *
 * 左栏、路由白名单、快捷键顺序都读这里，避免三处各写一份列表。
 * 注意：这里不包含「提示词」与「镜头表」——首帧/视频提示词只在画布的单镜
 * Inspector 与画布内 Agent 里编辑。
 */
export type ViewId = 'overview' | 'creative' | 'chars' | 'assets' | 'board' | 'settings'

export type NavGroupId = 'main' | 'create' | 'system'

export type NavItem = {
  id: ViewId
  label: string
  group: NavGroupId
  icon: LucideIcon
  /** 标题片段，用于面包屑与文档标题 */
  crumb: string
  /** 左栏计数徽标的数据源；没有就是不显示计数 */
  countKey?: 'characters' | 'assets'
}

export const NAV_GROUPS: Array<{ id: NavGroupId; label: string }> = [
  { id: 'main', label: '项目' },
  { id: 'create', label: '创作' },
  { id: 'system', label: '系统' },
]

export const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: '概览', group: 'main', icon: LayoutDashboard, crumb: '概览' },
  { id: 'creative', label: '创意', group: 'create', icon: Sparkles, crumb: '创意' },
  { id: 'chars', label: '角色', group: 'create', icon: Users, crumb: '角色', countKey: 'characters' },
  { id: 'assets', label: '素材', group: 'create', icon: Images, crumb: '素材', countKey: 'assets' },
  { id: 'board', label: '画布', group: 'create', icon: Clapperboard, crumb: '画布' },
  { id: 'settings', label: '设置', group: 'system', icon: SettingsIcon, crumb: '设置' },
]

export const VIEW_IDS: ViewId[] = NAV_ITEMS.map((i) => i.id)

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as string[]).includes(value)
}

export function navItemOf(id: ViewId): NavItem {
  return NAV_ITEMS.find((i) => i.id === id) ?? NAV_ITEMS[0]
}

/** 只有这些视图有「当前集」概念；设置与概览不显示集选择器 */
export const EPISODE_VIEWS: ViewId[] = ['creative', 'chars', 'assets', 'board']

/** 需要横向空间的视图：窄屏时左栏优先让位 */
export const WIDE_VIEWS: ViewId[] = ['board']
