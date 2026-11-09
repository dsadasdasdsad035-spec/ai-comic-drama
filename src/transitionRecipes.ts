import recipes from './transitionRecipes.json'

export type TransitionRecipe = {
  id: string
  category: string
  title: string
  intent: string
  tags: string[]
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
