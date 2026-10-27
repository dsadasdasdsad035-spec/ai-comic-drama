/** server/stock.mjs 的类型声明（在线素材检索/导入；协议见 design.md D1–D4） */

export declare type StockMediaType = 'image' | 'video' | 'audio'
export declare type StockProviderId = 'pexels' | 'pixabay' | 'openverse'

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
  token?: string
}

export declare type StockSearchResult = {
  provider: StockProviderId
  mediaType: StockMediaType
  query: string
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
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  ok: boolean
  reason?: string
  keyFromEnv?: boolean
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

export declare function listAdapters(): Array<{
  id: StockProviderId
  label: string
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  defaultBaseUrl: string
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
