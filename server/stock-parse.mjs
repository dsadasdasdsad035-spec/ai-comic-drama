/**
 * 页面解析型来源的纯函数工具：Mixkit 的检索页 / 详情页解析，以及外链型来源的跳转地址。
 *
 * 单独拆出来是为了两件事：
 * 1. 解析规则可以脱离网络与 vite 单测（tests/stock.ts 直接 import）；
 * 2. 站点改版时只需要改这一个文件。
 *
 * Mixkit 的检索入口是路径式 slug（`/free-stock-video/<slug>/?page=N`），
 * 不是 `?q=`：带 `?q=` 的 `/search/` 页会原样返回首页默认推荐，看着像有结果、
 * 实际和关键词无关，所以绝不能走那个入口。
 */

/** 中英混合关键词转 slug：只留 ASCII，其余按分隔符处理 */
export function toSlug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** VJShi 站内搜索地址：内容需付费购买，只能给外链 */
export function vjshiSearchUrl(query, baseUrl = 'https://www.vjshi.com') {
  const q = String(query || '').trim()
  const base = String(baseUrl || 'https://www.vjshi.com').replace(/\/+$/, '')
  if (!q) return `${base}/so`
  return `${base}/so?wd=${encodeURIComponent(q)}`
}

/** 外链模板：前端把 {query} 替换成编码后的关键词，保持占位符原文不编码 */
export function vjshiSearchTemplate(baseUrl = 'https://www.vjshi.com') {
  const base = String(baseUrl || 'https://www.vjshi.com').replace(/\/+$/, '')
  return `${base}/so?wd={query}`
}

function firstMatch(text, re) {
  const m = String(text || '').match(re)
  return m ? m[1] : ''
}

function decodeEntities(v) {
  return String(v || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 解析 Mixkit 检索页的条目网格。
 *
 * 每个条目以 `data-item-grid--video-player-item-id-value="<id>"` 起始，
 * 该标记天然把整页切成一段段卡片标记，不需要 DOM 解析器。
 */
export function parseMixkitSearch(html) {
  const text = String(html || '')
  const parts = text.split('data-item-grid--video-player-item-id-value="')
  const seen = new Set()
  const items = []
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i]
    const id = firstMatch(chunk, /^(\d+)/)
    if (!id || seen.has(id)) continue
    const previewUrl = decodeEntities(
      firstMatch(chunk, /<video[^>]+src="([^"]+)"/) ||
        firstMatch(chunk, /(https:\/\/assets\.mixkit\.co\/videos\/\d+\/\d+-\d+\.mp4)/),
    )
    if (!previewUrl) continue
    const detailPath = decodeEntities(firstMatch(chunk, /href="(\/free-stock-video\/[^"?#]*)"/))
    const title = decodeEntities(
      firstMatch(chunk, /item-grid-video-player__overlay-link">\s*([^<]+)/) ||
        firstMatch(chunk, /<img[^>]+alt="([^"]*)"/),
    )
    const thumbnailUrl = decodeEntities(firstMatch(chunk, /<img[^>]+src="([^"]+)"/))
    const height = Number(firstMatch(previewUrl, /-(\d+)\.mp4/)) || 0
    seen.add(id)
    items.push({
      id,
      title: title || `Mixkit 视频 ${id}`,
      detailPath,
      thumbnailUrl,
      previewUrl,
      height,
      has4k: /item-grid-video-player--4k/.test(chunk),
    })
  }
  return items
}

/** 解析 Mixkit 检索页的分页上限；站点最多翻 3 页，避免深翻触发风控 */
export function parseMixkitMaxPage(html, cap = 3) {
  const text = String(html || '')
  let max = 1
  for (const m of text.matchAll(/href="[^"]*\?page=(\d+)"/g)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = n
  }
  return Math.min(cap, max)
}

/**
 * 判断检索页形态：`grid` = 有条目网格，`empty` = 正常的无结果页，`unknown` = 结构变了。
 *
 * 0 条目必须区分这两种情况：站点改版时页面仍然是 200，如果一律当空结果，
 * 用户会以为「这个关键词真的没有素材」。
 */
export function mixkitPageShape(html) {
  const text = String(html || '')
  if (/data-item-grid--masonry-layout-target="masonryWrapper"/.test(text)) return 'grid'
  if (/No results|no results|没有结果/i.test(text)) return 'empty'
  return 'unknown'
}

/** ISO 8601 时长转秒：PT0M23S → 23，PT1M2S → 62 */
export function parseIsoDuration(value) {
  const m = String(value || '').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i)
  if (!m) return undefined
  const [, d, h, mi, s] = m
  const total =
    (Number(d) || 0) * 86400 + (Number(h) || 0) * 3600 + (Number(mi) || 0) * 60 + (Number(s) || 0)
  return Number.isFinite(total) && total > 0 ? total : undefined
}

function findVideoObject(node, depth = 0) {
  if (!node || depth > 8) return null
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findVideoObject(v, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null
  if (node['@type'] === 'VideoObject' || (node.contentUrl && node['@type'] === 'MediaObject')) return node
  for (const v of Object.values(node)) {
    const hit = findVideoObject(v, depth + 1)
    if (hit) return hit
  }
  return null
}

/**
 * 解析 Mixkit 详情页：拿到 720p 直链、真实时长与许可。
 *
 * JSON-LD 只有一份 VideoObject，里面 contentUrl 就是无水印 720p；
 * 列表页给的是 360p 预览，所以导入前必须补这一步。
 */
export function parseMixkitDetail(html) {
  const text = String(html || '')
  for (const m of text.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let json
    try {
      json = JSON.parse(m[1].trim())
    } catch {
      continue
    }
    const video = findVideoObject(json)
    if (!video) continue
    const description = String(video.description || '')
    const author = firstMatch(description, /created by\s+(.+?)\s+that you can use/i)
    return {
      contentUrl: decodeEntities(video.contentUrl),
      thumbnailUrl: decodeEntities(video.thumbnailUrl),
      title: decodeEntities(video.name),
      duration: parseIsoDuration(video.duration),
      license: decodeEntities(video.copyrightNotice || 'Mixkit License'),
      licenseUrl: decodeEntities(video.license),
      author: decodeEntities(author),
    }
  }
  // JSON-LD 缺失时退回正则：只要拿到直链就不至于整条失败
  const fallback = firstMatch(text, /https:\/\/assets\.mixkit\.co\/videos\/\d+\/\d+-\d+\.mp4/)
  if (!fallback) return null
  return {
    contentUrl: fallback,
    thumbnailUrl: '',
    title: '',
    duration: undefined,
    license: 'Mixkit License',
    licenseUrl: 'https://mixkit.co/license/',
    author: '',
  }
}
