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
import { getExternalFetch, resolveSystemHttpsProxy } from './apimart-network.mjs'
import {
  FACET_SOURCE_RANK,
  FACET_SOURCES,
  deriveFacets,
  getFacetValue,
  loadDefaultTaxonomy,
  loadTaxonomy,
  mapSourceCategories,
  taxonomyVersion as taxonomyVersionOf,
} from './prompt-taxonomy.mjs'

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
    taxonomyVersion: row.taxonomy_version || '',
    /** 分面在列表/详情读出时补齐（见 attachFacets）；单独读案例时为 null */
    facets: null,
  }
}

// ---------------------------------------------------------------- 分面

function rowToFacet(row) {
  return {
    axis: row.axis,
    value: row.value,
    source: row.source,
    unmapped: Boolean(row.unmapped),
    suppressed: Boolean(row.suppressed),
    taxonomyVersion: row.taxonomy_version || '',
    updatedAt: row.updated_at || '',
  }
}

/**
 * 读一条案例的分面。
 *
 * 默认过滤 `suppressed=1`：那是用户手工隐藏的自动值，界面不该再显示，
 * 否则「删掉又冒出来」。
 */
export function getCaseFacets(appRoot, caseId, options = {}) {
  const d = open(appRoot)
  const includeSuppressed = Boolean(options.includeSuppressed)
  const rows = d
    .prepare(
      `SELECT * FROM case_facets WHERE case_id=?${includeSuppressed ? '' : ' AND suppressed=0'} ORDER BY axis, value`,
    )
    .all(String(caseId))
  return rows.map(rowToFacet)
}

/**
 * 写入分面（UPSERT），来源只升不降。
 *
 * 为什么不是「后写覆盖」：一次导入带 import、一次推导带 derived、一次人工带 manual，
 * 三者可能指向同一个 `(axis,value)`。谁更可信是确定的，按优先级合并即可；
 * 若按写入顺序覆盖，重跑推导就会把人工修正冲掉。
 */
export function setCaseFacets(appRoot, caseId, facets, options = {}) {
  const d = open(appRoot)
  const version = String(options.taxonomyVersion || '')
  const at = nowIso()
  const id = String(caseId)
  let written = 0
  const select = d.prepare('SELECT source, suppressed FROM case_facets WHERE case_id=? AND axis=? AND value=?')
  const insert = d.prepare(
    `INSERT INTO case_facets (case_id,axis,value,source,unmapped,suppressed,taxonomy_version,updated_at)
     VALUES (?,?,?,?,?,0,?,?)`,
  )
  const update = d.prepare(
    `UPDATE case_facets SET source=?, unmapped=?, taxonomy_version=?, updated_at=?
     WHERE case_id=? AND axis=? AND value=?`,
  )

  for (const f of Array.isArray(facets) ? facets : []) {
    const axis = String(f?.axis || '').trim()
    const value = String(f?.value || '').trim()
    if (!axis || !value) continue
    const source = FACET_SOURCES.includes(f?.source) ? f.source : 'derived'
    const unmapped = f?.unmapped ? 1 : 0
    const row = select.get(id, axis, value)
    if (!row) {
      insert.run(id, axis, value, source, unmapped, version, at)
      written += 1
      continue
    }
    const nextRank = FACET_SOURCE_RANK[source] || 1
    const curRank = FACET_SOURCE_RANK[row.source] || 1
    // 隐藏记录是人工决定，推导/导入都不碰它（恢复走 restoreCaseFacet）
    if (row.suppressed) continue
    // 同来源刷新版本号与未映射标记；更高来源升级；更低来源不降级
    if (nextRank >= curRank) {
      update.run(nextRank > curRank ? source : row.source, unmapped, version, at, id, axis, value)
      written += 1
    }
  }
  return { written, facets: getCaseFacets(appRoot, id) }
}

/**
 * 用推导结果替换自动分面。
 *
 * 规则：
 * - 已有 import/manual（未隐藏）的轴整轴跳过——事实来源比文本猜测可信；
 * - 用户隐藏过的 `(axis,value)` 不再写回；
 * - 旧的 derived 行若不在新结果里就删除（否则改一次词表就永远留着旧值）。
 */
export function applyDerivedFacets(appRoot, caseId, derived, options = {}) {
  const d = open(appRoot)
  const id = String(caseId)
  const version = String(options.taxonomyVersion || '')
  const at = nowIso()

  const existing = d.prepare('SELECT * FROM case_facets WHERE case_id=?').all(id)
  const lockedAxes = new Set(
    existing.filter((r) => !r.suppressed && (r.source === 'import' || r.source === 'manual')).map((r) => r.axis),
  )
  const hidden = new Set(existing.filter((r) => r.suppressed).map((r) => `${r.axis}:${r.value}`))

  const wanted = new Map()
  for (const f of Array.isArray(derived) ? derived : []) {
    const axis = String(f?.axis || '').trim()
    const value = String(f?.value || '').trim()
    if (!axis || !value) continue
    if (lockedAxes.has(axis)) continue
    if (hidden.has(`${axis}:${value}`)) continue
    wanted.set(`${axis}:${value}`, {
      axis,
      value,
      unmapped: f?.unmapped ? 1 : 0,
      // 推导结果里混着两类：文本猜的（derived）与字段/来源映射的事实（import）。
      // 把后者也降级成 derived，会让「来源标注」说谎，也会被下一次文本推导覆盖。
      source: FACET_SOURCES.includes(f?.source) ? f.source : 'derived',
    })
  }

  const del = d.prepare(
    "DELETE FROM case_facets WHERE case_id=? AND axis=? AND value=? AND source='derived' AND suppressed=0",
  )
  for (const r of existing) {
    if (r.source !== 'derived' || r.suppressed) continue
    if (!wanted.has(`${r.axis}:${r.value}`)) del.run(id, r.axis, r.value)
  }

  setCaseFacets(
    appRoot,
    id,
    [...wanted.values()],
    { taxonomyVersion: version },
  )
  d.prepare('UPDATE prompt_cases SET taxonomy_version=?, updated_at=? WHERE id=?').run(version, at, id)
  return getCaseFacets(appRoot, id)
}

/**
 * 删除一个分面值。
 *
 * - 自动值（derived/import）→ 写隐藏记录（source=manual, suppressed=1），
 *   推导与重新导入都不会把它加回来；
 * - 用户手工加的值 → 直接删除行；
 * - 已经是隐藏记录 → 返回 false（界面不该给出这个操作）。
 */
export function deleteCaseFacet(appRoot, caseId, axis, value) {
  const d = open(appRoot)
  const id = String(caseId)
  const a = String(axis || '').trim()
  const v = String(value || '').trim()
  const row = d.prepare('SELECT * FROM case_facets WHERE case_id=? AND axis=? AND value=?').get(id, a, v)
  if (!row) return false
  if (row.suppressed) return false
  if (row.source === 'manual') {
    d.prepare('DELETE FROM case_facets WHERE case_id=? AND axis=? AND value=?').run(id, a, v)
    return true
  }
  d.prepare(
    'UPDATE case_facets SET source=?, suppressed=1, updated_at=? WHERE case_id=? AND axis=? AND value=?',
  ).run('manual', nowIso(), id, a, v)
  return true
}

/** 恢复被隐藏的分面值：保留 manual 来源，使它不再被推导结果覆盖 */
export function restoreCaseFacet(appRoot, caseId, axis, value) {
  const d = open(appRoot)
  const r = d
    .prepare(
      'UPDATE case_facets SET suppressed=0, source=?, updated_at=? WHERE case_id=? AND axis=? AND value=? AND suppressed=1',
    )
    .run('manual', nowIso(), String(caseId), String(axis || '').trim(), String(value || '').trim())
  return Number(r.changes) > 0
}

/** 把分面挂到一批案例上：列表/详情共用，避免每条案例单独查一次 */
function attachFacets(d, cases) {
  if (!Array.isArray(cases) || !cases.length) return cases
  const ids = cases.map((c) => c.id).filter(Boolean)
  if (!ids.length) return cases
  const ph = ids.map(() => '?').join(',')
  const rows = d
    .prepare(
      `SELECT * FROM case_facets WHERE case_id IN (${ph}) AND suppressed=0 ORDER BY axis, value`,
    )
    .all(...ids)
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r.case_id)) map.set(r.case_id, [])
    map.get(r.case_id).push(rowToFacet(r))
  }
  for (const c of cases) c.facets = map.get(c.id) || []
  return cases
}

/** 按当前词表重新推导一条案例并落库（导入/反推/回填共用） */
export function refreshCaseFacets(appRoot, caseId, options = {}) {
  const row = open(appRoot)
    .prepare('SELECT * FROM prompt_cases WHERE id=?')
    .get(String(caseId))
  if (!row) return []
  const taxonomy = options.taxonomy || loadTaxonomy(appRoot)
  const reservedAxes = new Set(
    open(appRoot)
      .prepare("SELECT DISTINCT axis FROM case_facets WHERE case_id=? AND suppressed=0 AND source IN ('import','manual')")
      .all(String(caseId))
      .map((r) => r.axis),
  )
  const derived = deriveFacets(
    taxonomy,
    {
      source: row.source,
      title: row.title,
      prompt: row.prompt,
      tags: parseJson(row.tags, []),
      shots: parseJson(row.shots, []),
      category: row.category,
    },
    { reservedAxes },
  )
  // 回填脚本需要「只算不写」：词表升级后先预演，避免一次跑坏整库
  if (options.dryRun) return derived
  return applyDerivedFacets(appRoot, caseId, derived, { taxonomyVersion: taxonomyVersionOf(taxonomy) })
}

/** 还停留在旧词表版本的案例，供回填脚本与「版本落后」提示使用 */
export function listStaleFacetCases(appRoot, version, options = {}) {
  const d = open(appRoot)
  const v = String(version || '')
  const limit = Math.max(1, Math.min(5000, Number(options.limit) || 500))
  const stale = d
    .prepare(
      "SELECT id, title, taxonomy_version FROM prompt_cases WHERE taxonomy_version IS NULL OR taxonomy_version='' OR taxonomy_version<>? ORDER BY created_at DESC LIMIT ?",
    )
    .all(v, limit)
  const total = Number(
    d
      .prepare(
        "SELECT COUNT(*) c FROM prompt_cases WHERE taxonomy_version IS NULL OR taxonomy_version='' OR taxonomy_version<>?",
      )
      .get(v)?.c,
  ) || 0
  return { total, cases: stale.map((r) => ({ id: r.id, title: r.title || '', taxonomyVersion: r.taxonomy_version || '' })) }
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
  // 导入/反推可以在保存时带分面；来源由调用方标注（导入为 import）
  if (Array.isArray(input.facets) && input.facets.length) {
    setCaseFacets(appRoot, id, input.facets, { taxonomyVersion: input.taxonomyVersion || '' })
  }
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
  const row = d.prepare('SELECT * FROM prompt_cases WHERE id=?').get(String(id))
  if (!row) return null
  return attachFacets(d, [rowToCase(row)])[0]
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
 * 把筛选条件拼成 WHERE。
 *
 * `facetGroups` 是每轴一组值：同轴 OR（IN），跨轴 AND（多个 EXISTS）。
 * `excludeAxis` 供分面计数使用——算某轴候选值时不能带上该轴自己的条件，
 * 否则用户在同一轴里多选时，其他候选值的条数会被压成 0。
 */
function buildCaseWhere(options = {}, excludeAxis = '', alias = 'prompt_cases') {
  const where = []
  const params = []

  for (const term of queryTerms(options.q)) {
    where.push(`(lower(${alias}.title) LIKE ? OR lower(${alias}.prompt) LIKE ? OR lower(${alias}.tags) LIKE ?)`)
    const like = `%${term}%`
    params.push(like, like, like)
  }

  const source = normalizeCaseSource(options.source)
  if (source) {
    where.push(`${alias}.source=?`)
    params.push(source)
  }
  if (options.model) {
    where.push(`${alias}.model=?`)
    params.push(String(options.model))
  }
  if (options.category) {
    where.push(`${alias}.category=?`)
    params.push(String(options.category))
  }
  if (options.favorite) where.push(`${alias}.favorite=1`)

  for (const group of Array.isArray(options.facetGroups) ? options.facetGroups : []) {
    const axis = String(group?.axis || '').trim()
    const values = Array.isArray(group?.values) ? group.values.filter(Boolean) : []
    if (!axis || !values.length) continue
    if (excludeAxis && axis === excludeAxis) continue
    const ph = values.map(() => '?').join(',')
    where.push(
      `EXISTS (SELECT 1 FROM case_facets f WHERE f.case_id = ${alias}.id AND f.axis = ? AND f.value IN (${ph}) AND f.suppressed = 0)`,
    )
    params.push(axis, ...values)
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', where, params }
}

/**
 * 列表查询。
 *
 * 筛选维度：关键词（标题 + 提示词正文 + 标签）、来源、模型、收藏、分类、分面。
 * 排序默认按创建时间倒序；`sort=title` 按标题升序，便于按写法找。
 */
export function listCases(appRoot, options = {}) {
  const d = open(appRoot)
  const { clause, params } = buildCaseWhere(options)

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
    cases: attachFacets(d, rows.map(rowToCase)),
    total,
    page,
    pageSize,
    totalPages,
  }
}

/**
 * 分面计数：当前筛选下每个轴值的可用条数。
 *
 * 算某轴时排除该轴自身的条件，其余条件全保留；未参与筛选的轴共用一个查询。
 * 结果只含有条数的值——0 条的值由前端按词表补齐并置灰。
 */
export function caseFacetCounts(appRoot, options = {}) {
  const d = open(appRoot)
  const groups = (Array.isArray(options.facetGroups) ? options.facetGroups : []).filter(
    (g) => g?.axis && Array.isArray(g.values) && g.values.length,
  )
  const selected = new Set(groups.map((g) => g.axis))
  const out = []
  const seen = new Set()
  const push = (rows) => {
    for (const r of rows) {
      const key = `${r.axis}:${r.value}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ axis: r.axis, value: r.value, count: Number(r.n) || 0 })
    }
  }

  // 未参与筛选的轴：全部条件同时生效（没有选中轴时这里就是全部轴的计数）
  const all = buildCaseWhere(options, '', 'c')
  const allClause = all.where.length ? `WHERE ${all.where.join(' AND ')} AND` : 'WHERE'
  push(
    d
      .prepare(
        `SELECT f.axis, f.value, COUNT(DISTINCT f.case_id) n
         FROM case_facets f JOIN prompt_cases c ON c.id = f.case_id
         ${allClause} f.suppressed = 0 AND f.unmapped = 0
         GROUP BY f.axis, f.value`,
      )
      .all(...all.params)
      .filter((r) => !selected.has(r.axis)),
  )

  // 参与筛选的轴：排除该轴自身的条件，其余全保留
  for (const axis of selected) {
    const w = buildCaseWhere(options, axis, 'c')
    const clause = w.where.length ? `WHERE ${w.where.join(' AND ')} AND` : 'WHERE'
    push(
      d
        .prepare(
          `SELECT f.axis, f.value, COUNT(DISTINCT f.case_id) n
           FROM case_facets f JOIN prompt_cases c ON c.id = f.case_id
           ${clause} f.suppressed = 0 AND f.unmapped = 0 AND f.axis = ?
           GROUP BY f.axis, f.value`,
        )
        .all(...w.params, axis),
    )
  }

  return out
}

/**
 * 按轴的骨架计数：每个轴有多少个受控值被用过、覆盖了多少条案例。
 *
 * 为什么单独一条 SQL：`caseFacetCounts` 是按「轴 + 值」分组的条数，把同一轴各值的
 * `count` 相加得到的不是案例数 —— 一条案例在同一轴上可以有多个值（同轴 OR 的语义），
 * 相加会把它重复统计。案例覆盖数必须用 `COUNT(DISTINCT case_id)` 单独算。
 *
 * 只计受控值（`unmapped=0`）：本函数服务于「词表里哪些值真的被用过」，
 * 未映射的原始分类不在词表里，混进来会让调用方以为词表有这个词。
 */
export function caseFacetSkeleton(appRoot) {
  const d = open(appRoot)
  const rows = d
    .prepare(
      `SELECT axis, COUNT(DISTINCT case_id) AS cases, COUNT(*) AS values_used
       FROM case_facets
       WHERE suppressed = 0 AND unmapped = 0
       GROUP BY axis
       ORDER BY axis`,
    )
    .all()
  return rows.map((r) => ({
    axis: String(r.axis || ''),
    cases: Number(r.cases) || 0,
    values: Number(r.values_used) || 0,
  }))
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
      categories: cats_,
      aspect: Number.isInteger(aspectIdx) && aspectIdx >= 0 && aspectIdx < aspects.length ? aspects[aspectIdx] : '',
      durationSec: Number(row[VFLOW_COLUMNS.durationSec]) || 0,
      createdAt: ymdToIso(row[VFLOW_COLUMNS.date]),
      pageUrl: '',
    })
  }
  return { items, models, categories: cats }
}

/**
 * 逐条 JSON → 案例输入（许可由 saveCase 按来源推导，这里不写）。
 *
 * 逐条 JSON 本身不带分类，分类在索引行里；导入时用 `options.categories` 把索引
 * 上那条记录的多标签带进来。早先这里把 `category` 写死为空串，等于把来源标注的
 * 分类整批丢掉——这正是分面体系要修的问题。
 */
export function parseVflowItem(raw, options = {}) {
  const doc = typeof raw === 'string' ? decodeJsonText(raw, '条目') : raw
  if (!doc || typeof doc !== 'object') throw new Error('条目结构无法识别')
  const id = String(doc.id || '').trim()
  if (!id) throw new Error('条目缺少 id')
  const prompt = String(doc.prompt || '').trim()
  const rawCats =
    (Array.isArray(options.categories) && options.categories) ||
    (Array.isArray(doc.categories) && doc.categories) ||
    (Array.isArray(doc.cat) && doc.cat) ||
    (doc.category ? [doc.category] : [])
  const categories = [...new Set(rawCats.map((c) => String(c ?? '').trim()).filter(Boolean))]
  return {
    source: 'vflow',
    sourceId: id,
    title: String(doc.title || '').trim(),
    prompt,
    model: String(doc.referenceModel || '').trim(),
    category: categories[0] || '',
    tags: categories.slice(1, 9),
    categories,
    videoUrl: String(doc.videoUrl || '').trim(),
    posterUrl: String(doc.thumbnailUrl || '').trim(),
    author: '',
    sourceUrl: String(doc.sourceUrl || doc.promptSourceUrl || '').trim(),
    createdAt: '',
  }
}

/** 把来源分类预映射成可分面，预览与导入共用 */
export function summarizeSourceFacets(taxonomy, source, categories) {
  const { mapped, unmapped } = mapSourceCategories(taxonomy, source, categories)
  const seen = new Set()
  const facets = []
  for (const m of mapped) {
    const key = `${m.axis}:${m.value}`
    if (seen.has(key)) continue
    seen.add(key)
    facets.push({ axis: m.axis, value: m.value })
  }
  return { facets, unmapped }
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

/**
 * 出网失败时说人话。
 *
 * 原生 `fetch` 失败只抛「fetch failed」，用户无从判断是断网、被墙还是代理没配；
 * 这里补上主机、底层原因与「当前是否走了代理」，界面直接展示 message 就够用。
 */
function outboundError(err, url) {
  let host = url
  try {
    host = new URL(url).hostname
  } catch {
    /* 非标准 URL，原样展示 */
  }
  const proxy = resolveSystemHttpsProxy()
  const cause = err?.cause?.code || err?.cause?.message || ''
  const reason = cause || String(err?.message || err)
  const route = proxy ? `已按系统代理 ${proxy} 请求` : '未使用代理（直连）'
  return new Error(
    `连不上外部来源 ${host}：${reason}。${route}；请检查网络与代理设置后重试。`,
  )
}

/** 统一走「会认系统代理」的 fetch；测试仍可用 deps.fetchImpl 注入 */
async function outboundFetch(url, init, deps = {}, timeoutMs) {
  const fetchImpl = deps.fetchImpl || getExternalFetch()
  try {
    return await fetchImpl(url, init)
  } catch (e) {
    throw outboundError(e, url)
  }
}

/** 拉索引（带缓存）。测试用 deps.fetchImpl 换成读本地 fixture。 */
async function loadVflowIndex(deps = {}) {
  const url = deps.indexUrl || VFLOW_INDEX_URL
  const cached = cacheGet(indexCache, url)
  if (cached) return cached
  if (deps.indexJson) {
    return cacheSet(indexCache, url, parseVflowIndex(deps.indexJson), INDEX_TTL_MS)
  }
  const { assertPublicUrl } = await import('./ingest.mjs')
  await assertPublicUrl(url)
  const res = await outboundFetch(
    url,
    { signal: AbortSignal.timeout(deps.indexTimeoutMs || INDEX_TIMEOUT_MS) },
    deps,
  )
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
  const taxonomy = deps.taxonomy || loadDefaultTaxonomy()

  if (def.id !== 'vflow') throw new Error(`来源「${def.label}」还没有预览实现`)

  const index = await loadVflowIndex(deps)
  let items = index.items
  if (model) items = items.filter((it) => it.model === model)
  if (category) {
    items = items.filter(
      (it) => it.category === category || (it.categories || []).includes(category) || it.tags.includes(category),
    )
  }
  if (q) {
    const terms = q.split(/\s+/).filter(Boolean)
    items = items.filter((it) => {
      const hay = `${it.title} ${it.author} ${it.category} ${(it.categories || []).join(' ')} ${it.tags.join(' ')}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }
  const picked = items.slice(0, limit)

  const token = crypto.randomBytes(12).toString('hex')
  const cachedItems = new Map()
  for (const it of picked) cachedItems.set(it.id, { categories: it.categories || [] })
  cacheSet(previewCache, token, { source: def.id, ids: new Set(picked.map((i) => i.id)), items: cachedItems }, PREVIEW_TTL_MS)

  return {
    source: def.id,
    sourceLabel: def.label,
    token,
    total: items.length,
    items: picked.map((it) => ({
      ...it,
      // 预览就把「会落到哪些轴值 / 哪些没映射」摊开：用户是在这一步决定导不导
      ...summarizeSourceFacets(taxonomy, def.id, it.categories || []),
    })),
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
  const { assertPublicUrl } = await import('./ingest.mjs')
  await assertPublicUrl(url)
  const res = await outboundFetch(
    url,
    { signal: AbortSignal.timeout(deps.itemTimeoutMs || ITEM_TIMEOUT_MS) },
    deps,
  )
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

  const taxonomy = deps.taxonomy || loadDefaultTaxonomy()
  const unmappedAxis = taxonomy.limits?.unmappedAxis || 'genre'
  const good = got.filter((r) => r.ok).map((r) => r.value)
  const failed = got.filter((r) => !r.ok).map((r) => ({ id: r.id, message: r.message }))

  // 分类来自索引行（逐条 JSON 不带），提交时按预览缓存回填，并预映射成分面
  for (const item of good) {
    const categories = preview.items?.get(item.sourceId)?.categories || item.categories || []
    item.categories = categories
    item.category = categories[0] || ''
    item.tags = normalizeCaseTags(categories.slice(1))
    const { facets, unmapped } = summarizeSourceFacets(taxonomy, def.id, categories)
    item.facets = [
      ...facets.map((f) => ({ ...f, source: 'import' })),
      ...unmapped.map((raw) => ({ axis: unmappedAxis, value: raw, source: 'import', unmapped: true })),
    ]
    item.taxonomyVersion = taxonomyVersionOf(taxonomy)
  }

  const saved = saveCases(appRoot, good)

  // D8：推导只跑本次写入的案例，不扫全库。导入分面已锁定对应轴，推导只补空缺。
  let facetsWritten = 0
  for (const item of good) {
    const id = promptCaseId(def.id, item.sourceId)
    facetsWritten += refreshCaseFacets(appRoot, id, { taxonomy }).length
  }

  return {
    source: def.id,
    created: saved.created,
    updated: saved.updated,
    failed: [...failed, ...saved.failed.map((f) => ({ id: f.sourceId, message: f.message }))],
    imported: good.length,
    facetsWritten,
  }
}

