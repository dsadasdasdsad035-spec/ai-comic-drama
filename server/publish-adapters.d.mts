/** server/publish-adapters.mjs 的类型声明（平台适配器接口与注册表） */

export interface AdapterContext {
  videoPath: string
  title: string
  description: string
  tags: string[]
  /** 平台首选的封面绝对路径；空串表示该平台没有可用封面 */
  coverPath?: string
  /** 比例 → 封面绝对路径，供需要多比例的适配器使用 */
  covers?: Record<string, string>
  /** 上传完成等待上限；真实平台用默认 10 分钟，验证脚本传小值 */
  uploadTimeoutMs?: number
}

export interface AdapterSessionResult {
  status: 'connected' | 'expired' | 'unknown'
  message: string
}

export type CoverSupport = 'supported' | 'unverified' | 'unsupported'

export interface PlatformAdapter {
  platform: string
  verified: boolean
  manualOnly: boolean
  /** 封面投递能力；缺省按 unverified 处理 */
  coverSupport?: CoverSupport
  openBackend: (page: unknown) => Promise<unknown>
  checkSession: (page: unknown) => Promise<AdapterSessionResult>
  uploadVideo: (page: unknown, ctx: AdapterContext) => Promise<unknown>
  fillMetadata: (page: unknown, ctx: AdapterContext) => Promise<unknown>
  /** 仅 coverSupport=supported 时会被调用 */
  uploadCover?: (page: unknown, ctx: AdapterContext) => Promise<unknown>
  saveDraft: (page: unknown) => Promise<unknown>
  submitFinal: (page: unknown) => Promise<unknown>
  readStatus: (page: unknown) => Promise<{ status: string; url?: string }>
}

export declare const ADAPTER_METHODS: string[]
export declare const COVER_SUPPORT: CoverSupport[]
export declare const DEFAULT_COVER_SUPPORT: CoverSupport
export declare const DOUYIN_ADAPTER: PlatformAdapter
export declare const BILIBILI_ADAPTER: PlatformAdapter
export declare const TOUTIAO_ADAPTER: PlatformAdapter
export declare function runSteps(
  page: unknown,
  steps: Record<string, unknown>[],
  ctx?: Record<string, unknown>,
): Promise<string[]>
export declare function registerAdapter(adapter: PlatformAdapter): PlatformAdapter
export declare function getAdapter(platformId: string): PlatformAdapter | null
export declare function adapterCanAttachCover(platformId: string): boolean
export declare function listAdapters(): {
  platform: string
  verified: boolean
  manualOnly: boolean
  coverSupport: CoverSupport
}[]
export declare function adapterCanExecute(platformId: string, mode?: string): boolean
export declare function adapterCanPublishFinal(platformId: string): boolean
export declare function resetAdaptersForTest(): void
