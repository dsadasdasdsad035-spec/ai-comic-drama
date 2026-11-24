/**
 * 提示词写作指南的客户端读取。
 *
 * 为什么运行时 fetch 而不是构建期 import：
 * 快照 320KB，正文占比高。`import` 会把它打进主 bundle，任何打开素材页的人
 * 都要下载；`fetch` 只在切到指南 Tab 时拉一次（浏览器缓存）。
 *
 * 生产环境由 `server/index.mjs` 的静态层服务 `/presets/`（`STATIC_PUBLIC_DIRS`
 * 里已有 `presets`），dev 下由 Vite 的 public 目录直出。两条路径都能取到。
 */

export type PromptGuideSource = {
  id: string
  url: string
  title: string
  fetchedAt: string
}

/** 配方型（模板 A）的结构化参数 */
export type GuideSettings = Record<string, string>

export type PromptGuide = {
  id: string
  sourceId: string
  title: string
  /** `axis:value` 列表；与案例库分面同一套语法 */
  facets: string[]

  /** 模板 A：Settings 原文与结构化结果 */
  settingsText: string
  settings: GuideSettings
  /** 模板 A：为什么这样组合 */
  rationale: string

  /** 模板 B：这个配方做什么、需要哪些输入、作者提示 */
  whatItDoes: string
  inputs: string
  proTip: string

  /** 模板 C：错在哪 / 为什么错 / 怎么改 */
  mistake: string
  why: string
  fix: string

  /** 模板 D：诊断句 + 坏示范 + 好示范 */
  diagnosis: string
  badPrompt: string
  goodPrompt: string

  /** 推荐正文（对照型取 goodPrompt） */
  prompt: string
  /** 时间轴分段 */
  segments: Array<{ label: string; body: string }>
  /** 该节去掉营销块后的可读正文 */
  body: string
}

export type PromptGuideDoc = {
  schemaVersion: number
  version: string
  license: 'reference-only'
  note: string
  generatedBy: string
  taxonomyVersion: string
  sources: PromptGuideSource[]
  guides: PromptGuide[]
}

let cache: Promise<PromptGuideDoc> | null = null

/** 读取指南快照；失败时抛出可读错误，调用方展示为空态而非白屏 */
export function loadPromptGuides(): Promise<PromptGuideDoc> {
  if (cache) return cache
  cache = (async () => {
    const res = await fetch('/presets/prompt-guides/v1.json')
    if (!res.ok) throw new Error(`指南快照读取失败（HTTP ${res.status}）`)
    const doc = (await res.json()) as PromptGuideDoc
    if (!Array.isArray(doc?.guides)) throw new Error('指南快照结构不正确')
    return doc
  })().catch((e) => {
    // 失败不缓存，允许用户重试
    cache = null
    throw e
  })
  return cache
}

/** 测试用：清掉内存缓存 */
export function clearPromptGuideCache() {
  cache = null
}

/** 按轴分组：返回 `axisId → 该轴的指南列表`，轴序由调用方按词表决定 */
export function groupGuidesByAxis(guides: PromptGuide[]): Map<string, PromptGuide[]> {
  const map = new Map<string, PromptGuide[]>()
  for (const g of guides) {
    for (const key of g.facets) {
      const axis = key.slice(0, key.indexOf(':'))
      if (!axis) continue
      if (!map.has(axis)) map.set(axis, [])
      const list = map.get(axis)!
      if (!list.some((x) => x.id === g.id)) list.push(g)
    }
  }
  return map
}

/** 一条指南的「类型」：配方 / 变体 / 对照，决定详情用哪套字段渲染 */
export function guideKindOf(g: PromptGuide): 'recipe' | 'variant' | 'contrast' {
  if (g.badPrompt || g.goodPrompt) return 'contrast'
  if (g.settingsText) return 'recipe'
  return 'variant'
}
