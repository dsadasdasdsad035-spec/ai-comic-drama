import type {
  BoundarySource,
  ShotData,
  TransitionBoundary,
  TransitionDirection,
  TransitionEffect,
  TransitionEffectType,
  TransitionGenerated,
  TransitionOut,
  VideoPromptOverride,
} from './types'
import { shortHash } from './scheduleGeometry'
import { localPath } from './shotSync'
import { getTransitionPreset, resolveTransitionPreset } from './transitionPresets'

/** 首次标记为转场时的默认接缝 */
export const DEFAULT_TRANSITION_SECONDS = 0.5
/** 效果转场下限；再短就退回硬切 */
export const MIN_EFFECT_SECONDS = 0.2
export const MAX_EFFECT_SECONDS = 1.5
/** 生成片段两端与相邻镜头重叠的短叠化 */
export const GENERATED_FADE_SECONDS = 0.2
export const MIN_GENERATED_FADE = 0.1
export const MAX_GENERATED_FADE = 0.25
export const DEFAULT_GENERATED_SECONDS = 1.2
export const MIN_GENERATED_TARGET = 0.8
/** 与分镜出片 /api/seedance 上限一致 */
export const MAX_GENERATED_TARGET = 12

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

export function coerceTransitionVideoPromptOverride(input: unknown): VideoPromptOverride | undefined {
  if (input == null) return undefined
  if (typeof input === 'string') {
    const text = input.trim()
    if (!text) return undefined
    return { text, fingerprint: '', createdAt: new Date(0).toISOString() }
  }
  if (typeof input === 'object' && input && 'text' in input) {
    const raw = input as VideoPromptOverride
    const text = String(raw.text || '').trim()
    if (!text) return undefined
    return {
      text,
      fingerprint: String(raw.fingerprint || ''),
      createdAt: String(raw.createdAt || new Date().toISOString()),
    }
  }
  return undefined
}

export function transitionOverrideText(override: VideoPromptOverride | undefined): string {
  return override?.text?.trim() ?? ''
}

const BOUNDARY_SOURCES: BoundarySource[] = [
  'source-frame',
  'target-frame',
  'source-tail',
  'target-head',
  'library',
  'manual',
]

/** 边界来源只在枚举内保留；旧数据无字段时留空，由展示层给中性文案 */
function normalizeBoundary(input?: Partial<TransitionBoundary> | null): TransitionBoundary | undefined {
  if (!input) return undefined
  const out = String(input.out || '').trim()
  const inn = String(input.in || '').trim()
  const outFrom = BOUNDARY_SOURCES.includes(input.outFrom as BoundarySource)
    ? (input.outFrom as BoundarySource)
    : undefined
  const inFrom = BOUNDARY_SOURCES.includes(input.inFrom as BoundarySource)
    ? (input.inFrom as BoundarySource)
    : undefined
  const outAt = Number.isFinite(Number(input.outAt)) ? Number(input.outAt) : undefined
  const inAt = Number.isFinite(Number(input.inAt)) ? Number(input.inAt) : undefined
  if (!out && !inn && outAt === undefined && inAt === undefined) return undefined
  return {
    ...(out ? { out } : {}),
    ...(inn ? { in: inn } : {}),
    ...(outFrom ? { outFrom } : {}),
    ...(inFrom ? { inFrom } : {}),
    ...(outAt !== undefined ? { outAt } : {}),
    ...(inAt !== undefined ? { inAt } : {}),
  }
}

/** 首/尾帧来源标签；未知来源用中性文案，不推断成抽帧 */
export function boundarySourceLabel(from?: BoundarySource): string {
  switch (from) {
    case 'source-frame':
      return '上镜画面'
    case 'target-frame':
      return '下镜画面'
    case 'source-tail':
      return '上镜尾帧'
    case 'target-head':
      return '下镜首帧'
    case 'library':
      return '媒体库'
    case 'manual':
      return '手填地址'
    default:
      return '已选画面'
  }
}

export function normalizeGenerated(input?: Partial<TransitionGenerated> | null): TransitionGenerated {
  const target = Number(input?.targetSeconds)
  const bridging = input?.bridging === 'keyframe' ? 'keyframe' : 'morph'
  const videoPromptOverride = coerceTransitionVideoPromptOverride(input?.videoPromptOverride)
  return {
    targetSeconds: Number.isFinite(target)
      ? Math.min(MAX_GENERATED_TARGET, Math.max(MIN_GENERATED_TARGET, target))
      : DEFAULT_GENERATED_SECONDS,
    prompt: String(input?.prompt || ''),
    soundPrompt: String(input?.soundPrompt || ''),
    ...(videoPromptOverride ? { videoPromptOverride } : {}),
    bridging,
    // 转场只认 generated.refIds 手动选择；忽略存档里的 inheritRefs
    inheritRefs: false,
    refIds: Array.isArray(input?.refIds) ? input!.refIds!.filter(Boolean) : [],
    excludeRefIds: Array.isArray(input?.excludeRefIds) ? input!.excludeRefIds!.filter(Boolean) : [],
    ...(normalizeBoundary(input?.boundary) ? { boundary: normalizeBoundary(input?.boundary) } : {}),
    ...(input?.keyframe ? { keyframe: input.keyframe } : {}),
    ...(input?.video ? { video: input.video } : {}),
    ...(input?.audioMode === 'native' ? { audioMode: 'native' as const } : {}),
    ...(input?.audioRef ? { audioRef: input.audioRef } : input?.audioRef === null ? { audioRef: null } : {}),
    ...(input?.audioMeta ? { audioMeta: input.audioMeta } : {}),
    ...(input?.taxonomy ? { taxonomy: input.taxonomy } : {}),
    ...(input?.recipeIds?.length ? { recipeIds: input.recipeIds } : {}),
    ...(input?.variantId ? { variantId: String(input.variantId) } : {}),
    ...(String(input?.renderedPrompt ?? '').trim()
      ? { renderedPrompt: String(input?.renderedPrompt).trim() }
      : {}),
    ...(input?.renderMeta ? { renderMeta: input.renderMeta } : {}),
  }
}

/** 全量归一化：保留效果与生成两套配置，缺省给叠化 */
export function normalizeTransitionOut(input?: Partial<TransitionOut> | null, to = ''): TransitionOut {
  if (!input) return defaultTransition(to)
  return {
    to: String(input.to || to),
    mode: input.mode === 'generated' ? 'generated' : 'effect',
    effect: normalizeEffect(input.effect),
    generated: normalizeGenerated(input.generated),
    ...(input.meta ? { meta: input.meta } : {}),
  }
}

/** 效果时长夹紧：短镜的 80%，上限 1.5s；不足下限返回 0（走硬切） */
export function clampEffectSeconds(seconds: number, aDur: number, bDur: number): number {
  const max = Math.min(MAX_EFFECT_SECONDS, Math.min(aDur, bDur) * 0.8)
  const next = Math.min(Math.max(0, Number(seconds) || 0), max)
  return next >= MIN_EFFECT_SECONDS ? round2(next) : 0
}

/** 生成片段两端叠化：不超过邻段 1/4、片段 1/3，范围 0.1~0.25s */
export function generatedFade(prevDur: number, clipDur: number): number {
  const f = Math.min(GENERATED_FADE_SECONDS, prevDur * 0.25, clipDur / 3)
  if (f < MIN_GENERATED_FADE) return 0
  return round2(Math.min(MAX_GENERATED_FADE, f))
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

/** 生成片段的成片时长：有裁剪取裁剪值，否则取实际生成时长 */
export function generatedClipSeconds(g: TransitionGenerated | undefined): number {
  const target = Number(g?.targetSeconds) || DEFAULT_GENERATED_SECONDS
  const raw = Number(g?.video?.trimTo) || Number(g?.video?.seconds) || target
  return Math.min(30, Math.max(0.4, round2(raw)))
}

export function transitionFingerprint(
  source: ShotData | undefined,
  target: ShotData | undefined,
  g: TransitionGenerated | undefined,
  effect?: TransitionEffect,
  styleRefTokens?: string[],
): string {
  const outSize = String(source?.visualBrief?.shotSize || source?.size || '').trim()
  const inSize = String(target?.visualBrief?.shotSize || target?.size || '').trim()
  const outMove = String(source?.move || '').trim()
  const inMove = String(target?.move || '').trim()
  const eff = normalizeEffect(effect)
  return shortHash(
    JSON.stringify({
      out: localPath(source?.refImage) ?? '',
      outVideo: localPath(source?.videoUrl) ?? '',
      in: localPath(target?.refImage) ?? '',
      inVideo: localPath(target?.videoUrl) ?? '',
      outSize,
      inSize,
      outMove,
      inMove,
      effectPreset: eff.presetId ?? '',
      effectSeconds: eff.seconds,
      keyframe: localPath(g?.keyframe?.image) ?? '',
      boundaryOut: localPath(g?.boundary?.out) ?? '',
      boundaryIn: localPath(g?.boundary?.in) ?? '',
      prompt: g?.prompt ?? '',
      sound: g?.soundPrompt ?? '',
      videoPromptOverride: transitionOverrideText(g?.videoPromptOverride),
      bridging: g?.bridging ?? 'morph',
      target: g?.targetSeconds ?? 0,
      model: g?.video?.modelKey ?? '',
      inheritRefs: g?.inheritRefs === true,
      excludeRefIds: [...(g?.excludeRefIds ?? [])].sort(),
      refIds: [...(g?.refIds ?? [])].sort(),
      styleRefTokens: styleRefTokens ?? [...(g?.refIds ?? [])].sort(),
      audioMode: g?.audioMode ?? 'off',
      audioRef: localPath(g?.audioRef?.url) ?? '',
    }),
  )
}

export type JoinResolution =
  | { mode: 'cut'; reason?: 'short' }
  | {
      mode: 'effect'
      effect: TransitionEffect
      seconds: number
      xfade: string
      /** 生成模式还没出片，临时按效果兜底 */
      fallbackFromGenerated?: boolean
    }
  | {
      mode: 'generated'
      effect: TransitionEffect
      seconds: number
      video: string
      trimTo?: number
      stale: boolean
    }

/**
 * 一条转场配置在当前两侧时长下实际怎么渲染。
 * 生成模式没出片时回落到效果配置（默认叠化），不丢掉已填的参数。
 */
export function resolveJoin(
  t: TransitionOut | undefined,
  aDur: number,
  bDur: number,
  fingerprint?: string,
): JoinResolution {
  const effect = normalizeEffect(t?.effect)
  if (t?.mode === 'generated') {
    const g = normalizeGenerated(t.generated)
    const url = String(g.video?.url || '').trim()
    if (url) {
      return {
        mode: 'generated',
        effect,
        seconds: generatedClipSeconds(g),
        video: url,
        ...(g.video?.trimTo ? { trimTo: g.video.trimTo } : {}),
        stale: Boolean(t.meta?.fingerprint && fingerprint && t.meta.fingerprint !== fingerprint),
      }
    }
    const seconds = clampEffectSeconds(effect.seconds, aDur, bDur)
    if (seconds <= 0) return { mode: 'cut', reason: 'short' }
    return { mode: 'effect', effect, seconds, xfade: xfadeName(effect), fallbackFromGenerated: true }
  }
  const seconds = clampEffectSeconds(effect.seconds, aDur, bDur)
  if (seconds <= 0) return { mode: 'cut', reason: 'short' }
  return { mode: 'effect', effect, seconds, xfade: xfadeName(effect) }
}

/** 生成转场是否已出片 */
export function hasGeneratedVideo(t: TransitionOut | undefined): boolean {
  return Boolean(t?.mode === 'generated' && t.generated?.video?.url)
}

/** chip 摘要：效果名 + 时长；生成模式显示生成时长 */
export function transitionSummary(t: TransitionOut | undefined): string {
  if (t?.mode === 'generated') {
    const g = normalizeGenerated(t.generated)
    if (g.video?.url) return `生成 ${generatedClipSeconds(g).toFixed(1)}s`
    return `${effectLabel(normalizeEffect(t.effect))} ${normalizeEffect(t.effect).seconds.toFixed(1)}s`
  }
  const effect = normalizeEffect(t?.effect)
  return `${effectLabel(effect)} ${effect.seconds.toFixed(1)}s`
}
