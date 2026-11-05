/** 在线素材库的前端类型：与 server/stock.mjs 的归一化结果一一对应 */

export type StockProviderId =
  | 'pexels'
  | 'pixabay'
  | 'openverse'
  | 'unsplash'
  | 'coverr'
  | 'mixkit'
  | 'vjshi'

/** 来源访问方式：外链型只给站内搜索入口 */
export type StockProviderKind = 'api' | 'html' | 'link'

export type StockMediaType = 'image' | 'video' | 'audio'

/** 检索关键词的翻译结果（只在含中文时出现） */
export type StockTranslation = {
  from: string
  to: string
  via: 'glossary' | 'model'
}

/** 设置页读回的形状：Key 只给「有没有」 */
export type StockProviderView = {
  enabled: boolean
  baseUrl: string
  hasApiKey: boolean
  /** 来源访问方式 */
  kind?: StockProviderKind
  /** 是否需要填 Key（html/link 型不需要） */
  requiresKey?: boolean
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
  /** 访问方式：api = 官方接口，html = 服务端解析页面，link = 只给外链 */
  kind: StockProviderKind
  mediaTypes: StockMediaType[]
  requiresKey: boolean
  ok: boolean
  reason?: string
  keyFromEnv?: boolean
  /** 外链型来源为 false：不渲染检索框与导入按钮 */
  searchable?: boolean
  importable?: boolean
  /** 外链模板，`{query}` 由前端替换成编码后的关键词 */
  externalUrlTemplate?: string
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
  /** 实际发给来源的关键词（可能是译词） */
  query: string
  /** 用户输入的原词 */
  requestedQuery?: string
  /** 中文关键词译成了什么 */
  translated?: StockTranslation
  /** 中文没翻成英文：界面必须提示「可能没有结果」 */
  translateFailed?: boolean
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
