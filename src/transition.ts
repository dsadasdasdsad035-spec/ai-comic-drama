import type {
  TransitionDirection,
  TransitionEffect,
  TransitionEffectType,
  TransitionOut,
} from './types'
import { getTransitionPreset, resolveTransitionPreset } from './transitionPresets'

/** 首次标记为转场时的默认接缝 */
export const DEFAULT_TRANSITION_SECONDS = 0.5
/** 效果转场下限；再短就退回硬切 */
export const MIN_EFFECT_SECONDS = 0.2
export const MAX_EFFECT_SECONDS = 1.5

export const DEFAULT_EFFECT: TransitionEffect = {
  type: 'dissolve',
  seconds: DEFAULT_TRANSITION_SECONDS,
}

const EFFECT_TYPES: TransitionEffectType[] = ['dissolve', 'wipe', 'slide']
const DIRECTIONS: TransitionDirection[] = ['left', 'right', 'up', 'down']

const round2 = (n: number) => Math.round(n * 100) / 100

export function defaultTransition(to: string): TransitionOut {
  return { to, mode: 'effect', effect: { ...DEFAULT_EFFECT } }
}

export function normalizeEffect(input?: Partial<TransitionEffect> | null): TransitionEffect {
  const seconds = Number(input?.seconds)
  const clamped = Number.isFinite(seconds)
    ? Math.min(MAX_EFFECT_SECONDS, Math.max(0, seconds))
    : DEFAULT_TRANSITION_SECONDS
  const rawPreset = String(input?.presetId || '').trim()
  const registered = getTransitionPreset(rawPreset)
  if (rawPreset && !registered) {
    return { type: 'dissolve', seconds: clamped, presetId: 'dissolve' }
  }
  const preset = registered ?? resolveTransitionPreset(input)
  const type = registered
    ? preset.legacyType
    : EFFECT_TYPES.includes(input?.type as TransitionEffectType)
      ? (input!.type as TransitionEffectType)
      : preset.legacyType
  const dir = preset.legacyDir
    ? preset.legacyDir
    : DIRECTIONS.includes(input?.dir as TransitionDirection)
      ? (input!.dir as TransitionDirection)
      : 'left'
  return {
    type,
    ...(preset.legacyDir || (type !== 'dissolve' && !registered) ? { dir: preset.legacyDir ?? dir } : {}),
    seconds: clamped,
    presetId: preset.id,
  }
}

/**
 * 全量归一化。旧存档里的生成配置（`generated`）在这里被剥离：
 * 读时忽略、写时不再产生，磁盘上的历史字段靠用户下一次改动自然清除。
 *
 * `mode` 为兼容旧存档保留——旧数据可能是已退役的生成模式，读取时一律
 * 解释为 effect；写入恒为 'effect'。`meta` 只做历史保留，不再参与失效判定。
 */
export function normalizeTransitionOut(input?: Partial<TransitionOut> | null, to = ''): TransitionOut {
  if (!input) return defaultTransition(to)
  return {
    to: String(input.to || to),
    mode: 'effect',
    effect: normalizeEffect(input.effect),
    ...(input.meta ? { meta: input.meta } : {}),
  }
}

/** 效果时长夹紧：短镜的 80%，上限 1.5s；不足下限返回 0（走硬切） */
export function clampEffectSeconds(seconds: number, aDur: number, bDur: number): number {
  const max = Math.min(MAX_EFFECT_SECONDS, Math.min(aDur, bDur) * 0.8)
  const next = Math.min(Math.max(0, Number(seconds) || 0), max)
  return next >= MIN_EFFECT_SECONDS ? round2(next) : 0
}

export function xfadeName(effect: TransitionEffect): string {
  const normalized = normalizeEffect(effect)
  const preset = getTransitionPreset(normalized.presetId) ?? resolveTransitionPreset(normalized)
  return preset.xfade
}

const ARROW: Record<TransitionDirection, string> = {
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
}

export function effectLabel(effect: TransitionEffect): string {
  const normalized = normalizeEffect(effect)
  const preset = getTransitionPreset(normalized.presetId)
  if (preset) return preset.label
  if (effect.type === 'wipe') return `擦除${ARROW[effect.dir || 'left']}`
  if (effect.type === 'slide') return `推移${ARROW[effect.dir || 'left']}`
  return '叠化'
}

export type JoinResolution =
  | { mode: 'cut'; reason?: 'short' }
  | {
      mode: 'effect'
      effect: TransitionEffect
      seconds: number
      xfade: string
    }

/**
 * 一条接缝配置在当前两侧时长下实际怎么渲染。
 * 生成转场已退役：旧数据里的 `generated` 不参与判定，只按 `effect` 解析。
 */
export function resolveJoin(t: TransitionOut | undefined, aDur: number, bDur: number): JoinResolution {
  const effect = normalizeEffect(t?.effect)
  const seconds = clampEffectSeconds(effect.seconds, aDur, bDur)
  if (seconds <= 0) return { mode: 'cut', reason: 'short' }
  return { mode: 'effect', effect, seconds, xfade: xfadeName(effect) }
}

/** chip 摘要：效果名 + 时长 */
export function transitionSummary(t: TransitionOut | undefined): string {
  const effect = normalizeEffect(t?.effect)
  return `${effectLabel(effect)} ${effect.seconds.toFixed(1)}s`
}
