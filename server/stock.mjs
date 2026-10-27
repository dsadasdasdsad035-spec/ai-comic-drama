/**
 * 在线素材来源：检索归一化、结果缓存、导入令牌与下载校验。
 *
 * 协议约束（见 design.md D1–D4）：
 * - 每个来源是纯对象适配器，检索结果统一成 StockItem，新增来源不改对外契约。
 * - 客户端只拿令牌，导入时服务端重新解析下载地址；不接受客户端提交的 URL。
 * - 下载前做公网校验、类型白名单、流式大小上限与超时，失败不留文件。
 * - 纯 HTTP + 文件 IO，不依赖 vite，可用 node 直接测试。
 */
import crypto from 'node:crypto'
import { assertPublicUrl } from './ingest.mjs'
import { findStockImportByUrl, getStockImportByItem, upsertStockImport } from './db.mjs'
import {
  projectMediaExists,
  saveProjectMedia,
  saveProjectMediaStream,
} from './media.mjs'
import {
  STOCK_PROVIDER_DEFAULTS,
  STOCK_PROVIDER_IDS,
  applyStockEnvDefaults,
} from './stock-settings.mjs'

export const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
export const SEARCH_CACHE_MAX = 200
export const TOKEN_TTL_MS = 30 * 60 * 1000
export const TOKEN_MAX = 1000
export const DOWNLOAD_TIMEOUT_MS = 120_000

export const MEDIA_LIMITS = {
  image: 30 * 1024 * 1024,
  audio: 30 * 1024 * 1024,
  video: 200 * 1024 * 1024,
}

const CONTENT_TYPES = {
  image: [
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
    ['image/gif', 'gif'],
  ],
  video: [
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['video/webm', 'webm'],
  ],
  audio: [
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['audio/ogg', 'ogg'],
    ['audio/opus', 'opus'],
    ['audio/mp4', 'm4a'],
    ['audio/aac', 'aac'],
    ['audio/flac', 'flac'],
    ['audio/x-flac', 'flac'],
  ],
}

const URL_EXT = /\.([a-z0-9]{2,5})(?:[?#]|$)/i
const EXT_BY_EXT = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  m4v: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  opus: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
}

export class StockError extends Error {
  constructor(message, { kind = 'provider', status = 0, provider = '' } = {}) {
    super(String(message || '在线素材请求失败'))
    this.name = 'StockError'
    this.kind = kind
    this.status = status
    this.provider = provider
  }
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

function errorFromResponse(text, status, provider) {
  let message = String(text || '').slice(0, 300)
  try {
    const j = JSON.parse(text)
    message = String(j?.error?.message || j?.error || j?.message || message)
  } catch {
    /* 保留原始文本 */
  }
  const kind =
    status === 401 || status === 403
      ? 'auth'
      : status === 429 || /rate.?limit|quota/i.test(message)
        ? 'rate-limit'
        : status === 400 || status === 422
          ? 'bad-request'
          : 'provider'
  return new StockError(`${provider}：${message || `HTTP ${status}`}`, { kind, status, provider })
}

async function requestJson(url, { apiKey, headers = {}, fetchImpl = fetch, provider = '', timeoutMs = 30_000 } = {}) {
  const h = { Accept: 'application/json', ...headers }
  if (apiKey && !h.Authorization) h.Authorization = `Bearer ${apiKey}`
  let r
  try {
    r = await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new StockError(`${provider}：${e?.message || '网络请求失败'}`, { kind: 'network', provider })
  }
  const text = await r.text()
  if (!r.ok) throw errorFromResponse(text, r.status, provider)
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new StockError(`${provider}：来源返回了非 JSON 响应`, { kind: 'provider', status: r.status, provider })
  }
}

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}${path}`
}

function attributionOf(author, sourceLabel, license) {
  return license.requiresAttribution
    ? `${author ? `“${author}”` : '未署名作品'} · ${license.name} · ${sourceLabel}`
    : `${author ? `${author}` : '未署名'} · ${license.name} · ${sourceLabel}`
}

function makeLicense({ name, url, requiresAttribution, author, sourceLabel }) {
  const license = { name: str(name), url: str(url), attribution: '', requiresAttribution: Boolean(requiresAttribution) }
  license.attribution = attributionOf(author, sourceLabel, license)
  return license
}

// ---------------------------------------------------------------- 适配器

function pexelsAdapter() {
  return {
    id: 'pexels',
    label: 'Pexels',
    mediaTypes: ['image', 'video'],
    requiresKey: true,
    defaultBaseUrl: STOCK_PROVIDER_DEFAULTS.pexels.baseUrl,
    async search({ query, mediaType, page, perPage, orientation, apiKey, baseUrl, fetchImpl }) {
      const params = new URLSearchParams({ query, page: String(page), per_page: String(perPage) })
      if (orientation) params.set('orientation', orientation)
      const endpoint =
        mediaType === 'video'
          ? joinUrl(baseUrl, `/videos/search?${params}`)
          : joinUrl(baseUrl, `/v1/search?${params}`)
      // Pexels 用裸 Key 作 Authorization 头，不加 Bearer
      const j = await requestJson(endpoint, {
        headers: { Authorization: String(apiKey || '') },
        fetchImpl,
        provider: 'Pexels',
      })
      const list = mediaType === 'video' ? j?.videos : j?.photos
      const items = (Array.isArray(list) ? list : []).map((p) => normalizePexels(p, mediaType))
      return { items, total: Number(j?.total_results) || undefined, hasMore: Boolean(j?.next_page) }
    },
  }
}

function normalizePexels(p, mediaType) {
  const sourceLabel = 'Pexels'
  if (mediaType === 'video') {
    const files = Array.isArray(p?.video_files) ? p.video_files : []
    const variants = files
      .filter((f) => f?.link)
      .map((f) => ({
        url: String(f.link),
        mime: String(f.file_type || 'video/mp4'),
        width: Number(f.width) || undefined,
        height: Number(f.height) || undefined,
        duration: Number(p.duration) || undefined,
      }))
    const author = str(p?.user?.name)
    return {
      provider: 'pexels',
      itemId: String(p?.id ?? ''),
      mediaType: 'video',
      title: str(p?.url) ? `Pexels 视频 ${p.id}` : `Pexels 视频 ${p?.id ?? ''}`,
      author,
      authorUrl: str(p?.user?.url),
      sourceUrl: str(p?.url),
      license: makeLicense({
        name: 'Pexels License',
        url: 'https://www.pexels.com/license/',
        requiresAttribution: false,
        author,
        sourceLabel,
      }),
      thumbnailUrl: str(p?.image),
      previewUrl: str(p?.image),
      variants,
      width: Number(p?.width) || undefined,
      height: Number(p?.height) || undefined,
      duration: Number(p?.duration) || undefined,
    }
  }
  const src = p?.src || {}
  const variants = ['original', 'large2x', 'large', 'medium', 'small']
    .filter((k) => str(src[k]))
    .map((k) => ({
      url: String(src[k]),
      mime: 'image/jpeg',
      width: k === 'original' ? Number(p?.width) || undefined : undefined,
      height: k === 'original' ? Number(p?.height) || undefined : undefined,
    }))
  const author = str(p?.photographer)
  return {
    provider: 'pexels',
    itemId: String(p?.id ?? ''),
    mediaType: 'image',
    title: str(p?.alt) || `Pexels 图片 ${p?.id ?? ''}`,
    author,
    authorUrl: str(p?.photographer_url),
    sourceUrl: str(p?.url),
    license: makeLicense({
      name: 'Pexels License',
      url: 'https://www.pexels.com/license/',
      requiresAttribution: false,
      author,
      sourceLabel,
    }),
    thumbnailUrl: str(src.medium) || str(src.small) || str(src.large),
    previewUrl: str(src.large) || str(src.large2x) || str(src.medium),
    variants,
    width: Number(p?.width) || undefined,
    height: Number(p?.height) || undefined,
  }
}

function pixabayAdapter() {
  const license = {
    name: 'Pixabay Content License',
    url: 'https://pixabay.com/service/license-summary/',
    requiresAttribution: false,
  }
  return {
    id: 'pixabay',
    label: 'Pixabay',
    mediaTypes: ['image', 'video'],
    requiresKey: true,
    defaultBaseUrl: STOCK_PROVIDER_DEFAULTS.pixabay.baseUrl,
    async search({ query, mediaType, page, perPage, apiKey, baseUrl, fetchImpl }) {
      const params = new URLSearchParams({
        key: String(apiKey || ''),
        q: query,
        lang: 'zh',
        page: String(page),
        per_page: String(perPage),
        safesearch: 'true',
      })
      const endpoint =
        mediaType === 'video' ? joinUrl(baseUrl, `/api/videos/?${params}`) : joinUrl(baseUrl, `/api/?${params}`)
      const j = await requestJson(endpoint, { fetchImpl, provider: 'Pixabay' })
      const list = Array.isArray(j?.hits) ? j.hits : []
      const items = list.map((h) =>
        mediaType === 'video' ? normalizePixabayVideo(h, license) : normalizePixabayImage(h, license),
      )
      const total = Number(j?.totalHits ?? j?.total) || undefined
      return {
        items,
        total,
        hasMore: Boolean(total && page * perPage < total),
      }
    },
  }
}

function normalizePixabayImage(h, license) {
  const author = str(h?.user)
  const variants = [
    ['largeImageURL', Number(h?.imageWidth) || undefined, Number(h?.imageHeight) || undefined],
    ['webformatURL', Number(h?.webformatWidth) || undefined, Number(h?.webformatHeight) || undefined],
    ['previewURL', Number(h?.previewWidth) || undefined, Number(h?.previewHeight) || undefined],
  ]
    .filter(([k]) => str(h?.[k]))
    .map(([k, width, height]) => ({ url: String(h[k]), mime: 'image/jpeg', width, height }))
  return {
    provider: 'pixabay',
    itemId: String(h?.id ?? ''),
    mediaType: 'image',
    title: str(h?.tags) || `Pixabay 图片 ${h?.id ?? ''}`,
    author,
    authorUrl: h?.user_id ? `https://pixabay.com/users/${encodeURIComponent(author)}-${h.user_id}/` : '',
    sourceUrl: str(h?.pageURL),
    license: makeLicense({ ...license, author, sourceLabel: 'Pixabay' }),
    thumbnailUrl: str(h?.previewURL) || str(h?.webformatURL),
    previewUrl: str(h?.webformatURL) || str(h?.largeImageURL) || str(h?.previewURL),
    variants,
    width: Number(h?.imageWidth) || undefined,
    height: Number(h?.imageHeight) || undefined,
  }
}

function normalizePixabayVideo(h, license) {
  const author = str(h?.user)
  const sizes = h?.videos && typeof h.videos === 'object' ? h.videos : {}
  const order = ['large', 'medium', 'small', 'tiny']
  const variants = order
    .map((k) => sizes[k])
    .filter((v) => v && str(v.url))
    .map((v) => ({
      url: String(v.url),
      mime: 'video/mp4',
      width: Number(v.width) || undefined,
      height: Number(v.height) || undefined,
      duration: Number(h?.duration) || undefined,
      bytes: Number(v.size) || undefined,
    }))
  const thumb = order.map((k) => sizes[k]?.thumbnail).find((x) => str(x)) || ''
  return {
    provider: 'pixabay',
    itemId: String(h?.id ?? ''),
    mediaType: 'video',
    title: str(h?.tags) || `Pixabay 视频 ${h?.id ?? ''}`,
    author,
    authorUrl: h?.user_id ? `https://pixabay.com/users/${encodeURIComponent(author)}-${h.user_id}/` : '',
    sourceUrl: str(h?.pageURL),
    license: makeLicense({ ...license, author, sourceLabel: 'Pixabay' }),
    thumbnailUrl: str(thumb),
    previewUrl: str(thumb),
    variants,
    width: Number(sizes.large?.width) || undefined,
    height: Number(sizes.large?.height) || undefined,
    duration: Number(h?.duration) || undefined,
  }
}

function openverseLicense(h, mediaType) {
  const code = str(h?.license).toLowerCase()
  const version = str(h?.license_version)
  // Openverse 用 by / by-sa / cc0 / pdm 这类代码；展示名按 CC 的通行写法拼
  const name =
    code === 'cc0'
      ? `CC0${version ? ` ${version}` : ''}`
      : code === 'pdm'
        ? `Public Domain Mark${version ? ` ${version}` : ''}`
        : code
          ? `CC ${code.toUpperCase()}${version ? ` ${version}` : ''}`
          : 'CC0'
  // CC0 / PDM 不要求署名；其余 CC 许可都要求
  const requiresAttribution = !(code === 'cc0' || code === 'pdm' || code === '')
  const sourceLabel = mediaType === 'audio' ? 'Openverse 音频' : 'Openverse 图片'
  return { name, url: str(h?.license_url), requiresAttribution, sourceLabel }
}

function openverseAdapter() {
  return {
    id: 'openverse',
    label: 'Openverse',
    mediaTypes: ['image', 'audio'],
    requiresKey: false,
    defaultBaseUrl: STOCK_PROVIDER_DEFAULTS.openverse.baseUrl,
    async search({ query, mediaType, page, perPage, apiKey, baseUrl, fetchImpl }) {
      const params = new URLSearchParams({
        q: query,
        page: String(page),
        page_size: String(perPage),
      })
      const endpoint =
        mediaType === 'audio' ? joinUrl(baseUrl, `/v1/audio/?${params}`) : joinUrl(baseUrl, `/v1/images/?${params}`)
      const j = await requestJson(endpoint, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        fetchImpl,
        provider: 'Openverse',
      })
      const list = Array.isArray(j?.results) ? j.results : []
      return {
        items: list.map((h) => normalizeOpenverse(h, mediaType)),
        total: Number(j?.result_count) || undefined,
        hasMore: Boolean(Number(j?.page_count) && page < Number(j.page_count)),
      }
    },
  }
}

function openverseFiles(h, mediaType) {
  const primary = Array.isArray(h?.files) ? h.files : []
  const alt = Array.isArray(h?.alt_files) ? h.alt_files : []
  const all = [...primary, ...alt].filter((f) => str(f?.url))
  if (!all.length && str(h?.url)) {
    return [{ url: String(h.url), mime: mediaType === 'audio' ? 'audio/mpeg' : 'image/jpeg' }]
  }
  return all.map((f) => ({
    url: String(f.url),
    mime: str(f.filetype) ? String(f.filetype) : mediaType === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    width: Number(f.width) || undefined,
    height: Number(f.height) || undefined,
    bytes: Number(f.filesize) || undefined,
    duration: Number(f.duration) || undefined,
  }))
}

function normalizeOpenverse(h, mediaType) {
  const author = str(h?.creator)
  const license = openverseLicense(h, mediaType)
  const files = openverseFiles(h, mediaType)
  const isAudio = mediaType === 'audio'
  const durationMs = Number(h?.duration)
  const duration = isAudio && Number.isFinite(durationMs) ? durationMs / 1000 : undefined
  return {
    provider: 'openverse',
    itemId: String(h?.id ?? ''),
    mediaType: isAudio ? 'audio' : 'image',
    title: str(h?.title) || `${isAudio ? 'Openverse 音频' : 'Openverse 图片'} ${h?.id ?? ''}`,
    author,
    authorUrl: str(h?.creator_url),
    sourceUrl: str(h?.foreign_landing_url),
    license: makeLicense({ ...license, author, sourceLabel: license.sourceLabel }),
    thumbnailUrl: str(h?.thumbnail),
    previewUrl: str(h?.thumbnail) || files[0]?.url || '',
    variants: files,
    width: Number(h?.width) || undefined,
    height: Number(h?.height) || undefined,
    ...(duration ? { duration } : {}),
  }
}

const ADAPTERS = {
  pexels: pexelsAdapter(),
  pixabay: pixabayAdapter(),
  openverse: openverseAdapter(),
}

/** 注册表顺序与设置层一致 */
export function listAdapters() {
  return STOCK_PROVIDER_IDS.map((id) => ADAPTERS[id])
}

export function getAdapter(id) {
  return ADAPTERS[String(id || '')] || null
}

/** 来源可用性：未启用 / 缺 Key / 可用；与设置页共用同一套原因文案 */
export function describeProviders(settings, env = process.env) {
  const { settings: applied, fromEnv } = applyStockEnvDefaults(settings, env)
  return listAdapters().map((a) => {
    const p = applied.providers[a.id] || { enabled: false, apiKey: '', baseUrl: a.defaultBaseUrl }
    const base = {
      id: a.id,
      label: a.label,
      mediaTypes: a.mediaTypes,
      requiresKey: a.requiresKey,
      ...(fromEnv[a.id] ? { keyFromEnv: true } : {}),
    }
    if (!p.enabled) return { ...base, ok: false, reason: '未启用：在设置页的「素材库」里开启' }
    if (a.requiresKey && !p.apiKey) return { ...base, ok: false, reason: '未配置 Key' }
    return { ...base, ok: true }
  })
}

export function providerAvailability(settings, id, env = process.env) {
  return describeProviders(settings, env).find((p) => p.id === id) || null
}

// ---------------------------------------------------------------- 缓存与令牌

const searchCache = new Map()
const tokenStore = new Map()

export function resetStockState() {
  searchCache.clear()
  tokenStore.clear()
}

function cacheKey({ provider, mediaType, query, page, perPage, orientation }) {
  return [provider, mediaType, str(query).toLowerCase(), page, perPage, orientation || ''].join('|')
}

function readCache(key, now) {
  const hit = searchCache.get(key)
  if (!hit) return null
  if (now - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key)
    return null
  }
  // LRU：命中后移到末尾，淘汰最旧
  searchCache.delete(key)
  searchCache.set(key, hit)
  return hit
}

function writeCache(key, payload, now) {
  searchCache.set(key, { at: now, payload })
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value
    searchCache.delete(oldest)
  }
}

function issueToken(item, now) {
  const token = `stk_${crypto.randomBytes(12).toString('hex')}`
  tokenStore.set(token, { item, at: now })
  while (tokenStore.size > TOKEN_MAX) {
    const oldest = tokenStore.keys().next().value
    tokenStore.delete(oldest)
  }
  return token
}

export function readToken(token, now = Date.now()) {
  const entry = tokenStore.get(String(token || ''))
  if (!entry) return null
  if (now - entry.at > TOKEN_TTL_MS) {
    tokenStore.delete(String(token))
    return null
  }
  return entry
}

// ---------------------------------------------------------------- 检索

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, Math.round(v)))
}

/**
 * 检索一个来源。参数非法直接抛 bad-request（路由层不会为此请求来源），
 * 缓存命中不再请求来源并标记 cached。
 */
export async function searchStock(input = {}) {
  const { settings, env = process.env, fetchImpl = fetch, now = Date.now() } = input
  const providerId = str(input.provider)
  const adapter = getAdapter(providerId)
  if (!adapter) throw new StockError(`未知来源：${providerId || '空'}`, { kind: 'bad-request' })
  const mediaType = str(input.mediaType) || adapter.mediaTypes[0]
  if (!adapter.mediaTypes.includes(mediaType)) {
    throw new StockError(`${adapter.label} 不支持 ${mediaType}`, { kind: 'bad-request' })
  }
  const query = str(input.query)
  if (query.length < 2) throw new StockError('关键词至少 2 个字符', { kind: 'bad-request' })
  const page = clamp(input.page, 1, 100, 1)
  const perPage = clamp(input.perPage, 1, 50, 24)
  const orientation = str(input.orientation)

  const availability = providerAvailability(settings, providerId, env)
  if (!availability?.ok) {
    throw new StockError(availability?.reason || '来源不可用', {
      kind: availability?.reason?.includes('Key') ? 'auth' : 'bad-request',
      provider: providerId,
    })
  }

  const key = cacheKey({ provider: providerId, mediaType, query, page, perPage, orientation })
  const cached = readCache(key, now)
  if (cached) {
    return { ...cached.payload, cached: true }
  }

  const { settings: applied } = applyStockEnvDefaults(settings, env)
  const cfg = applied.providers[providerId] || {}
  const result = await adapter.search({
    query,
    mediaType,
    page,
    perPage,
    orientation,
    apiKey: cfg.apiKey || '',
    baseUrl: cfg.baseUrl || adapter.defaultBaseUrl,
    fetchImpl,
  })
  const items = (result.items || [])
    .filter((item) => item && item.itemId && item.variants?.length)
    .map((item) => ({ ...item, token: issueToken(item, now) }))
  const payload = {
    provider: providerId,
    mediaType,
    query,
    page,
    perPage,
    ...(result.total ? { total: result.total } : {}),
    hasMore: Boolean(result.hasMore) || Boolean(result.total && page * perPage < result.total),
    cached: false,
    items,
  }
  writeCache(key, payload, now)
  return payload
}

// ---------------------------------------------------------------- 导入

function extFromUrl(url) {
  try {
    const m = String(new URL(url).pathname).match(URL_EXT)
    return m ? m[1].toLowerCase() : ''
  } catch {
    const m = String(url || '').match(URL_EXT)
    return m ? m[1].toLowerCase() : ''
  }
}

function mimeFor(mediaType, contentType, url) {
  const clean = String(contentType || '').split(';')[0].trim().toLowerCase()
  const allowed = CONTENT_TYPES[mediaType] || []
  const byType = allowed.find(([mime]) => mime === clean)
  if (byType) return { ext: byType[1] }
  // 只有来源没给类型、或给的是通用二进制时，才退回 URL 扩展名；
  // 明确声明了别的类型（例如 text/html）必须拒绝，不能按扩展名放行。
  if (!clean || clean === 'application/octet-stream') {
    const urlExt = extFromUrl(url)
    if (EXT_BY_EXT[urlExt] === mediaType) return { ext: urlExt }
  }
  throw new StockError(
    `下载内容不是${mediaType === 'image' ? '图片' : mediaType === 'video' ? '视频' : '音频'}（${clean || '未知类型'}）`,
    { kind: 'unsupported-type' },
  )
}

/** 按媒体类型挑下载变体：图片取最大、视频取 ≤1080p 的最高清、音频取体积最大的 */
export function pickVariant(item) {
  const variants = Array.isArray(item?.variants) ? item.variants.filter((v) => str(v?.url)) : []
  if (!variants.length) return null
  const area = (v) => (Number(v.width) || 0) * (Number(v.height) || 0)
  if (item.mediaType === 'video') {
    const capped = variants.filter((v) => !v.height || v.height <= 1080)
    const pool = capped.length ? capped : variants
    return pool.slice().sort((a, b) => area(b) - area(a))[0]
  }
  if (item.mediaType === 'audio') {
    return variants.slice().sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0))[0]
  }
  return variants.slice().sort((a, b) => area(b) - area(a))[0]
}

function safeFilePart(v) {
  return String(v || '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80) || 'item'
}

/**
 * 把令牌对应的条目下载进当前项目。
 *
 * 只接受令牌；下载地址来自服务端保存的检索结果，下载前仍做公网校验并复核重定向后的最终地址。
 * 同项目同来源同条目已存在且文件还在时直接复用，不重复下载。
 */
export async function importStockItem(input = {}) {
  const {
    token,
    project,
    root,
    settings,
    env = process.env,
    fetchImpl = fetch,
    assertPublic = assertPublicUrl,
    now = Date.now(),
  } = input
  if (!str(project)) throw new StockError('先选择项目再导入', { kind: 'bad-request' })
  const entry = readToken(token, now)
  if (!entry) throw new StockError('检索结果已过期，请重新检索', { kind: 'expired' })

  const item = entry.item
  const providerId = item.provider
  const availability = providerAvailability(settings, providerId, env)
  if (!availability?.ok) {
    throw new StockError(availability?.reason || '来源不可用', { kind: 'auth', provider: providerId })
  }

  const existing = getStockImportByItem(root, project, providerId, item.itemId)
  if (existing?.url) {
    const parsed = String(existing.url).startsWith('/project-assets/')
      ? String(existing.url).split('/').filter(Boolean)
      : []
    if (parsed.length === 3 && projectMediaExists(root, decodeURIComponent(parsed[1]), decodeURIComponent(parsed[2]))) {
      return { url: existing.url, provider: providerId, itemId: item.itemId, mediaType: item.mediaType, reused: true, meta: existing }
    }
  }

  const variant = pickVariant(item)
  if (!variant) throw new StockError('这个条目没有可下载的文件', { kind: 'provider', provider: providerId })

  let target
  try {
    target = await assertPublic(variant.url)
  } catch (e) {
    throw new StockError(`下载地址不被允许：${e?.message || e}`, { kind: 'bad-request', provider: providerId })
  }

  let r
  try {
    r = await fetchImpl(target, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' })
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    throw new StockError(`${providerId}：下载${timeout ? '超时' : '失败'}（${e?.message || e}）`, {
      kind: timeout ? 'network' : 'network',
      provider: providerId,
    })
  }
  if (!r.ok) throw errorFromResponse(await r.text().catch(() => ''), r.status, providerId)

  // 重定向后的最终地址同样必须是公网，避免来源把请求引到内网
  const finalUrl = str(r.url)
  if (finalUrl && finalUrl !== String(target)) {
    try {
      await assertPublic(finalUrl)
    } catch (e) {
      throw new StockError(`下载被重定向到不允许的地址：${e?.message || e}`, {
        kind: 'bad-request',
        provider: providerId,
      })
    }
  }

  const limit = MEDIA_LIMITS[item.mediaType] || MEDIA_LIMITS.image
  const declared = Number(r.headers?.get?.('content-length') || 0)
  if (declared && declared > limit) {
    throw new StockError(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限`, { kind: 'too-large' })
  }
  const { ext } = mimeFor(item.mediaType, r.headers?.get?.('content-type'), variant.url)
  const file = `stock-${safeFilePart(providerId)}-${safeFilePart(item.itemId)}.${ext}`

  let saved
  if (r.body && typeof r.body.getReader === 'function') {
    try {
      saved = await saveProjectMediaStream(root, project, r.body, { ext, prefix: 'stock', file, maxBytes: limit })
    } catch (e) {
      if (/大小上限/.test(e?.message || '')) {
        throw new StockError(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 上限`, { kind: 'too-large' })
      }
      throw e
    }
  } else {
    const bytes = Buffer.from(await r.arrayBuffer())
    if (bytes.length > limit) throw new StockError('文件超过大小上限', { kind: 'too-large' })
    if (!bytes.length) throw new StockError('下载内容为空', { kind: 'provider' })
    saved = { ...saveProjectMedia(root, project, bytes, { ext, prefix: 'stock', file }), bytes: bytes.length }
  }

  const meta = upsertStockImport(root, project, {
    provider: providerId,
    itemId: item.itemId,
    url: saved.url,
    mediaType: item.mediaType,
    title: item.title,
    author: item.author,
    authorUrl: item.authorUrl,
    sourceUrl: item.sourceUrl,
    license: item.license?.name,
    licenseUrl: item.license?.url,
    attribution: item.license?.attribution,
    width: variant.width ?? item.width,
    height: variant.height ?? item.height,
    duration: variant.duration ?? item.duration,
    bytes: saved.bytes,
  })
  return { url: saved.url, provider: providerId, itemId: item.itemId, mediaType: item.mediaType, reused: false, meta }
}

/** 素材卡详情用：按站内地址查来源记录 */
export function stockMetaForUrl(root, project, url) {
  return findStockImportByUrl(root, project, url) || null
}
