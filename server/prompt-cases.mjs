/**
 * 提示词案例库：全局作用域，不挂项目。
 *
 * 三种来源（外部导入 `vflow` / 手工 `manual` / 自有片反推 `reverse-own`）共用一张
 * 表：浏览、搜索、收藏、应用、删除的行为完全相同。差异只有两处：
 * - `shots` 只有反推案例有逐镜结构；
 * - `license` 由 source 推导，客户端传什么都不作数。
 *
 * 为什么 license 必须服务端推导：外部案例是别人的提示词与视频，把它标成自有
 * 就可能被当作本项目产物拿去发布。这条是数据层的硬约束，不是界面提示。
 */
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dbPath } from './db.mjs'

/** 来源类别；`license` 与来源的对应关系见 LICENSE_BY_SOURCE */
export const CASE_SOURCES = ['vflow', 'manual', 'reverse-own']

/**
 * 来源 → 许可口径。外部来源一律只能作为参考；只有自有片反推才算自有。
 * 未登记的来源也按 reference-only 处理（默认拒绝）。
 */
export const LICENSE_BY_SOURCE = {
  vflow: 'reference-only',
  manual: 'reference-only',
  'reverse-own': 'own',
}

export const CASE_LICENSE_VALUES = ['own', 'reference-only']

/** 列表分页上限：与素材页其他列表保持同一量级 */
export const PROMPT_CASE_PAGE_SIZE = 24
export const PROMPT_CASE_MAX_PAGE_SIZE = 96

let conn = null
let connFile = ''

function open(root) {
  const file = dbPath(root)
  if (conn && connFile === file) return conn
  conn = new DatabaseSync(file)
  conn.exec('PRAGMA journal_mode = WAL;')
  connFile = file
  return conn
}

function nowIso() {
  return new Date().toISOString()
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw ?? '')
    return v ?? fallback
  } catch {
    return fallback
  }
}

export function normalizeCaseSource(raw) {
  const v = String(raw || '').trim()
  return CASE_SOURCES.includes(v) ? v : ''
}

/** 许可口径只按来源推导；未知来源回落 reference-only */
export function licenseForSource(source) {
  const s = normalizeCaseSource(source)
  return LICENSE_BY_SOURCE[s] || 'reference-only'
}

export function normalizeCaseTags(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out = []
  for (const item of list) {
    const v = String(item ?? '').trim()
    if (v && !out.includes(v)) out.push(v.slice(0, 40))
  }
  return out.slice(0, 24)
}

function rowToCase(row) {
  if (!row) return null
  const shots = parseJson(row.shots, [])
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id || '',
    title: row.title || '',
    prompt: row.prompt || '',
    shots: Array.isArray(shots) ? shots : [],
    model: row.model || '',
    category: row.category || '',
    tags: parseJson(row.tags, []),
    videoUrl: row.video_url || '',
    posterUrl: row.poster_url || '',
    author: row.author || '',
    sourceUrl: row.source_url || '',
    license: row.license || 'reference-only',
    note: row.note || '',
    favorite: Boolean(row.favorite),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

/**
 * 案例 id：带来源前缀的稳定串。
 *
 * 前缀让日志与排障一眼看出这条是怎么进来的，也让「手工录入」这类没有远端 id
 * 的记录有确定的命名方式（`manual:<uuid>` 只在首次生成）。
 */
export function promptCaseId(source, sourceId) {
  const s = normalizeCaseSource(source)
  const key = String(sourceId || '').trim()
  if (!s) throw new Error(`未知案例来源：${source || '(空)'}`)
  if (!key) throw new Error('案例来源标识不能为空')
  return `${s}:${key}`
}

export function newManualCaseId() {
  return `manual:${crypto.randomBytes(8).toString('hex')}`
}

/**
 * 保存（UPSERT）一条案例。
 *
 * `(source, source_id)` 命中时只更新内容字段，`favorite` 与 `note` 保持原值：
 * 用户对一条案例的收藏与批注不该因为重新导入同一来源而被抹掉。
 */
export function saveCase(appRoot, input = {}) {
  const source = normalizeCaseSource(input.source)
  if (!source) throw new Error(`未知案例来源：${input.source || '(空)'}`)
  const rawSourceId = String(input.sourceId || '').trim()
  const sourceId = rawSourceId || (source === 'manual' ? crypto.randomBytes(8).toString('hex') : '')
  if (!sourceId) throw new Error('案例来源标识不能为空')

  const d = open(appRoot)
  const id = String(input.id || promptCaseId(source, sourceId))
  const at = nowIso()
  const shots = Array.isArray(input.shots) ? input.shots : []
  const tags = normalizeCaseTags(input.tags)
  // 许可口径由来源决定，input.license 一律不采信
  const license = licenseForSource(source)

  d.prepare(
    `INSERT INTO prompt_cases
       (id,source,source_id,title,prompt,shots,model,category,tags,video_url,poster_url,
        author,source_url,license,note,favorite,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source, source_id) DO UPDATE SET
       title=excluded.title,
       prompt=excluded.prompt,
       shots=excluded.shots,
       model=excluded.model,
       category=excluded.category,
       tags=excluded.tags,
       video_url=excluded.video_url,
       poster_url=excluded.poster_url,
       author=excluded.author,
       source_url=excluded.source_url,
       license=excluded.license,
       updated_at=excluded.updated_at`,
  ).run(
    id,
    source,
    sourceId,
    String(input.title || '').slice(0, 300),
    String(input.prompt || ''),
    JSON.stringify(shots),
    String(input.model || '').slice(0, 120),
    String(input.category || '').slice(0, 120),
    JSON.stringify(tags),
    String(input.videoUrl || '').slice(0, 2000),
    String(input.posterUrl || '').slice(0, 2000),
    String(input.author || '').slice(0, 200),
    String(input.sourceUrl || '').slice(0, 2000),
    license,
    String(input.note || '').slice(0, 4000),
    input.favorite ? 1 : 0,
    input.createdAt ? String(input.createdAt) : at,
    at,
  )
  return getCase(appRoot, id)
}

/** 批量保存：返回新增与更新数量。一条失败不影响其余。 */
export function saveCases(appRoot, list = []) {
  const out = { created: 0, updated: 0, failed: [] }
  for (const item of Array.isArray(list) ? list : []) {
    const source = normalizeCaseSource(item?.source)
    const sourceId = String(item?.sourceId || '').trim()
    try {
      if (!source || !sourceId) throw new Error('来源或来源标识缺失')
      const existed = Boolean(
        open(appRoot)
          .prepare('SELECT id FROM prompt_cases WHERE source=? AND source_id=?')
          .get(source, sourceId),
      )
      saveCase(appRoot, item)
      if (existed) out.updated += 1
      else out.created += 1
    } catch (e) {
      out.failed.push({ sourceId: sourceId || '', message: e?.message || String(e) })
    }
  }
  return out
}

export function getCase(appRoot, id) {
  const d = open(appRoot)
  return rowToCase(d.prepare('SELECT * FROM prompt_cases WHERE id=?').get(String(id)))
}

export function findCaseBySource(appRoot, source, sourceId) {
  const d = open(appRoot)
  return rowToCase(
    d.prepare('SELECT * FROM prompt_cases WHERE source=? AND source_id=?').get(String(source), String(sourceId)),
  )
}

/** 关键词拆词：各词之间取交集，避免长句搜不到 */
function queryTerms(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
}

/**
 * 列表查询。
 *
 * 筛选维度：关键词（标题 + 提示词正文 + 标签）、来源、模型、收藏、分类。
 * 排序默认按创建时间倒序；`sort=title` 按标题升序，便于按写法找。
 */
export function listCases(appRoot, options = {}) {
  const d = open(appRoot)
  const where = []
  const params = []

  const terms = queryTerms(options.q)
  for (const term of terms) {
    where.push('(lower(title) LIKE ? OR lower(prompt) LIKE ? OR lower(tags) LIKE ?)')
    const like = `%${term}%`
    params.push(like, like, like)
  }

  const source = normalizeCaseSource(options.source)
  if (source) {
    where.push('source=?')
    params.push(source)
  }
  if (options.model) {
    where.push('model=?')
    params.push(String(options.model))
  }
  if (options.category) {
    where.push('category=?')
    params.push(String(options.category))
  }
  if (options.favorite) where.push('favorite=1')

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = Number(d.prepare(`SELECT COUNT(*) c FROM prompt_cases ${clause}`).get(...params)?.c) || 0

  const sizeRaw = Number(options.pageSize) || PROMPT_CASE_PAGE_SIZE
  const pageSize = Math.max(1, Math.min(PROMPT_CASE_MAX_PAGE_SIZE, Math.floor(sizeRaw)))
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.max(1, Math.min(totalPages, Math.floor(Number(options.page) || 1)))
  const offset = (page - 1) * pageSize

  const order = options.sort === 'title' ? 'title COLLATE NOCASE ASC' : 'created_at DESC, id ASC'
  const rows = d
    .prepare(`SELECT * FROM prompt_cases ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset)

  return {
    cases: rows.map(rowToCase),
    total,
    page,
    pageSize,
    totalPages,
  }
}

/** 筛选面板用的聚合：各来源条数 + 出现过的模型与分类 */
export function caseFacets(appRoot) {
  const d = open(appRoot)
  const bySource = d.prepare('SELECT source, COUNT(*) c FROM prompt_cases GROUP BY source').all()
  const models = d
    .prepare("SELECT model, COUNT(*) c FROM prompt_cases WHERE model<>'' GROUP BY model ORDER BY c DESC")
    .all()
  const categories = d
    .prepare("SELECT category, COUNT(*) c FROM prompt_cases WHERE category<>'' GROUP BY category ORDER BY c DESC")
    .all()
  const total = Number(d.prepare('SELECT COUNT(*) c FROM prompt_cases').get()?.c) || 0
  const favorites = Number(d.prepare('SELECT COUNT(*) c FROM prompt_cases WHERE favorite=1').get()?.c) || 0
  return {
    total,
    favorites,
    bySource: Object.fromEntries(bySource.map((r) => [r.source, Number(r.c)])),
    models: models.map((r) => ({ model: r.model, count: Number(r.c) })),
    categories: categories.map((r) => ({ category: r.category, count: Number(r.c) })),
  }
}

/** 更新用户字段：只有备注与收藏可改，内容字段由导入 / 反推流程维护 */
export function patchCase(appRoot, id, patch = {}) {
  const d = open(appRoot)
  const row = d.prepare('SELECT * FROM prompt_cases WHERE id=?').get(String(id))
  if (!row) return null
  const note = patch.note === undefined ? row.note : String(patch.note || '').slice(0, 4000)
  const favorite = patch.favorite === undefined ? Number(row.favorite) || 0 : patch.favorite ? 1 : 0
  d.prepare('UPDATE prompt_cases SET note=?, favorite=?, updated_at=? WHERE id=?').run(
    note,
    favorite,
    nowIso(),
    String(id),
  )
  return getCase(appRoot, id)
}

export function deleteCase(appRoot, id) {
  const d = open(appRoot)
  return Number(d.prepare('DELETE FROM prompt_cases WHERE id=?').run(String(id)).changes) > 0
}

/** 反推案例的证据帧落盘子目录（媒体根下，随其他媒体一起备份） */
export const CASE_MEDIA_SUBDIR = 'prompt-cases'

// ---------------------------------------------------------------- 外部来源

/** 索引缓存 10 分钟：索引 5 MB，短时反复预览不该每次都重新下载 */
const INDEX_TTL_MS = 10 * 60 * 1000
/** 预览令牌 30 分钟：提交只认预览签发过的条目 */
const PREVIEW_TTL_MS = 30 * 60 * 1000
const INDEX_MAX_BYTES = 12 * 1024 * 1024
const ITEM_MAX_BYTES = 512 * 1024
const INDEX_TIMEOUT_MS = 20_000
const ITEM_TIMEOUT_MS = 8_000
const ITEM_CONCURRENCY = 4
export const PREVIEW_MAX_ITEMS = 60

const indexCache = new Map()
const previewCache = new Map()

function cacheGet(map, key) {
  const hit = map.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > (hit.ttl || INDEX_TTL_MS)) {
    map.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(map, key, value, ttl) {
  map.set(key, { value, at: Date.now(), ttl })
  return value
}

/** 测试用：清空缓存，让 fixture 改动立刻生效 */
export function clearCaseSourceCache() {
  indexCache.clear()
  previewCache.clear()
}

function decodeJsonText(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${what}返回的不是合法 JSON`)
  }
}

/** 读取响应体，超过上限立刻中止，避免大响应把内存打满 */
async function readCapped(res, maxBytes, what) {
  const declared = Number(res.headers?.get?.('content-length')) || 0
  if (declared && declared > maxBytes) {
    throw new Error(`${what}超过体积上限（${declared} > ${maxBytes} 字节）`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`${what}超过体积上限（${buf.length} > ${maxBytes} 字节）`)
  return buf.toString('utf8')
}

function ymdToIso(value) {
  const raw = String(value ?? '').replace(/\D/g, '')
  if (raw.length !== 8) return ''
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`
  return Number.isNaN(Date.parse(iso)) ? '' : iso
}

function absoluteTwimg(pathOrUrl, base) {
  const v = String(pathOrUrl || '').trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  return `${base}${v.startsWith('/') ? '' : '/'}${v}`
}

/**
 * vflow 索引行 → 摘要。
 *
 * 索引是位置数组而不是对象（体积换速度），列序见 VFLOW_COLUMNS。
 * facet 列存的是分类下标；模型、时长、比例各存下标，-1 表示没有。
 */
const VFLOW_COLUMNS = {
  id: 0,
  title: 1,
  thumb: 2,
  author: 3,
  video: 4,
  facets: 9,
  date: 10,
  model: 11,
  authorName: 12,
  durationSec: 13,
}

export function parseVflowIndex(raw) {
  const doc = typeof raw === 'string' ? decodeJsonText(raw, '索引') : raw
  if (!doc || typeof doc !== 'object') throw new Error('索引结构无法识别')
  const rows = Array.isArray(doc.rows) ? doc.rows : []
  const models = Array.isArray(doc.mod) ? doc.mod : []
  const cats = Array.isArray(doc.cat) ? doc.cat : []
  const aspects = Array.isArray(doc.asp) ? doc.asp : []

  const items = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const id = String(row[VFLOW_COLUMNS.id] || '').trim()
    if (!id) continue
    const facetIdx = Array.isArray(row[VFLOW_COLUMNS.facets]) ? row[VFLOW_COLUMNS.facets] : []
    const cats_ = facetIdx
      .map((i) => (Number.isInteger(i) && i >= 0 && i < cats.length ? cats[i] : ''))
      .filter(Boolean)
    const modelIdx = row[VFLOW_COLUMNS.model]
    const aspectIdx = row[8]
    items.push({
      id,
      title: String(row[VFLOW_COLUMNS.title] || '').trim(),
      author: String(row[VFLOW_COLUMNS.authorName] || row[VFLOW_COLUMNS.author] || '').trim(),
      authorHandle: String(row[VFLOW_COLUMNS.author] || '').trim(),
      videoUrl: absoluteTwimg(row[VFLOW_COLUMNS.video], 'https://video.twimg.com'),
      posterUrl: row[VFLOW_COLUMNS.thumb]
        ? `https://pbs.twimg.com/amplify_video_thumb/${String(row[VFLOW_COLUMNS.thumb])}.jpg`
        : '',
      model: Number.isInteger(modelIdx) && modelIdx >= 0 && modelIdx < models.length ? models[modelIdx] : '',
      category: cats_[0] || '',
      tags: cats_.slice(1, 5),
      aspect: Number.isInteger(aspectIdx) && aspectIdx >= 0 && aspectIdx < aspects.length ? aspects[aspectIdx] : '',
      durationSec: Number(row[VFLOW_COLUMNS.durationSec]) || 0,
      createdAt: ymdToIso(row[VFLOW_COLUMNS.date]),
      pageUrl: '',
    })
  }
  return { items, models, categories: cats }
}

/** 逐条 JSON → 案例输入（许可由 saveCase 按来源推导，这里不写） */
export function parseVflowItem(raw) {
  const doc = typeof raw === 'string' ? decodeJsonText(raw, '条目') : raw
  if (!doc || typeof doc !== 'object') throw new Error('条目结构无法识别')
  const id = String(doc.id || '').trim()
  if (!id) throw new Error('条目缺少 id')
  const prompt = String(doc.prompt || '').trim()
  return {
    source: 'vflow',
    sourceId: id,
    title: String(doc.title || '').trim(),
    prompt,
    model: String(doc.referenceModel || '').trim(),
    category: '',
    tags: prompt ? [] : [],
    videoUrl: String(doc.videoUrl || '').trim(),
    posterUrl: String(doc.thumbnailUrl || '').trim(),
    author: '',
    sourceUrl: String(doc.sourceUrl || doc.promptSourceUrl || '').trim(),
    createdAt: '',
  }
}

/**
 * 来源适配器注册表。
 *
 * 未启用的来源照样登记：界面上要能看到「为什么没有这一项」，而不是它凭空不存在。
 */
export const CASE_SOURCE_REGISTRY = {
  vflow: {
    id: 'vflow',
    label: 'vflow',
    enabled: true,
    reason: '',
    note: '公开索引 + 逐条 JSON；robots 声明 ai-train=no、use=reference，只能作参考用。',
  },
  flatkey: {
    id: 'flatkey',
    label: 'flatkey',
    enabled: false,
    reason: '数据在 /_next/ 下且 robots 明确 Disallow，媒体 CDN 返回 404；商用前需单独确认授权。',
    note: '',
  },
  apiko: {
    id: 'apiko',
    label: 'apiko',
    enabled: false,
    reason: '页面纯客户端渲染，没有可用的索引或接口。',
    note: '',
  },
  higgsfield: {
    id: 'higgsfield',
    label: 'higgsfield',
    enabled: false,
    reason: '只有项目页，没有批量索引。',
    note: '',
  },
}

export function listCaseSources() {
  return Object.values(CASE_SOURCE_REGISTRY).map((s) => ({
    id: s.id,
    label: s.label,
    enabled: s.enabled,
    reason: s.reason,
    note: s.note,
  }))
}

function requireEnabledSource(sourceId) {
  const def = CASE_SOURCE_REGISTRY[String(sourceId || '')]
  if (!def) throw new Error(`未知来源：${sourceId || '(空)'}`)
  if (!def.enabled) throw new Error(`来源「${def.label}」未启用：${def.reason || '暂不可用'}`)
  return def
}

const VFLOW_INDEX_URL = 'https://www.vflow.live/data/daily159-successor-20261111/index-all.json'
const VFLOW_ITEM_URL = (id) => `https://www.vflow.live/data/prompt-sources/v1/${encodeURIComponent(id)}.json`

/** 拉索引（带缓存）。测试用 deps.fetchImpl 换成读本地 fixture。 */
async function loadVflowIndex(deps = {}) {
  const url = deps.indexUrl || VFLOW_INDEX_URL
  const cached = cacheGet(indexCache, url)
  if (cached) return cached
  if (deps.indexJson) {
    return cacheSet(indexCache, url, parseVflowIndex(deps.indexJson), INDEX_TTL_MS)
  }
  const fetchImpl = deps.fetchImpl || fetch
  const { assertPublicUrl } = await import('./ingest.mjs')
  await assertPublicUrl(url)
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(deps.indexTimeoutMs || INDEX_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`索引请求失败：HTTP ${res.status}`)
  const text = await readCapped(res, INDEX_MAX_BYTES, '索引')
  return cacheSet(indexCache, url, parseVflowIndex(text), INDEX_TTL_MS)
}

/**
 * 预览：只回摘要，不落库。
 *
 * 返回的 token 是提交阶段的唯一凭据：客户端只能提交这次预览见过的 id，
 * 不能拿别的 id 或自己拼的地址来导入。
 */
export async function previewCasesFromSource(input = {}, deps = {}) {
  const def = requireEnabledSource(input.source)
  const q = String(input.q || '').trim().toLowerCase()
  const model = String(input.model || '').trim()
  const category = String(input.category || '').trim()
  const limit = Math.max(1, Math.min(PREVIEW_MAX_ITEMS, Math.floor(Number(input.limit) || 24)))

  if (def.id !== 'vflow') throw new Error(`来源「${def.label}」还没有预览实现`)

  const index = await loadVflowIndex(deps)
  let items = index.items
  if (model) items = items.filter((it) => it.model === model)
  if (category) items = items.filter((it) => it.category === category || it.tags.includes(category))
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean)
    items = items.filter((it) => {
      const hay = `${it.title} ${it.author} ${it.category} ${it.tags.join(' ')}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  const picked = items.slice(0, limit)

  const token = crypto.randomBytes(12).toString('hex')
  cacheSet(previewCache, token, { source: def.id, ids: new Set(picked.map((i) => i.id)) }, PREVIEW_TTL_MS)

  return {
    source: def.id,
    sourceLabel: def.label,
    token,
    total: items.length,
    items: picked,
    models: index.models,
    categories: index.categories,
    license: licenseForSource(def.id),
  }
}

/** 单条抓取：带超时与体积上限，失败只影响这一条 */
async function fetchVflowItem(id, deps = {}) {
  const url = deps.itemUrl ? deps.itemUrl(id) : VFLOW_ITEM_URL(id)
  if (deps.itemJson && typeof deps.itemJson === 'function') {
    return parseVflowItem(deps.itemJson(id))
  }
  const fetchImpl = deps.fetchImpl || fetch
  const { assertPublicUrl } = await import('./ingest.mjs')
  await assertPublicUrl(url)
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(deps.itemTimeoutMs || ITEM_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`条目请求失败：HTTP ${res.status}`)
  const text = await readCapped(res, ITEM_MAX_BYTES, '条目')
  return parseVflowItem(text)
}

async function mapLimit(items, limit, fn) {
  const out = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor
      cursor += 1
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

/**
 * 提交导入：只接受预览签发的 token 与其中出现过的 id。
 *
 * 逐条抓取并 UPSERT；单条失败记入 failed，不影响其余条目。
 */
export async function importCasesFromSource(appRoot, input = {}, deps = {}) {
  const def = requireEnabledSource(input.source)
  const token = String(input.token || '').trim()
  const preview = cacheGet(previewCache, token)
  if (!preview || preview.source !== def.id) {
    throw new Error('预览已过期或无效，请重新预览后再导入')
  }
  const wanted = Array.isArray(input.ids) && input.ids.length
    ? input.ids.map((x) => String(x || '').trim()).filter(Boolean)
    : [...preview.ids]
  const rejected = wanted.filter((id) => !preview.ids.has(id))
  if (rejected.length) {
    throw new Error(`有 ${rejected.length} 条不在本次预览结果里：${rejected.slice(0, 3).join('、')}`)
  }

  const got = await mapLimit(wanted, ITEM_CONCURRENCY, async (id) => {
    try {
      return { ok: true, id, value: await fetchVflowItem(id, deps) }
    } catch (e) {
      return { ok: false, id, message: e?.message || String(e) }
    }
  })

  const good = got.filter((r) => r.ok).map((r) => r.value)
  const failed = got.filter((r) => !r.ok).map((r) => ({ id: r.id, message: r.message }))
  const saved = saveCases(appRoot, good)
  return {
    source: def.id,
    created: saved.created,
    updated: saved.updated,
    failed: [...failed, ...saved.failed.map((f) => ({ id: f.sourceId, message: f.message }))],
    imported: good.length,
  }
}

