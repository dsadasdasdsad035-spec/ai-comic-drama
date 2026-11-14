import { isViewId, type ViewId } from './nav'

/**
 * 两级 hash 路由：#/ 是项目大厅，#/p/<项目目录名>/<视图> 是工作区。
 *
 * 为什么不用路由库：只需要两级导航 + 浏览器返回键，react-router 会带来依赖、
 * basename 与部署路径问题；这里 30 行足够，且能保证「未知路径回落大厅、
 * 未知视图回落概览」这两条确定性行为。
 */
export type Route =
  | { kind: 'hub' }
  | { kind: 'project'; project: string; view: ViewId }

export const ROUTE_EVENT = 'sb-route'

/** 打开素材页时默认切到「角色」Tab（旧 #/chars 链接与概览快捷入口用） */
export const MATERIAL_TAB_CHARACTER_KEY = 'sb.material-tab'

export function primeMaterialTabCharacter(): void {
  try {
    sessionStorage.setItem(MATERIAL_TAB_CHARACTER_KEY, 'character')
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function hubHash(): string {
  return '#/'
}

export function projectHash(project: string, view: ViewId): string {
  return `#/p/${encodeURIComponent(project)}/${view}`
}

/**
 * 解析 hash。手输链接、刷新、返回键都走这里：
 * - 空 / 非 #/ 开头 / 段数不对 → 大厅
 * - 项目名解不出来 → 大厅
 * - 视图不认识（含历史上的 prompts / table）→ 概览
 */
export function parseHash(rawHash: string): Route {
  const hash = String(rawHash || '')
  if (!hash.startsWith('#/')) return { kind: 'hub' }
  const rest = hash.slice(2)
  if (!rest) return { kind: 'hub' }
  const parts = rest.split('/')
  if (parts[0] !== 'p' || parts.length < 2) return { kind: 'hub' }
  let project = ''
  try {
    project = decodeURIComponent(parts[1] || '')
  } catch {
    return { kind: 'hub' }
  }
  if (!project) return { kind: 'hub' }
  const rawView = parts[2] || ''
  if (rawView === 'chars') {
    primeMaterialTabCharacter()
    return { kind: 'project', project, view: 'assets' }
  }
  const view: ViewId = isViewId(rawView) ? rawView : 'overview'
  return { kind: 'project', project, view }
}

/** 程序化导航：同一 hash 不重复 push，避免返回键要按两次 */
export function navigate(hash: string): void {
  if (typeof window === 'undefined') return
  const next = hash || hubHash()
  if (window.location.hash === next) return
  window.history.pushState(null, '', next)
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/** 用 replace 回到大厅：删除当前项目后不该让返回键再跳回已删项目 */
export function replaceWithHub(): void {
  if (typeof window === 'undefined') return
  if (window.location.hash === hubHash()) return
  window.history.replaceState(null, '', hubHash())
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/* ---------------------------------------------------------------- 上次视图 */

const LAST_VIEW_PREFIX = 'sb.lastView.'

/** 每个项目记住上次所在的视图；键名带项目名，切项目不会串味。没有历史时落概览。 */
export function readLastView(project: string, fallback: ViewId = 'overview'): ViewId {
  if (!project) return fallback
  try {
    const v = localStorage.getItem(LAST_VIEW_PREFIX + project)
    if (v === 'chars') {
      primeMaterialTabCharacter()
      return 'assets'
    }
    return isViewId(v) ? v : fallback
  } catch {
    return fallback
  }
}

/** 删除项目后清掉它的上次视图记录：项目都没了，留着只会误导「打开项目」 */
export function clearLastView(project: string): void {
  if (!project) return
  try {
    localStorage.removeItem(LAST_VIEW_PREFIX + project)
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function writeLastView(project: string, view: ViewId): void {
  if (!project) return
  try {
    localStorage.setItem(LAST_VIEW_PREFIX + project, view)
  } catch {
    /* 存不了就只在本次会话生效 */
  }
}
