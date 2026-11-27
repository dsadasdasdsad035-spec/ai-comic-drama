import { isViewId, type ViewId } from './nav'

/**
 * 两级 hash 路由：#/ 是项目大厅，#/p/<项目目录名>/<视图> 是工作区。
 *
 * 账号页是第三种形态：它与具体项目无关（账号是跨项目的身份），所以不放进
 * `ViewId`，而是单列成 `#/account`。见 parseHash 的注释。
 *
 * 为什么不用路由库：只需要两级导航 + 浏览器返回键，react-router 会带来依赖、
 * basename 与部署路径问题；这里 30 行足够，且能保证「未知路径回落大厅、
 * 未知视图回落概览」这两条确定性行为。
 */
export type Route =
  | { kind: 'hub' }
  /** 全局账号页；next 是登录成功后要去的 hash（仅采纳合法的项目路由） */
  | { kind: 'account'; next?: string }
  /**
   * 全局知识库页。库是独立命名的资源，与项目无关，所以不放进 `ViewId`：
   * 放进项目视图组就意味着「必须先开一个项目才能管库」，而库本来就跨项目。
   */
  | { kind: 'knowledge' }
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

/** 全局知识库页地址 */
export function knowledgeHash(): string {
  return '#/knowledge'
}

/**
 * 全局账号页地址。`next` 用 hash 内查询参数承载而不是 sessionStorage：
 * 链接可分享、可刷新、可后退，且只在本次导航有效（登录后即用即弃），
 * 不会出现「上次残留的 next 把用户带到莫名其妙的地方」。
 */
export function accountHash(next?: string): string {
  const safe = safeNextHash(next)
  return safe ? `#/account?next=${encodeURIComponent(safe)}` : '#/account'
}

/**
 * 采纳 `next` 前必须校验：只接受能解析成项目视图的 hash。
 *
 * 为什么要拦：`next` 来自地址栏，可以被构造成任意值。不做校验就意味着
 * 登录后可以被送到站外地址（`#/account?next=https://evil`）或陷入循环。
 */
export function safeNextHash(next: string | undefined | null): string | undefined {
  const raw = String(next || '').trim()
  if (!raw.startsWith('#/p/')) return undefined
  const parsed = parseHash(raw)
  return parsed.kind === 'project' ? raw : undefined
}

/** 从 `#/account?next=...` 里取 next 参数（已校验） */
function parseAccountNext(rest: string): string | undefined {
  const q = rest.indexOf('?')
  if (q < 0) return undefined
  const params = new URLSearchParams(rest.slice(q + 1))
  return safeNextHash(params.get('next'))
}

/**
 * 解析 hash。手输链接、刷新、返回键都走这里：
 * - 空 / 非 #/ 开头 / 段数不对 → 大厅
 * - `#/account` → 全局账号页（带校验后的 next）
 * - `#/knowledge` → 全局知识库页
 * - `#/p/<项目>/account` / `#/p/<项目>/knowledge` → 归一成对应的全局页
 * - 项目名解不出来 → 大厅
 * - 视图不认识（含历史上的 prompts / table）→ 概览
 */
export function parseHash(rawHash: string): Route {
  const hash = String(rawHash || '')
  if (!hash.startsWith('#/')) return { kind: 'hub' }
  const rest = hash.slice(2)
  if (!rest) return { kind: 'hub' }
  // 全局账号页：`account` 或 `account?next=...`
  if (rest === 'account' || rest.startsWith('account?')) {
    const next = parseAccountNext(rest)
    return next ? { kind: 'account', next } : { kind: 'account' }
  }
  // 全局知识库页：库跨项目，没有项目也能进
  if (rest === 'knowledge') return { kind: 'knowledge' }
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
  // 账号页、知识库页曾经是项目视图：旧链接必须是「重定向到全局页」，
  // 不能因为 ViewId 里已经没有它而落到「未知视图回落概览」。
  if (rawView === 'account') return { kind: 'account' }
  if (rawView === 'knowledge') return { kind: 'knowledge' }
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
