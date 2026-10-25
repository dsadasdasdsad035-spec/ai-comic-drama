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
export declare function openLoginWindow(opts: {
  profileDir: string
  url: string
  timeoutMs?: number
  isLoggedIn?: (page: unknown) => Promise<boolean>
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
}): LoginJob
export declare function markSessionAwaiting(id: string, message?: string): LoginJob | null
export declare function cancelLogin(id: string): LoginJob | null
export declare function clearFinishedSessions(maxAgeMs?: number): void
export declare function resetSessionsForTest(): void
