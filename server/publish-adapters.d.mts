/** server/publish-adapters.mjs 的类型声明（平台适配器接口与注册表） */

export interface AdapterContext {
  videoPath: string
  title: string
  description: string
  tags: string[]
  /** 上传完成等待上限；真实平台用默认 10 分钟，验证脚本传小值 */
  uploadTimeoutMs?: number
}

export interface AdapterSessionResult {
  status: 'connected' | 'expired' | 'unknown'
  message: string
}

export interface PlatformAdapter {
  platform: string
  verified: boolean
  manualOnly: boolean
  openBackend: (page: unknown) => Promise<unknown>
  checkSession: (page: unknown) => Promise<AdapterSessionResult>
  uploadVideo: (page: unknown, ctx: AdapterContext) => Promise<unknown>
  fillMetadata: (page: unknown, ctx: AdapterContext) => Promise<unknown>
  saveDraft: (page: unknown) => Promise<unknown>
  submitFinal: (page: unknown) => Promise<unknown>
  readStatus: (page: unknown) => Promise<{ status: string; url?: string }>
}

export declare const ADAPTER_METHODS: string[]
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
export declare function listAdapters(): { platform: string; verified: boolean; manualOnly: boolean }[]
export declare function adapterCanExecute(platformId: string, mode?: string): boolean
export declare function adapterCanPublishFinal(platformId: string): boolean
export declare function resetAdaptersForTest(): void
