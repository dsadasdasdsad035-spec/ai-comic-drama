/** 案例来源：外部导入 / 手工录入 / 自有片反推 */
export type PromptCaseSource = 'vflow' | 'apiko' | 'higgsfield' | 'manual' | 'reverse-own'

/** 许可口径：服务端按来源强制，前端只读 */
export type PromptCaseLicense = 'own' | 'reference-only'

/** 反推案例的逐镜结构（与 server/rea-video.mjs 的 parseBreakdown 对齐） */
export type PromptCaseShot = {
  index: number
  start: number
  end: number
  duration: number
  /** 制作方式原始值（rea-video 的 label） */
  kind: string
  /** 中文标签；未知分类显示为「未知（原值）」 */
  kindLabel: string
  /** true 表示落不在固定分类集合里，按未知保留原值 */
  unknownKind: boolean
  confidence: number | null
  decidedBy: string
  /** 判定依据（来自工具测量与视觉复核） */
  evidence: string[]
  keyframePrompt: string
  videoPrompt: string
  videoPromptEn: string
  /** 两段提示词都缺时为 true：这镜需要人工补写 */
  promptMissing: boolean
  /** 复刻路线（rea-video 的 replication.route，不是提示词） */
  remakeRoute: string[]
  remakeExecutor: string
  remakeNote: string
  remakeRule: string
  /** 站内可读的证据帧地址；空数组表示证据缺失 */
  evidenceFrames: string[]
  evidenceMissing: boolean
  assets?: { sheet?: string; firstFrame?: string; lastFrame?: string }
}

/** 分面来源：自动推导 / 导入映射 / 人工修正 */
export type PromptCaseFacetSource = 'derived' | 'import' | 'manual'

export type PromptCaseFacet = {
  axis: string
  value: string
  source: PromptCaseFacetSource
  /** true 表示来源分类没有对应词表值，按原文保留 */
  unmapped: boolean
  suppressed: boolean
  taxonomyVersion: string
  updatedAt: string
}

export type FacetCount = { axis: string; value: string; count: number }
export type InvalidFacet = { raw: string; reason: string }

export type PromptCase = {
  id: string
  source: PromptCaseSource
  sourceId: string
  title: string
  prompt: string
  shots: PromptCaseShot[]
  model: string
  category: string
  tags: string[]
  videoUrl: string
  posterUrl: string
  author: string
  sourceUrl: string
  license: PromptCaseLicense
  note: string
  favorite: boolean
  createdAt: string
  updatedAt: string
  taxonomyVersion: string
  facets: PromptCaseFacet[] | null
}

/** 详情额外返回被隐藏的自动值，供「恢复」入口使用 */
export type PromptCaseDetail = PromptCase & { suppressedFacets?: PromptCaseFacet[] }

export type PromptCaseFacets = {
  total: number
  favorites: number
  bySource: Partial<Record<PromptCaseSource, number>>
  models: Array<{ model: string; count: number }>
  categories: Array<{ category: string; count: number }>
}

export type PromptCaseListResult = {
  cases: PromptCase[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: PromptCaseFacets
  facetCounts: FacetCount[]
  invalidFacets: InvalidFacet[]
  taxonomyVersion: string
}

export type PromptCaseQuery = {
  q?: string
  source?: string
  model?: string
  category?: string
  favorite?: boolean
  sort?: 'title' | ''
  page?: number
  pageSize?: number
  /** `axis:value`，同轴 OR、跨轴 AND */
  facets?: string[]
}

export type PromptCaseSourceInfo = {
  id: string
  label: string
  enabled: boolean
  reason: string
  note: string
}

/** 预览返回的条目摘要：不含正文，正文要提交后逐条抓 */
export type PromptCasePreviewItem = {
  id: string
  title: string
  author: string
  authorHandle: string
  model: string
  category: string
  tags: string[]
  aspect: string
  durationSec: number
  posterUrl: string
  videoUrl: string
  createdAt: string
  /** 索引行上的原始分类（多标签） */
  categories: string[]
  /** 预览阶段预映射到的轴值 */
  facets: Array<{ axis: string; value: string }>
  /** 词表里没有对应值的原始分类 */
  unmapped: string[]
}

export type PromptCasePreview = {
  source: string
  sourceLabel: string
  token: string
  total: number
  items: PromptCasePreviewItem[]
  models: string[]
  categories: string[]
  license: PromptCaseLicense
}

export type ReverseTier = {
  id: string
  label: string
  hint: string
  downloads: Array<{ name: string; mb: number }>
  downloadMb: number
}

export type VisionModelOption = {
  key: string
  label: string
  model: string
  provider: string
  /** 是否等于「默认路由 → 视觉」的当前选择 */
  isDefault: boolean
}

export type ReaHealth = {
  ok: boolean
  path: string | null
  reason: string
  message: string
  version: string
}

export type ReverseJob = {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  reason: string
  phase: string
  tier: string
  title: string
  videoUrl: string
  elapsedMs: number
  timeoutMs: number
  tail: string[]
  error: string | null
  vlm: string
  result: {
    shots: number
    vlmStatus: string
    vlmNote: string
    duration: number
    engine: string
    storyboardUrl: string
    /** 沙箱预览用的报告地址；空表示不可预览 */
    reportUrl: string
    /** 本次使用的视觉模型标签（不含 Key） */
    vlmModel: string
  } | null
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!res.ok || o.ok === false) {
    const err = new Error(String(o.message || `请求失败（HTTP ${res.status}）`)) as Error & { kind?: string }
    if (typeof o.kind === 'string') err.kind = o.kind
    throw err
  }
  return o
}

function facetParams(params: URLSearchParams, facets?: string[]) {
  for (const f of facets || []) {
    if (f) params.append('facet', f)
  }
}

export async function listPromptCases(query: PromptCaseQuery = {}): Promise<PromptCaseListResult> {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.source) params.set('source', query.source)
  if (query.model) params.set('model', query.model)
  if (query.category) params.set('category', query.category)
  if (query.favorite) params.set('favorite', '1')
  if (query.sort) params.set('sort', query.sort)
  if (query.page) params.set('page', String(query.page))
  if (query.pageSize) params.set('pageSize', String(query.pageSize))
  facetParams(params, query.facets)
  const res = await fetch(`/api/prompt-cases?${params.toString()}`)
  const j = await readJson(res)
  return {
    cases: Array.isArray(j.cases) ? (j.cases as PromptCase[]) : [],
    total: Number(j.total) || 0,
    page: Number(j.page) || 1,
    pageSize: Number(j.pageSize) || 24,
    totalPages: Number(j.totalPages) || 1,
    facets: (j.facets as PromptCaseFacets) ?? { total: 0, favorites: 0, bySource: {}, models: [], categories: [] },
    facetCounts: Array.isArray(j.facetCounts) ? (j.facetCounts as FacetCount[]) : [],
    invalidFacets: Array.isArray(j.invalidFacets) ? (j.invalidFacets as InvalidFacet[]) : [],
    taxonomyVersion: String(j.taxonomyVersion || ''),
  }
}

/** 按轴的骨架计数：覆盖案例数与用到的受控值个数（不是各值条数之和） */
export type FacetAxisCases = { axis: string; cases: number; values: number }

export async function listPromptCaseFacetCounts(
  query: PromptCaseQuery = {},
): Promise<{
  counts: FacetCount[]
  invalidFacets: InvalidFacet[]
  taxonomyVersion: string
  /** 旧服务端没有该字段；缺省时调用方按 counts 自行聚合值个数 */
  axisCases: FacetAxisCases[]
}> {
  const params = new URLSearchParams()
  if (query.q) params.set('q', query.q)
  if (query.source) params.set('source', query.source)
  if (query.model) params.set('model', query.model)
  if (query.category) params.set('category', query.category)
  if (query.favorite) params.set('favorite', '1')
  facetParams(params, query.facets)
  const res = await fetch(`/api/prompt-cases/facets?${params.toString()}`)
  const j = await readJson(res)
  return {
    counts: Array.isArray(j.counts) ? (j.counts as FacetCount[]) : [],
    invalidFacets: Array.isArray(j.invalidFacets) ? (j.invalidFacets as InvalidFacet[]) : [],
    taxonomyVersion: String(j.taxonomyVersion || ''),
    axisCases: Array.isArray(j.axisCases) ? (j.axisCases as FacetAxisCases[]) : [],
  }
}

export async function patchPromptCaseFacets(
  id: string,
  patch: { add?: string[]; remove?: string[]; restore?: string[] },
): Promise<PromptCaseDetail> {
  const res = await fetch(`/api/prompt-cases/${encodeURIComponent(id)}/facets`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJson(res)
  return j.case as PromptCaseDetail
}

export async function getPromptCase(id: string): Promise<PromptCaseDetail> {
  const res = await fetch(`/api/prompt-cases/${encodeURIComponent(id)}`)
  const j = await readJson(res)
  return j.case as PromptCaseDetail
}

export async function patchPromptCase(
  id: string,
  patch: { note?: string; favorite?: boolean },
): Promise<PromptCase> {
  const res = await fetch(`/api/prompt-cases/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJson(res)
  return j.case as PromptCase
}

export async function deletePromptCase(id: string): Promise<void> {
  const res = await fetch(`/api/prompt-cases/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await readJson(res)
}

export async function listPromptCaseSources(): Promise<PromptCaseSourceInfo[]> {
  const res = await fetch('/api/prompt-cases/sources')
  const j = await readJson(res)
  return Array.isArray(j.sources) ? (j.sources as PromptCaseSourceInfo[]) : []
}

export async function previewPromptCases(input: {
  source: string
  q?: string
  model?: string
  category?: string
  limit?: number
}): Promise<PromptCasePreview> {
  const res = await fetch('/api/prompt-cases/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, preview: true }),
  })
  return (await readJson(res)) as unknown as PromptCasePreview
}

export async function importPromptCases(input: {
  source: string
  token: string
  ids: string[]
}): Promise<{
  created: number
  updated: number
  imported: number
  facetsWritten: number
  failed: Array<{ id: string; message: string }>
}> {
  const res = await fetch('/api/prompt-cases/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, preview: false }),
  })
  const j = await readJson(res)
  return {
    created: Number(j.created) || 0,
    updated: Number(j.updated) || 0,
    imported: Number(j.imported) || 0,
    facetsWritten: Number(j.facetsWritten) || 0,
    failed: Array.isArray(j.failed) ? (j.failed as Array<{ id: string; message: string }>) : [],
  }
}

export async function getReverseHealth(opts: { bin?: string; force?: boolean } = {}): Promise<{
  health: ReaHealth
  tiers: ReverseTier[]
  visionModels: VisionModelOption[]
}> {
  const params = new URLSearchParams()
  if (opts.bin) params.set('bin', opts.bin)
  if (opts.force) params.set('force', '1')
  const res = await fetch(`/api/prompt-cases/reverse/health?${params.toString()}`)
  const j = await readJson(res)
  return {
    health: j.health as ReaHealth,
    tiers: Array.isArray(j.tiers) ? (j.tiers as ReverseTier[]) : [],
    visionModels: Array.isArray(j.visionModels) ? (j.visionModels as VisionModelOption[]) : [],
  }
}

export async function createReverseJob(input: {
  project: string
  videoUrl: string
  title?: string
  durationSec?: number
  tier?: string
  useVlm?: boolean
  /** 视觉模型键；空表示跟「默认路由 → 视觉」 */
  vlmModelKey?: string
}): Promise<ReverseJob> {
  const res = await fetch('/api/prompt-cases/reverse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson(res)
  return j.job as ReverseJob
}

export async function getReverseJob(id: string): Promise<ReverseJob> {
  const res = await fetch(`/api/prompt-cases/reverse/${encodeURIComponent(id)}`)
  const j = await readJson(res)
  return j.job as ReverseJob
}

export async function cancelReverseJob(id: string): Promise<ReverseJob> {
  const res = await fetch(`/api/prompt-cases/reverse/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const j = await readJson(res)
  return j.job as ReverseJob
}

export async function adoptReverseJob(id: string, title?: string): Promise<PromptCase> {
  const res = await fetch(`/api/prompt-cases/reverse/${encodeURIComponent(id)}/adopt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title || '' }),
  })
  const j = await readJson(res)
  return j.case as PromptCase
}
