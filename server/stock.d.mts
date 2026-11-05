/** server/stock.mjs 的类型声明（在线素材检索/导入；协议见 design.md D1–D4） */

export declare type StockMediaType = 'image' | 'video' | 'audio'
export declare type StockProviderId =
  | 'pexels'
  | 'pixabay'
  | 'openverse'
  | 'unsplash'
  | 'coverr'
  | 'mixkit'
  | 'vjshi'
export declare type StockProviderKind = 'api' | 'html' | 'link'

export declare type StockLicense = {
  name: string
  url: string
  attribution: string
  requiresAttribution: boolean
}

export declare type StockVariant = {
  url: string
  mime: string
  width?: number
  height?: number
  duration?: number
  bytes?: number
}

export declare type StockItem = {
  provider: StockProviderId
  itemId: string
  mediaType: StockMediaType
  title: string
  author: string
  authorUrl: string
  sourceUrl: string
  license: StockLicense
  thumbnailUrl: string
  previewUrl: string
  variants: StockVariant[]
  width?: number
  height?: number
  duration?: number
  /** Unsplash 下载计数地址：导入前换取真实文件地址 */
  downloadLocation?: string
  token?: string
}

export declare type StockTranslation = {
  from: string
  to: string
  via: 'glossary' | 'model'
}

export declare type StockSearchResult = {
  provider: StockProviderId
  mediaType: StockMediaType
  /** 实际发给来源的关键词（可能是译词） */
  query: string
  /** 用户输入的原词 */
  requestedQuery?: string
  translated?: StockTranslation
  /** 中文没翻成英文：界面必须提示可能没有结果 */
  translateFailed?: boolean
  page: number
  perPage: number
  total?: number
  hasMore: boolean
  cached: boolean
  items: StockItem[]
}

export declare type StockProviderInfo = {
  id: StockProviderId
  label: string
  kind: StockProviderKind
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  ok: boolean
  reason?: string
  keyFromEnv?: boolean
  searchable: boolean
  importable: boolean
  /** 外链模板，`{query}` 由前端替换 */
  externalUrlTemplate?: string
}

export declare const SEARCH_CACHE_TTL_MS: number
export declare const SEARCH_CACHE_MAX: number
export declare const TOKEN_TTL_MS: number
export declare const TOKEN_MAX: number
export declare const DOWNLOAD_TIMEOUT_MS: number
export declare const MEDIA_LIMITS: Record<StockMediaType, number>

export declare class StockError extends Error {
  kind: string
  status: number
  provider: string
  constructor(
    message: string,
    options?: { kind?: string; status?: number; provider?: string },
  )
}

export declare type StockFetch = typeof fetch
export declare type StockSettingsInput = unknown
export declare type StockEnv = Record<string, string | undefined>
/** 中文关键词翻译：由路由层注入已配置的文本模型 */
export declare type StockTranslateChat = (text: string, timeoutMs: number) => Promise<string>

export declare function listAdapters(): Array<{
  id: StockProviderId
  label: string
  kind: StockProviderKind
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  defaultBaseUrl: string
  defaultPerPage?: number
  perPageMax?: number
  pageMax?: number
}>
export declare function getAdapter(id: string): ReturnType<typeof listAdapters>[number] | null
export declare function describeProviders(settings: StockSettingsInput, env?: StockEnv): StockProviderInfo[]
export declare function providerAvailability(
  settings: StockSettingsInput,
  id: string,
  env?: StockEnv,
): StockProviderInfo | null
export declare function resetStockState(): void
export declare function readToken(
  token: string,
  now?: number,
): { item: StockItem; at: number } | null
export declare function issueStockToken(item: StockItem, now?: number): string
export declare function searchStock(input: {
  provider: string
  mediaType?: string
  query: string
  page?: number
  perPage?: number
  orientation?: string
  settings?: StockSettingsInput
  env?: StockEnv
  fetchImpl?: StockFetch
  now?: number
  chat?: StockTranslateChat
}): Promise<StockSearchResult>
export declare function pickVariant(item: StockItem): StockVariant | null
export declare type StockImportResult = {
  url: string
  provider: StockProviderId
  itemId: string
  mediaType: StockMediaType
  reused: boolean
  meta: Record<string, any> | undefined
}
export declare function importStockItem(input: {
  token: string
  project: string
  root: string
  settings?: StockSettingsInput
  env?: StockEnv
  fetchImpl?: StockFetch
  assertPublic?: (url: string) => Promise<unknown>
  now?: number
}): Promise<StockImportResult>
export declare function stockMetaForUrl(
  root: string,
  project: string,
  url: string,
): Record<string, any> | null
