import type { ShotData, TransitionEffect, TransitionGenerated, TransitionOut } from './types'
import {
  DEFAULT_TRANSITION_SECONDS,
  normalizeEffect,
  normalizeGenerated,
  transitionOverrideText,
} from './transition'
import { getTransitionPreset, TRANSITION_PRESETS } from './transitionPresets'
import { getTransitionRecipe, listTransitionRecipes } from './transitionRecipes'

export type TransitionSuggestion = {
  mode: 'effect' | 'generated'
  rationale: string
  effect?: { presetId: string; seconds: number }
  generated?: { prompt: string; soundPrompt?: string; recipeIds?: string[] }
}

function shotSize(data: ShotData): string {
  return String(data.visualBrief?.shotSize || data.size || '').trim()
}

function hasMotion(data: ShotData): boolean {
  const m = String(data.move || '').trim()
  return Boolean(m && m !== '固定')
}

function sizeRank(size: string): number {
  const s = size.toLowerCase()
  if (/远景|全景/.test(size)) return 1
  if (/中景/.test(size)) return 2
  if (/近景|特写/.test(size)) return 3
  if (s) return 2
  return 0
}

function boundaryLikely(source: ShotData, target: ShotData): boolean {
  return Boolean((source.videoUrl || source.refImage) && (target.videoUrl || target.refImage))
}

/** 规则型建议（无 LLM）；服务端与客户端共用 */
export function suggestTransition(input: {
  source: ShotData
  target: ShotData
  transitionOut?: TransitionOut | null
}): TransitionSuggestion {
  const g = normalizeGenerated(input.transitionOut?.generated)
  const aSize = shotSize(input.source)
  const bSize = shotSize(input.target)
  const rankDelta = Math.abs(sizeRank(aSize) - sizeRank(bSize))
  const sameScene =
    String(input.source.sceneSlug || '') === String(input.target.sceneSlug || '') &&
    Number(input.source.sceneNo || 0) === Number(input.target.sceneNo || 0) &&
    Boolean(input.source.sceneSlug || input.source.sceneNo)
  if (!sameScene && rankDelta >= 2) {
    const recipe = getTransitionRecipe('morph-weather') ?? listTransitionRecipes('transition')[0]
    return {
      mode: 'generated',
      rationale: '场次或空间跨度大、景别差明显，适合生成短过渡片衔接环境。',
      generated: {
        prompt: `${recipe?.title ?? '环境过渡'}：${recipe?.intent ?? '从上一镜自然过渡到下一镜'}`,
        soundPrompt: '环境声连续，无突兀静音',
        recipeIds: recipe ? [recipe.id] : [],
      },
    }
  }

  if (rankDelta >= 1 && boundaryLikely(input.source, input.target) && (hasMotion(input.source) || hasMotion(input.target))) {
    const recipe = getTransitionRecipe('match-cut-action') ?? listTransitionRecipes('transition')[0]
    const cam = getTransitionRecipe('push-in-bridge')
    return {
      mode: 'generated',
      rationale: '景别有递进且两镜有画面可抽首尾帧，建议生成过渡保留动作连续。',
      generated: {
        prompt: `${recipe?.title ?? '动作衔接'}：${recipe?.intent ?? ''}${cam ? `；参考运镜意图：${cam.intent}` : ''}`,
        recipeIds: [recipe?.id, cam?.id].filter(Boolean) as string[],
      },
    }
  }

  if (!hasMotion(input.source) && !hasMotion(input.target) && sameScene) {
    const preset = getTransitionPreset('dissolve')!
    return {
      mode: 'effect',
      rationale: '同场双镜固定机位，短叠化即可保持旁白连贯。',
      effect: { presetId: preset.id, seconds: DEFAULT_TRANSITION_SECONDS },
    }
  }

  if (rankDelta >= 2 || !sameScene) {
    const preset = getTransitionPreset('fadeblack')!
    const recipe = getTransitionRecipe('time-skip-fadeblack')
    const note = recipe ? `（可参考食谱 ${recipe.id}）` : ''
    return {
      mode: 'effect',
      rationale: `跨场或景别跨度大，可用黑场短接缝暗示时间跳跃。${note}`,
      effect: { presetId: preset.id, seconds: Math.min(0.6, DEFAULT_TRANSITION_SECONDS + 0.1) },
    }
  }

  const motionPreset =
    hasMotion(input.target) && input.target.move?.includes('推')
      ? getTransitionPreset('smooth-right')
      : getTransitionPreset('radial')
  return {
    mode: 'effect',
    rationale: '一般性衔接：轻度几何或方向预设，不打断叙事节奏。',
    effect: { presetId: motionPreset!.id, seconds: DEFAULT_TRANSITION_SECONDS },
  }
}

export function applyTransitionSuggestion(
  suggestion: TransitionSuggestion,
  current: TransitionOut,
  opts: { preserveVideoPromptOverride: boolean },
): TransitionOut {
  if (suggestion.mode === 'effect' && suggestion.effect) {
    const preset = getTransitionPreset(suggestion.effect.presetId)
    const effect: TransitionEffect = normalizeEffect({
      presetId: preset ? suggestion.effect.presetId : 'dissolve',
      seconds: suggestion.effect.seconds,
    })
    return {
      ...current,
      mode: 'effect',
      effect,
      generated: normalizeGenerated(current.generated),
    }
  }
  const g = normalizeGenerated(current.generated)
  const gen = suggestion.generated
  if (!gen) return current
  return {
    ...current,
    mode: 'generated',
    generated: {
      ...g,
      bridging: 'morph',
      prompt: gen.prompt,
      ...(gen.soundPrompt ? { soundPrompt: gen.soundPrompt } : {}),
      ...(opts.preserveVideoPromptOverride && transitionOverrideText(g.videoPromptOverride)
        ? { videoPromptOverride: g.videoPromptOverride }
        : {}),
    },
  }
}

export function validateSuggestion(suggestion: TransitionSuggestion): TransitionSuggestion {
  if (suggestion.mode === 'effect' && suggestion.effect) {
    const id = suggestion.effect.presetId
    if (!getTransitionPreset(id)) {
      return {
        ...suggestion,
        effect: { ...suggestion.effect, presetId: 'dissolve' },
        rationale: `${suggestion.rationale}（无效预设已回退为叠化）`,
      }
    }
  }
  if (suggestion.generated?.recipeIds) {
    const recipeIds = suggestion.generated.recipeIds.filter((id) => getTransitionRecipe(id))
    return { ...suggestion, generated: { ...suggestion.generated, recipeIds } }
  }
  return suggestion
}

export const PRESET_COUNT = TRANSITION_PRESETS.length
