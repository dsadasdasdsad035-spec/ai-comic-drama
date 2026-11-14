import type { StockProviderId } from './types'

const CUSTOM_KEY = 'stock.onlineList.custom.v1'

export type StockLinkEntry = {
  id: string
  title: string
  description: string
  imageUrl: string
  href: string
  /** 可在应用内检索并导入时关联来源 */
  providerId?: StockProviderId
  tags?: string[]
  /** 内置推荐，不可在 UI 删除 */
  builtin?: boolean
}

function favicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
}

/** 内置推荐：对应设置页已登记的公开图库与外链站 */
export const DEFAULT_STOCK_LINKS: StockLinkEntry[] = [
  {
    id: 'pexels',
    title: 'Pexels',
    description: '免费图片与视频；设置启用 Key 后可在本应用内检索并下载到项目。',
    imageUrl: favicon('pexels.com'),
    href: 'https://www.pexels.com',
    providerId: 'pexels',
    tags: ['图片', '视频', '免费'],
    builtin: true,
  },
  {
    id: 'pixabay',
    title: 'Pixabay',
    description: '图片与视频图库，中文关键词检索较友好；支持站内导入。',
    imageUrl: favicon('pixabay.com'),
    href: 'https://pixabay.com',
    providerId: 'pixabay',
    tags: ['图片', '视频'],
    builtin: true,
  },
  {
    id: 'openverse',
    title: 'Openverse',
    description: 'CC 许可图片与音频；可选 Key，匿名额度较低。',
    imageUrl: favicon('openverse.org'),
    href: 'https://openverse.org',
    providerId: 'openverse',
    tags: ['图片', '音频', 'CC'],
    builtin: true,
  },
  {
    id: 'unsplash',
    title: 'Unsplash',
    description: '高质量摄影图；检索以英文关键词为主，支持站内导入。',
    imageUrl: favicon('unsplash.com'),
    href: 'https://unsplash.com',
    providerId: 'unsplash',
    tags: ['图片'],
    builtin: true,
  },
  {
    id: 'coverr',
    title: 'Coverr',
    description: '免费短片素材；英文关键词，支持站内视频导入。',
    imageUrl: favicon('coverr.co'),
    href: 'https://coverr.co',
    providerId: 'coverr',
    tags: ['视频'],
    builtin: true,
  },
  {
    id: 'mixkit',
    title: 'Mixkit',
    description: '免费视频片段；无需 Key，由服务端解析页面检索并导入。',
    imageUrl: favicon('mixkit.co'),
    href: 'https://mixkit.co/free-stock-video',
    providerId: 'mixkit',
    tags: ['视频', '免费'],
    builtin: true,
  },
  {
    id: 'vjshi',
    title: 'VJShi 光厂',
    description: '国内正版素材市场；仅外链跳转，购买后请手动上传到项目。',
    imageUrl: favicon('vjshi.com'),
    href: 'https://www.vjshi.com',
    providerId: 'vjshi',
    tags: ['图片', '视频', '付费'],
    builtin: true,
  },
]

export function loadCustomStockLinks(): StockLinkEntry[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x) => x && typeof x === 'object')
      .map((x) => x as StockLinkEntry)
      .filter((x) => x.id && x.title && x.href)
      .map((x) => ({
        id: String(x.id),
        title: String(x.title).trim(),
        description: String(x.description || '').trim(),
        imageUrl: String(x.imageUrl || favicon(safeHost(x.href))).trim(),
        href: String(x.href).trim(),
        tags: Array.isArray(x.tags) ? x.tags.map(String) : [],
        builtin: false,
      }))
  } catch {
    return []
  }
}

export function saveCustomStockLinks(list: StockLinkEntry[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list))
  } catch {
    /* 忽略 */
  }
}

function safeHost(href: string): string {
  try {
    return new URL(href).hostname
  } catch {
    return 'example.com'
  }
}

export function newCustomLinkId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function mergeStockLinks(custom: StockLinkEntry[]): StockLinkEntry[] {
  const builtinIds = new Set(DEFAULT_STOCK_LINKS.map((x) => x.id))
  const extra = custom.filter((c) => !builtinIds.has(c.id))
  return [...DEFAULT_STOCK_LINKS, ...extra]
}

export function filterStockLinks(entries: StockLinkEntry[], query: string): StockLinkEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => {
    const hay = [e.title, e.description, ...(e.tags || [])].join(' ').toLowerCase()
    return hay.includes(q)
  })
}