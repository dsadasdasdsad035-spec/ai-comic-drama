import {
  Clapperboard,
  FileText,
  Images,
  LayoutDashboard,
  Library,
  Settings as SettingsIcon,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

/**
 * 项目视图导航的唯一清单。
 *
 * 左栏、路由白名单、快捷键顺序都读这里，避免三处各写一份列表。
 * 注意：
 * - 这里不包含「提示词」与「镜头表」——首帧/视频提示词只在画布的单镜
 *   Inspector 与画布内 Agent 里编辑。
 * - 这里不包含「账号与充值」——账号是跨项目的身份，不是项目视图。
 *   它是全局路由 `#/account`，入口在项目大厅顶栏，见 shell/route.ts。
 * - 这里不包含「知识库」——库是独立命名的资源，与项目无关，
 *   它是全局路由 `#/knowledge`，入口在大厅顶栏与项目内左栏两处。
 */
export type ViewId =
  | 'overview'
  | 'creative'
  | 'assets'
  | 'script'
  | 'board'
  | 'settings'

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
  { id: 'assets', label: '素材', group: 'create', icon: Images, crumb: '素材', countKey: 'assets' },
  { id: 'script', label: '剧本', group: 'create', icon: FileText, crumb: '剧本' },
  { id: 'board', label: '画布', group: 'create', icon: Clapperboard, crumb: '画布' },
  { id: 'settings', label: '设置', group: 'system', icon: SettingsIcon, crumb: '设置' },
]

/**
 * 全局导航（与具体项目无关）。
 *
 * 与 `NAV_ITEMS` 分开的理由：这些条目对应的不是 `ViewId`，而是全局 hash
 * （`#/knowledge`）。混进 `ViewId` 会让「route.kind === 'project'」的假定失效，
 * 也会让 `isViewId()` 开始认一个没有项目的视图。
 */
export type GlobalNavItem = {
  id: 'knowledge'
  label: string
  icon: LucideIcon
  /** 目标 hash，由外壳直接 navigate */
  hash: string
}

export const GLOBAL_NAV_ITEMS: GlobalNavItem[] = [
  { id: 'knowledge', label: '知识库', icon: Library, hash: '#/knowledge' },
]

export const VIEW_IDS: ViewId[] = NAV_ITEMS.map((i) => i.id)

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as string[]).includes(value)
}

export function navItemOf(id: ViewId): NavItem {
  return NAV_ITEMS.find((i) => i.id === id) ?? NAV_ITEMS[0]
}

/** 只有这些视图有「当前集」概念；创意/设置/概览/素材不显示集选择器 */
export const EPISODE_VIEWS: ViewId[] = ['board']

/** 需要横向空间的视图：窄屏时左栏优先让位 */
export const WIDE_VIEWS: ViewId[] = ['board']
