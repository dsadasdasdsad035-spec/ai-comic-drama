/**
 * SkillHub Open API 客户端（服务端代理；Key 不进入浏览器）。
 */
const DEFAULT_BASE = 'https://api.skillhub.cn'
const SITE_URL = 'https://skillhub.cn'
const TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const JSON_LIMIT = 4 << 20
const ZIP_LIMIT = 65 * 1024 * 1024

function baseUrl() {
  const u = String(process.env.SKILLHUB_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, '')
  return u || DEFAULT_BASE
}

function apiKey() {
  return String(process.env.SKILLHUB_API_KEY || '').trim()
}

function clientUserId() {
  const raw = String(process.env.SKILLHUB_CLIENT_USER || process.env.USER || 'storyboard').trim()
  return raw.slice(0, 64)
}

async function hubGet(path, query, timeout, limit) {
  const url = new URL(path.startsWith('http') ? path : baseUrl() + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v))
    }
  }
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeout)
  try {
    const headers = { Accept: 'application/json, */*' }
    const key = apiKey()
    if (key) headers['X-API-Key'] = key
    const user = clientUserId()
    if (user) headers['X-Client-User-Id'] = user
    const res = await fetch(url, { method: 'GET', headers, signal: ac.signal })
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > limit) throw new Error('SkillHub 返回内容超过平台限额')
    if (!res.ok) {
      let msg = `SkillHub 请求失败（HTTP ${res.status}）`
      try {
        const j = JSON.parse(buf.toString('utf8'))
        if (j?.message || j?.error) msg += `：${j.message || j.error}`
      } catch {
        /* ignore */
      }
      const err = new Error(msg)
      err.status = res.status
      throw err
    }
    return buf
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('SkillHub 响应超时，请稍后重试')
    throw e
  } finally {
    clearTimeout(t)
  }
}

async function hubJson(path, query) {
  const buf = await hubGet(path, query, TIMEOUT_MS, JSON_LIMIT)
  return JSON.parse(buf.toString('utf8'))
}

export function skillhubHomepage(namespace, slug) {
  if (namespace) return `${SITE_URL}/skills/${encodeURIComponent(namespace)}/${encodeURIComponent(slug)}`
  return `${SITE_URL}/skills/${encodeURIComponent(slug)}`
}

export async function skillhubList({ keyword = '', category = '', sortBy = 'downloads', page = 1, pageSize = 24 } = {}) {
  const q = { page: String(page), pageSize: String(Math.min(50, Math.max(1, pageSize))), sortBy, order: 'desc' }
  if (keyword) q.keyword = String(keyword).slice(0, 100)
  if (category) q.category = category
  const remote = await hubJson('/api/skills', q)
  if (remote?.code != null && remote.code !== 0) {
    throw new Error(remote?.message || 'SkillHub 列表接口返回错误')
  }
  const data = remote?.data || remote
  const skills = (data?.skills || []).map((s) => ({
    slug: s.slug,
    namespace: s.namespace?.handle || s.namespace || '',
    name: s.name || s.slug,
    description: (s.description_zh || s.description || '').trim(),
    category: s.category || '',
    version: s.version || '',
    iconUrl: s.iconUrl || '',
    downloads: s.downloads ?? 0,
    stars: s.stars ?? 0,
    verified: Boolean(s.verified),
    updatedAt: s.updated_at ?? s.updatedAt ?? 0,
    homepage: skillhubHomepage(s.namespace?.handle || '', s.slug),
  }))
  return { total: data?.total ?? skills.length, page, pageSize, items: skills }
}

export async function skillhubCategories() {
  try {
    const remote = await hubJson('/api/v1/categories', null)
    const items = (remote?.items || [])
      .filter((c) => c?.active !== false && c?.key)
      .map((c) => ({ key: c.key, name: (c.name || c.key).trim() }))
    return items
  } catch {
    return []
  }
}

export async function skillhubDetail(slug, namespace = '') {
  const q = {}
  if (namespace) q.namespace = namespace
  const d = await hubJson(`/api/v1/skills/${encodeURIComponent(slug)}`, q)
  const ns = (d.namespace?.handle || namespace || d.owner?.handle || '').trim()
  const skill = d.skill || {}
  const latest = d.latestVersion || null
  return {
    slug: skill.slug || slug,
    namespace: ns,
    name: (skill.displayName || skill.slug || slug).trim(),
    summary: (skill.summary_zh || skill.summary || '').trim(),
    category: skill.category || '',
    iconUrl: skill.iconUrl || '',
    downloads: skill.stats?.downloads ?? 0,
    stars: skill.stats?.stars ?? 0,
    homepage: skillhubHomepage(ns, skill.slug || slug),
    latestVersion: latest?.version || '',
    changelog: latest?.changelog || '',
  }
}

export async function skillhubDownloadZip(slug, namespace = '', version = '') {
  const q = { slug }
  if (namespace) q.namespace = namespace
  if (version) q.version = version
  return hubGet('/api/v1/download', q, DOWNLOAD_TIMEOUT_MS, ZIP_LIMIT)
}
