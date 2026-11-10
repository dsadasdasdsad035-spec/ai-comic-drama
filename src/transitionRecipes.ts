import recipes from './transitionRecipes.json'

export type TransitionTaxonomy = 'scene' | 'character' | 'space' | 'vfx' | 'camera' | 'ai_video'
export type TransitionModeHint = 'effect' | 'generated' | 'either'
/** 能量等级；max = 全片能量顶点，一片只用一次。技法卡不设能量 */
export type TransitionEnergy = 'low' | 'mid' | 'mid-high' | 'high' | 'max'

/** 技法卡的多式选型；每式对应一类接缝 */
export type TransitionVariant = {
  id: string
  label: string
  /** 什么接缝该用这一式 */
  when: string
  /** 观众看到什么、为什么成立；写提示词时从这里取视觉机制 */
  principle: string
}

export type TransitionRecipe = {
  id: string
  category: string
  title: string
  intent: string
  tags: string[]
  taxonomy?: TransitionTaxonomy
  modeHint?: TransitionModeHint
  /** 可直接进提示词的完整句子；不是标签 */
  seedanceHints?: string[]
  /** 具体手法（默认）还是内含多式选型的技法卡 */
  kind?: 'concrete' | 'technique'
  /** 该用在哪类接缝 */
  whenToUse?: string
  /** 能量等级；缺省视为不占能量位 */
  energy?: TransitionEnergy
  /** 建议时长（秒）；上游帧数只取总时长 */
  durationHint?: number
  /** 视觉机制说明；提示词的核心素材 */
  principle?: string
  /** 技法卡的多式；concrete 卡为空 */
  variants?: TransitionVariant[]
  /** 已知坑；可直接转为负向约束 */
  pitfalls?: string[]
}

const ALL = recipes as TransitionRecipe[]

export function listTransitionRecipes(category?: string): TransitionRecipe[] {
  const c = String(category || '').trim()
  if (!c) return [...ALL]
  return ALL.filter((r) => r.category === c)
}

export function getTransitionRecipe(id: string): TransitionRecipe | undefined {
  return ALL.find((r) => r.id === id)
}

export function searchTransitionRecipes(q: string): TransitionRecipe[] {
  const needle = String(q || '').trim().toLowerCase()
  if (!needle) return [...ALL]
  const hit = (s?: string) => String(s || '').toLowerCase().includes(needle)
  return ALL.filter(
    (r) =>
      hit(r.id) ||
      hit(r.title) ||
      hit(r.intent) ||
      hit(r.whenToUse) ||
      hit(r.principle) ||
      r.tags.some((t) => hit(t)) ||
      (r.seedanceHints ?? []).some((h) => hit(h)) ||
      (r.pitfalls ?? []).some((p) => hit(p)),
  )
}

/** 技法卡的全部可选项；具体卡返回空数组 */
export function recipeVariants(recipe: TransitionRecipe): TransitionVariant[] {
  return recipe.variants ?? []
}
