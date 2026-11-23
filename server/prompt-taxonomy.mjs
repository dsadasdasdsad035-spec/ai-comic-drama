/**
 * 提示词案例的分类词表与分面推导。
 *
 * 词表只有一个来源：`public/presets/prompt-taxonomy/v1.json`。前端构建期内联同一份
 * 文件，服务端运行时读它——两边各写一套一定会漂移，而分类一旦不一致，用户按某个值
 * 筛选就会查不到明明存在的案例。
 *
 * 本模块只做「纯函数」的事：加载、校验、归一、推导。读写库在 `prompt-cases.mjs`，
 * 这样推导规则可以在 node 下直接回归，不必起服务、不必连库。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TAXONOMY_REL_PATH = 'public/presets/prompt-taxonomy/v1.json'

/** 模块所在仓库根：预览/导入没有 appRoot 时用它定位随包发布的词表 */
export const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 分面来源，优先级从低到高 */
export const FACET_SOURCES = ['derived', 'import', 'manual']
export const FACET_SOURCE_RANK = { derived: 1, import: 2, manual: 3 }

/** 轴 id 的顺序敏感：UI 与文档都按它排 */
let cached = null
let cachedPath = ''

function taxonomyPath(appRoot) {
  return path.join(appRoot, TAXONOMY_REL_PATH)
}

function isAscii(s) {
  return /^[\x00-\x7f]+$/.test(s)
}

function norm(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * 校验词表。任何一条不合规都抛出并指出具体项：
 * 词表坏了必须让启动失败，而不是用空词表静默跑成「全库筛不出东西」。
 */
export function validateTaxonomy(doc) {
  const problems = []
  if (!doc || typeof doc !== 'object') throw new Error('分类词表无法解析')
  if (!doc.version) problems.push('缺少 version')
  const axes = Array.isArray(doc.axes) ? doc.axes : []
  if (axes.length !== 18) problems.push(`轴数量应为 18，实际 ${axes.length}`)

  const axisIds = new Set()
  const valuesByAxis = new Map()

  for (const axis of axes) {
    const aid = String(axis?.id || '').trim()
    if (!aid) {
      problems.push('存在缺少 id 的轴')
      continue
    }
    if (axisIds.has(aid)) problems.push(`轴 id 重复：${aid}`)
    axisIds.add(aid)
    if (!axis.cn || !axis.en) problems.push(`轴 ${aid} 缺少中/英文名`)

    const vals = Array.isArray(axis.values) ? axis.values : []
    if (vals.length < 8) problems.push(`轴 ${aid} 的值少于 8 个（${vals.length}）`)

    const valueIds = new Set()
    const termOwner = new Map()
    for (const v of vals) {
      const vid = String(v?.id || '').trim()
      if (!vid) {
        problems.push(`轴 ${aid} 存在缺少 id 的值`)
        continue
      }
      if (valueIds.has(vid)) problems.push(`轴 ${aid} 的值 id 重复：${vid}`)
      valueIds.add(vid)
      if (!v.cn || !v.en || !v.token) problems.push(`轴 ${aid} 的值 ${vid} 缺少 cn/en/token`)

      // 同一轴内，中文名、英文名、提示词 token 与别名共享一个命名空间：
      // 否则「别名解析」会出现两个候选，只能靠猜。
      for (const term of [v.cn, v.en, v.token, ...(Array.isArray(v.aliases) ? v.aliases : [])]) {
        const k = norm(term)
        if (!k) continue
        const owner = termOwner.get(k)
        if (owner && owner !== vid) {
          problems.push(`轴 ${aid} 的别名冲突：「${term}」同时指向 ${owner} 与 ${vid}`)
        } else {
          termOwner.set(k, vid)
        }
      }
    }
    valuesByAxis.set(aid, valueIds)
  }

  /** 来源映射与制作方式映射必须指向真实存在的轴值，否则导入就是静默丢数据 */
  const requireTarget = (where, pair) => {
    const [axisId, valueId] = String(pair || '').split(':')
    if (!axisId || !valueId) {
      problems.push(`${where} 的映射目标格式应为 axis:value：${pair}`)
      return
    }
    const set = valuesByAxis.get(axisId)
    if (!set) problems.push(`${where} 指向不存在的轴：${axisId}`)
    else if (!set.has(valueId)) problems.push(`${where} 指向不存在的值：${pair}`)
  }

  for (const [sourceName, mapping] of Object.entries(doc.sourceMappings || {})) {
    for (const [raw, targets] of Object.entries(mapping || {})) {
      if (!Array.isArray(targets) || targets.length === 0) {
        problems.push(`来源映射 ${sourceName}/${raw} 没有目标`)
        continue
      }
      for (const t of targets) requireTarget(`来源映射 ${sourceName}/${raw}`, t)
    }
  }
  for (const [kind, target] of Object.entries(doc.kindMappings || {})) {
    requireTarget(`制作方式映射 ${kind}`, target)
  }

  if (problems.length) {
    throw new Error(`分类词表校验失败：\n- ${problems.slice(0, 20).join('\n- ')}`)
  }
  return true
}

/** 构建查询索引：轴、轴内值、轴内别名（含中文名/英文名/token） */
function buildIndex(doc) {
  const axes = []
  const axisById = new Map()
  for (const axis of doc.axes) {
    const values = []
    const valueById = new Map()
    const terms = []
    for (const v of axis.values) {
      const entry = {
        id: v.id,
        cn: v.cn,
        en: v.en,
        token: v.token,
        aliases: Array.isArray(v.aliases) ? v.aliases : [],
        mapsToSize: v.mapsToSize || '',
        mapsToMove: v.mapsToMove || '',
      }
      values.push(entry)
      valueById.set(entry.id, entry)
      for (const term of [entry.cn, entry.en, entry.token, ...entry.aliases]) {
        const k = norm(term)
        if (k) terms.push({ term: k, value: entry.id, ascii: isAscii(k) })
      }
    }
    // 长词优先：否则「雨」会先吃掉「雨夜」，「特写」会先吃掉「大特写」
    terms.sort((a, b) => b.term.length - a.term.length)
    const axisEntry = { id: axis.id, cn: axis.cn, en: axis.en, order: axis.order, values, valueById, terms }
    axes.push(axisEntry)
    axisById.set(axisEntry.id, axisEntry)
  }
  axes.sort((a, b) => (a.order || 0) - (b.order || 0))

  const sizeToValue = new Map()
  const moveToValue = new Map()
  for (const axis of axes) {
    for (const v of axis.values) {
      if (axis.id === 'shot-size' && v.mapsToSize) sizeToValue.set(v.mapsToSize, v.id)
      if (axis.id === 'camera-move' && v.mapsToMove) moveToValue.set(v.mapsToMove, v.id)
    }
  }

  return {
    version: doc.version,
    limits: doc.limits || {},
    axes,
    axisById,
    sizeToValue,
    moveToValue,
    sourceMappings: doc.sourceMappings || {},
    kindMappings: doc.kindMappings || {},
  }
}

/** 词表位置：优先 appRoot 下的随包资源，找不到就回落到模块所在仓库 */
function taxonomyFile(appRoot) {
  const local = taxonomyPath(appRoot || MODULE_ROOT)
  if (fs.existsSync(local)) return local
  return taxonomyPath(MODULE_ROOT)
}

/**
 * 加载并校验词表；同一个路径只解析一次（词表随包发布，运行期不会变）。
 *
 * appRoot 常常是「项目库目录」（如 ~/projects）而不是应用根，所以不能假设
 * 词表一定在它下面；两处都找不到才算缺失。
 */
export function loadTaxonomy(appRoot) {
  const file = taxonomyFile(appRoot)
  if (cached && cachedPath === file) return cached
  if (!fs.existsSync(file)) throw new Error(`分类词表缺失：${TAXONOMY_REL_PATH}`)
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`分类词表不是合法 JSON：${e?.message || e}`)
  }
  validateTaxonomy(doc)
  cached = buildIndex(doc)
  cachedPath = file
  return cached
}

/** 测试用：换词表或换根目录后清缓存 */
export function clearTaxonomyCache() {
  cached = null
  cachedPath = ''
}

/** 仓库内置词表（预览等没有 appRoot 的场景） */
export function loadDefaultTaxonomy() {
  return loadTaxonomy(MODULE_ROOT)
}

/** 直接吃一个已解析的词表对象（测试与 fixture 用） */
export function buildTaxonomyFromDoc(doc) {
  validateTaxonomy(doc)
  return buildIndex(doc)
}

export function taxonomyVersion(taxonomy) {
  return taxonomy?.version || ''
}

/** 供接口与前端展示：轴 + 值 + 计数 */
export function listTaxonomy(taxonomy) {
  return {
    version: taxonomy.version,
    axes: taxonomy.axes.map((axis) => ({
      id: axis.id,
      cn: axis.cn,
      en: axis.en,
      order: axis.order,
      values: axis.values.map((v) => ({ id: v.id, cn: v.cn, en: v.en, token: v.token })),
    })),
  }
}

/**
 * 把一个原始写法归一成轴内的值 id。
 * 只做词表内匹配（值 id / 中文名 / 英文名 / token / 别名），不猜。
 */
export function normalizeFacetValue(taxonomy, axisId, raw) {
  const axis = taxonomy.axisById.get(String(axisId || '').trim())
  if (!axis) return ''
  const key = norm(raw)
  if (!key) return ''
  if (axis.valueById.has(key)) return key
  for (const t of axis.terms) {
    if (t.term === key) return t.value
  }
  return ''
}

export function getFacetValue(taxonomy, axisId, valueId) {
  return taxonomy.axisById.get(String(axisId || ''))?.valueById.get(String(valueId || '')) || null
}

/**
 * 校验一批 `axis:value`。返回合法的与不合法的两组：
 * 非法项要能原地报给用户，而不是静默丢成「忽略该条件」。
 */
export function validateFacetPairs(taxonomy, pairs) {
  const valid = []
  const invalid = []
  const seen = new Set()
  for (const raw of Array.isArray(pairs) ? pairs : []) {
    const text = String(raw ?? '').trim()
    if (!text) continue
    const idx = text.indexOf(':')
    const axisId = idx > 0 ? text.slice(0, idx) : ''
    const valueRaw = idx > 0 ? text.slice(idx + 1) : ''
    const axis = taxonomy.axisById.get(axisId)
    if (!axis) {
      invalid.push({ raw: text, reason: `未知分类轴：${axisId || '(空)'}` })
      continue
    }
    const valueId = normalizeFacetValue(taxonomy, axisId, valueRaw)
    if (!valueId) {
      invalid.push({ raw: text, reason: `「${axis.cn}」没有这个值：${valueRaw || '(空)'}` })
      continue
    }
    const key = `${axisId}:${valueId}`
    if (seen.has(key)) continue
    seen.add(key)
    valid.push({ axis: axisId, value: valueId, raw: text })
  }
  return { valid, invalid }
}

/** 按轴分组，给查询层直接用：[{axis, values:[]}] */
export function groupFacetPairs(validPairs) {
  const map = new Map()
  for (const p of validPairs) {
    if (!map.has(p.axis)) map.set(p.axis, [])
    map.get(p.axis).push(p.value)
  }
  return [...map.entries()].map(([axis, values]) => ({ axis, values }))
}

/** 外部分类 → 分面。映射不到的值以未映射行返回，原文保留 */
export function mapSourceCategories(taxonomy, sourceId, categories) {
  const table = taxonomy.sourceMappings[String(sourceId || '')] || {}
  const out = []
  const unmapped = []
  for (const raw of Array.isArray(categories) ? categories : []) {
    const text = String(raw ?? '').trim()
    if (!text) continue
    const targets = table[text] || table[text.toLowerCase()]
    if (!targets || !targets.length) {
      unmapped.push(text)
      continue
    }
    for (const pair of targets) {
      const idx = pair.indexOf(':')
      const axis = pair.slice(0, idx)
      const value = pair.slice(idx + 1)
      if (taxonomy.axisById.get(axis)?.valueById.has(value)) out.push({ axis, value, raw: text })
    }
  }
  return { mapped: out, unmapped }
}

/** 反推的制作方式 → style-medium 分面 */
export function mapReverseKind(taxonomy, kind) {
  const pair = taxonomy.kindMappings[String(kind || '').trim()]
  if (!pair) return null
  const idx = pair.indexOf(':')
  const axis = pair.slice(0, idx)
  const value = pair.slice(idx + 1)
  if (!taxonomy.axisById.get(axis)?.valueById.has(value)) return null
  return { axis, value, raw: String(kind) }
}

function textOf(caseRow) {
  const tags = Array.isArray(caseRow?.tags) ? caseRow.tags.join(' ') : ''
  return `${caseRow?.title || ''} ${caseRow?.prompt || ''} ${tags}`.toLowerCase()
}

/**
 * 推导用的最短别名。
 *
 * 单字中文别名在子串匹配下等于把整段文本变成噪声源：「走」吃掉「走廊」、
 * 「火」吃掉「火车」、「书」吃掉「书架」。这些值在词表里都另有 2 字以上的
 * 别名（走/行走、火/火焰、书/书本），所以推导时丢掉单字别名几乎无损。
 * 单字仍留在词表里，人工新增分面时照样可选。
 */
const MIN_CN_TERM_LEN = 2
/** 同理：`CU`/`MS`/`WS`/`LS` 这类缩写只该给人工用，不该参与文本猜测 */
const MIN_ASCII_TERM_LEN = 3

function derivableTerm(t) {
  if (t.ascii) return t.term.replace(/-/g, '').length >= MIN_ASCII_TERM_LEN
  return t.term.length >= MIN_CN_TERM_LEN
}

/**
 * 英文按词边界、中文按子串；返回每个值命中的最长词长度与次数，用于排序。
 *
 * 同一轴内做位置占位：`大特写` 命中后，它覆盖范围内的 `特写` 不再计数，
 * 否则长短词会把两个值同时推出去。跨轴**不**占位——`一镜到底` 既是叙事结构
 * 也是剪辑节奏，两边都该有；按位置全局抢占会丢掉其中一个轴。
 */
function matchTerms(axis, text) {
  const hits = new Map()
  /** 已被更长别名占用的字符位置，避免短词在长词内部重复计数 */
  const taken = new Uint8Array(text.length)
  for (const t of axis.terms) {
    if (!derivableTerm(t)) continue
    let count = 0
    if (t.ascii) {
      const esc = t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // 用前后瞻而不是消费边界字符：否则「pan pan」第二处会因分隔符被吃掉而漏计
      const re = new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, 'g')
      for (const m of text.matchAll(re)) {
        const at = m.index
        if (taken[at]) continue
        for (let i = at; i < at + t.term.length; i += 1) taken[i] = 1
        count += 1
      }
    } else {
      let from = 0
      while (true) {
        const at = text.indexOf(t.term, from)
        if (at < 0) break
        from = at + t.term.length
        let free = true
        for (let i = at; i < at + t.term.length; i += 1) {
          if (taken[i]) {
            free = false
            break
          }
        }
        if (!free) continue
        for (let i = at; i < at + t.term.length; i += 1) taken[i] = 1
        count += 1
      }
    }
    if (!count) continue
    const prev = hits.get(t.value)
    if (!prev || t.term.length > prev.len) hits.set(t.value, { len: t.term.length, count })
  }
  return hits
}

/**
 * 推导分面。
 *
 * 顺序固定：来源映射 → 字段枚举（景别/运镜）→ 反推制作方式 → 文本别名匹配。
 * 已有 import / manual 的轴直接跳过：事实来源比文本猜测可信，且人工修正不该被冲掉。
 *
 * @param caseRow 案例行（title/prompt/tags/size/move/kind/category/categories）
 * @param taxonomy loadTaxonomy 的结果
 * @param options { reservedAxes?: Set<string> } 已有可信来源、不再推导的轴
 */
export function deriveFacets(taxonomy, caseRow = {}, options = {}) {
  const reserved = options.reservedAxes instanceof Set ? options.reservedAxes : new Set()
  const limits = taxonomy.limits || {}
  const defaultCap = Number(limits.perAxis) || 6
  const genreCap = Number(limits.genre) || 8
  const unmappedAxis = limits.unmappedAxis || 'genre'

  const byAxis = new Map()
  /**
   * `allowUnknown` 只给未映射分类用：它的值本来就不在词表里，是「原文保留」，
   * 不能套用词表校验，否则未映射信息会被静默丢掉——那正是这次要修的问题。
   */
  const push = (axis, value, source = 'derived', extra = {}, allowUnknown = false) => {
    if (!axis || !value) return
    if (reserved.has(axis)) return
    if (!allowUnknown && !taxonomy.axisById.get(axis)?.valueById.has(value)) return
    if (!byAxis.has(axis)) byAxis.set(axis, new Map())
    const bucket = byAxis.get(axis)
    const key = `${value}`
    if (!bucket.has(key)) bucket.set(key, { axis, value, source, ...extra })
  }

  // 1) 来源分类：外部导入时最可靠的信号
  const sourceCats = Array.isArray(caseRow.categories) ? caseRow.categories : []
  if (sourceCats.length && caseRow.source) {
    const { mapped, unmapped } = mapSourceCategories(taxonomy, caseRow.source, sourceCats)
    for (const m of mapped) push(m.axis, m.value, 'import')
    for (const raw of unmapped) push(unmappedAxis, raw, 'import', { unmapped: true, raw }, true)
  } else if (caseRow.category) {
    // 手工/反推案例的分类也常来自 vflow 词表：没有专属映射表时回落到 vflow
    const mapSource = taxonomy.sourceMappings[caseRow.source] ? caseRow.source : 'vflow'
    const hit = mapSourceCategories(taxonomy, mapSource, [caseRow.category])
    for (const m of hit.mapped) push(m.axis, m.value, 'import')
    // 只有 category 字段时也要保留未映射原文：回填脚本读的就是这一列
    for (const raw of hit.unmapped) push(unmappedAxis, raw, 'import', { unmapped: true, raw }, true)
  }

  // 2) 字段枚举：画布上选的景别/运镜就是事实
  const sizeValue = taxonomy.sizeToValue.get(String(caseRow.size || '').trim())
  if (sizeValue) push('shot-size', sizeValue, 'import')
  const moveValue = taxonomy.moveToValue.get(String(caseRow.move || '').trim())
  if (moveValue) push('camera-move', moveValue, 'import')

  // 3) 反推案例的逐镜制作方式
  const kinds = new Set()
  if (caseRow.kind) kinds.add(String(caseRow.kind))
  if (Array.isArray(caseRow.shots)) {
    for (const shot of caseRow.shots) {
      if (shot?.kind) kinds.add(String(shot.kind))
    }
  }
  for (const kind of kinds) {
    const m = mapReverseKind(taxonomy, kind)
    if (m) push(m.axis, m.value, 'import')
  }

  // 4) 文本别名匹配：只用于还没有该轴取值的轴
  const text = textOf(caseRow)
  if (text.trim()) {
    for (const axis of taxonomy.axes) {
      if (reserved.has(axis.id)) continue
      const hits = matchTerms(axis, text)
      if (!hits.size) continue
      const cap = axis.id === 'genre' ? genreCap : defaultCap
      const sorted = [...hits.entries()]
        .sort((a, b) => b[1].len - a[1].len || b[1].count - a[1].count)
        .slice(0, cap)
      for (const [value] of sorted) push(axis.id, value, 'derived')
    }
  }

  const out = []
  for (const bucket of byAxis.values()) out.push(...bucket.values())
  return out
}

/** 分面行按轴分组，供详情展示 */
export function groupFacetsByAxis(taxonomy, facets) {
  const map = new Map()
  for (const f of Array.isArray(facets) ? facets : []) {
    if (!map.has(f.axis)) map.set(f.axis, [])
    map.get(f.axis).push(f)
  }
  return taxonomy.axes
    .filter((axis) => map.has(axis.id))
    .map((axis) => ({ axis: axis.id, cn: axis.cn, values: map.get(axis.id) }))
}
