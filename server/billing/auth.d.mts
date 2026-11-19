/**
 * 账号与会话模块的类型声明。
 * 只覆盖服务端实际用到的导出；新增导出时请同步这里，否则 app.ts 会报隐式 any。
 */
export type BillingSession = {
  userId: number
  email: string
  emailVerified: boolean
}

export function registerUser(email: string, password: string): unknown
export function ensureVerifyStore(): unknown
export function createVerifyToken(userId: number): string
export function verifyEmail(token: string): unknown
export function grantSignupBonusOnce(userId: number): unknown
export function registerAndNotify(email: string, password: string, publicBaseUrl: string): Promise<unknown>
export function resendVerification(email: string, publicBaseUrl: string): Promise<unknown>
export function loginUser(email: string, password: string): { token: string; expiresAt?: number } | null
export function logoutToken(rawToken: string): void
export function sessionFromToken(rawToken: string | null | undefined): BillingSession | null
export function isBillingAdmin(email: string | null | undefined): boolean
export function parseSessionCookie(cookieHeader: string | string[] | undefined): string | null
export function parseBearer(authHeader: string | string[] | undefined): string | null
