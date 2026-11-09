import recipes from './transitionRecipes.json'

export type TransitionTaxonomy = 'scene' | 'character' | 'space' | 'vfx' | 'camera' | 'ai_video'
export type TransitionModeHint = 'effect' | 'generated' | 'either'

export type TransitionRecipe = {
  id: string
  category: string
  title: string
  intent: string
  tags: string[]
  taxonomy?: TransitionTaxonomy
  modeHint?: TransitionModeHint
  seedanceHints?: string[]
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
  return ALL.filter(
    (r) =>
      r.id.toLowerCase().includes(needle) ||
      r.title.toLowerCase().includes(needle) ||
      r.intent.toLowerCase().includes(needle) ||
      r.tags.some((t) => t.toLowerCase().includes(needle)),
  )
}
