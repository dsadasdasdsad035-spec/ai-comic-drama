/** 在线素材库的前端类型：与 server/stock.mjs 的归一化结果一一对应 */

export type StockProviderId = 'pexels' | 'pixabay' | 'openverse'
export type StockMediaType = 'image' | 'video' | 'audio'

/** 设置页读回的形状：Key 只给「有没有」 */
export type StockProviderView = {
  enabled: boolean
  baseUrl: string
  hasApiKey: boolean
  /** Key 来自环境变量而不是设置库 */
  keyFromEnv?: boolean
}

/** 编辑态：可以带 apiKey；提交后服务端会把它换成 hasApiKey */
export type StockProviderDraft = StockProviderView & { apiKey?: string }

export type StockSettings = {
  providers: Partial<Record<StockProviderId, StockProviderDraft>>
}

export type StockProviderInfo = {
  id: StockProviderId
  label: string
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  ok: boolean
  reason?: string
  keyFromEnv?: boolean
}

export type StockLicense = {
  name: string
  url: string
  attribution: string
  requiresAttribution: boolean
}

export type StockVariant = {
  url: string
  mime: string
  width?: number
  height?: number
  duration?: number
  bytes?: number
}

export type StockItem = {
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
  /** 导入令牌：客户端只回传它，不回传下载地址 */
  token: string
}

export type StockSearchResult = {
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

export type StockImportResult = {
  url: string
  provider: StockProviderId
  itemId: string
  mediaType: StockMediaType
  reused: boolean
  meta: StockImportMeta
}

export type StockImportMeta = {
  provider: string
  itemId: string
  url: string
  mediaType: string
  title: string
  author: string
  authorUrl: string
  sourceUrl: string
  license: string
  licenseUrl: string
  attribution: string
  width?: number
  height?: number
  duration?: number
  bytes?: number
  createdAt: string
}

export type StockErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'provider'
  | 'bad-request'
  | 'too-large'
  | 'unsupported-type'
  | 'not-found'
  | 'expired'

export type StockImportTarget = 'asset' | 'scene' | 'prop'
