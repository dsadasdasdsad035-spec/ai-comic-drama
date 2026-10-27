/** 在线素材库的前端接口层：来源、检索、导入与来源元数据 */
import type {
  StockErrorKind,
  StockImportMeta,
  StockImportResult,
  StockProviderId,
  StockProviderInfo,
  StockSearchResult,
} from './types'

export class StockRequestError extends Error {
  kind: StockErrorKind | 'network'
  status: number
  constructor(message: string, kind: StockErrorKind | 'network' = 'provider', status = 0) {
    super(message || '在线素材请求失败')
    this.name = 'StockRequestError'
    this.kind = kind
    this.status = status
  }
}

async function readJson(r: Response): Promise<any> {
  const text = await r.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new StockRequestError('在线素材接口返回了非 JSON 响应', 'provider', r.status)
  }
}

async function request(path: string, init?: RequestInit): Promise<any> {
  let r: Response
  try {
    r = await fetch(path, init)
  } catch (e) {
    throw new StockRequestError(`网络请求失败：${(e as Error).message}`, 'network')
  }
  const j = await readJson(r)
  if (!j.ok) {
    throw new StockRequestError(
      String(j.message || `请求失败（HTTP ${r.status}）`),
      (j.kind as StockErrorKind) || (r.status === 429 ? 'rate-limit' : 'provider'),
      r.status,
    )
  }
  return j
}

export async function fetchStockProviders(): Promise<StockProviderInfo[]> {
  const j = await request('/api/stock/providers')
  return (j.providers ?? []) as StockProviderInfo[]
}

export type StockSearchParams = {
  provider: StockProviderId | ''
  mediaType: 'image' | 'video' | 'audio'
  query: string
  page?: number
  perPage?: number
  orientation?: string
}

export async function searchStockItems(params: StockSearchParams): Promise<StockSearchResult> {
  const q = new URLSearchParams({
    provider: params.provider,
    type: params.mediaType,
    q: params.query,
    ...(params.page ? { page: String(params.page) } : {}),
    ...(params.perPage ? { perPage: String(params.perPage) } : {}),
    ...(params.orientation ? { orientation: params.orientation } : {}),
  })
  const j = await request(`/api/stock/search?${q}`)
  return j as StockSearchResult
}

export async function importStockItem(params: {
  project: string
  token: string
}): Promise<StockImportResult> {
  const j = await request('/api/stock/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 只提交令牌：服务端拒绝任何客户端提供的地址字段
    body: JSON.stringify({ project: params.project, token: params.token }),
  })
  return j as StockImportResult
}

export async function fetchStockMeta(project: string, url: string): Promise<StockImportMeta | null> {
  const q = new URLSearchParams({ project, url })
  const j = await request(`/api/stock/meta?${q}`)
  return (j.meta ?? null) as StockImportMeta | null
}

/** 把接口错误翻成可操作提示；限流与鉴权不能显示成空结果 */
export function stockErrorMessage(e: unknown): string {
  if (!(e instanceof StockRequestError)) return (e as Error)?.message || String(e)
  if (e.kind === 'rate-limit') return '来源限流或额度不足，请稍后重试'
  if (e.kind === 'auth') return '来源凭据无效或未配置，去设置页的「素材库」检查'
  if (e.kind === 'network') return '网络不可达，请检查网络或来源地址'
  if (e.kind === 'expired') return '这个检索结果已过期，请重新检索'
  return e.message
}
