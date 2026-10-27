/** server/publish-browser.mjs 的类型声明（本机 Chrome 会话；只负责打开/检查，不做风控绕过） */

export type LoginStatus = 'opening' | 'awaiting' | 'done' | 'timeout' | 'error' | 'cancelled'
export type SessionStatus = 'connected' | 'expired' | 'unknown'

export interface LoginJob {
  id: string
  platform: string
  accountId: string
  status: LoginStatus
  message: string
  startedAt: number
  endedAt?: number
  /** 重新登录时必须用户点「我已完成登录」，窗口不会自己关 */
  requireConfirm?: boolean
  /** 是否已检测到平台会话（cookie 或后台元素） */
  detected?: boolean
}

export interface LoginResult {
  ok: boolean
  status: LoginStatus
  message: string
  url?: string
}

export declare const DEFAULT_LOGIN_HEURISTIC: {
  loginUrlHints: string[]
  loggedInSelector: string
}

export declare function newLoginId(): string
export declare function getSession(id: string): LoginJob | null
export declare function listSessions(): LoginJob[]
export declare function browserBusy(): boolean
export declare function looksLikeLoginUrl(url: string, heuristic?: typeof DEFAULT_LOGIN_HEURISTIC): boolean
/** 清掉上次异常退出留下的 Chromium 单例锁，否则同一 profile 永久打不开 */
export declare function clearStaleSingletonLocks(profileDir: string): void
/**
 * 构造登录判定：先认平台会话 cookie（权威信号），再退回适配器的 DOM 判定。
 * 总是返回函数；平台未知时只可能返回 false，调用方不会因此误判成功。
 */
export declare function adapterLoginProbe(
  platformId: string,
  opts?: { requiredChecks?: number; gapMs?: number },
): (page: unknown) => Promise<boolean>
export declare function openLoginWindow(opts: {
  profileDir: string
  url: string
  timeoutMs?: number
  isLoggedIn?: (page: unknown) => Promise<boolean>
  onOpened?: (info: { url: string }) => void
  shouldStop?: () => boolean
}): Promise<LoginResult>
export declare function checkSession(opts: {
  profileDir: string
  url: string
  isLoggedIn?: (page: unknown) => Promise<boolean>
}): Promise<{ status: SessionStatus; message: string }>
export declare function startLogin(opts?: {
  platform: string
  accountId?: string
  profileDir: string
  url?: string
  timeoutMs?: number
  isLoggedIn?: (page: unknown) => Promise<boolean>
  /** 重新登录：必须用户点「我已完成登录」，避免已存在的 cookie 秒过 */
  requireConfirm?: boolean
  /** 自动模式下的最小停留时间，避免窗口一闪而过 */
  minDwellMs?: number
  /** 登录结果回调：状态落库不依赖谁在轮询 */
  onResult?: (
    result: { ok: boolean; status: LoginStatus; message: string; url?: string },
    info: { id: string; platform: string; accountId: string },
  ) => void
}): LoginJob
/** 用户在窗口里完成扫码后点「我已完成登录」；真正判定仍由平台会话决定 */
export declare function confirmLogin(id: string): LoginJob | null
export declare function markSessionAwaiting(id: string, message?: string): LoginJob | null
export declare function cancelLogin(id: string): LoginJob | null
export declare function clearFinishedSessions(maxAgeMs?: number): void
export declare function resetSessionsForTest(): void
