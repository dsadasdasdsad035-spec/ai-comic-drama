/** server/publish-accounts.mjs 的类型声明（本机账号绑定，不含任何凭据） */

export type AccountStatus = 'connected' | 'expired' | 'unknown' | 'disabled'

export interface PublishAccount {
  id: string
  platform: string
  label: string
  status: AccountStatus
  lastCheckedAt: string
  autoDraft: boolean
  createdAt: string
  updatedAt: string
}

export interface PublishAccountInternal extends PublishAccount {
  profileDir: string
}

export declare const ACCOUNT_STATUS: AccountStatus[]

export declare function newAccountId(): string
export declare function listAccounts(root: string, opts?: { platform?: string }): PublishAccount[]
export declare function getAccount(root: string, id: string): PublishAccount | null
/** 按平台找已有账号：聊天发起的连接应复用它，而不是每次新建空 profile */
export declare function findAccountByPlatform(root: string, platform: string): PublishAccount | null
export declare function getAccountInternal(root: string, id: string): PublishAccountInternal | null
export declare function accountProfileDir(appRoot: string, accountId: string): string
export declare function upsertAccount(
  appRoot: string,
  input?: {
    id?: string
    platform: string
    label?: string
    status?: AccountStatus
    autoDraft?: boolean
    /** 更新已有账号时保留它原来的自动草稿开关 */
    keepAutoDraft?: boolean
  },
): PublishAccount | null
export declare function setAccountStatus(
  appRoot: string,
  id: string,
  status: AccountStatus,
  message?: string,
): { account: PublishAccount | null; message: string }
export declare function setAutoDraft(
  appRoot: string,
  id: string,
  enabled: boolean,
): PublishAccount | null
export declare function deleteAccount(appRoot: string, id: string): boolean
export declare function accountUsable(account: PublishAccount | null | undefined): boolean
