import type { TransitionDirection, TransitionEffect, TransitionEffectType } from './types'

export type TransitionPresetCategory = 'classic' | 'rhythm' | 'geometry' | 'motion'

export type TransitionPresetDef = {
  id: string
  label: string
  category: TransitionPresetCategory
  /** FFmpeg xfade transition= 名 */
  xfade: string
  legacyType: TransitionEffectType
  /** 方向型预设固定方向；无方向则省略 */
  legacyDir?: TransitionDirection
}

/** 登记的效果预设；导出只接受此表中的 xfade 名 */
export const TRANSITION_PRESETS: TransitionPresetDef[] = [
  { id: 'dissolve', label: '叠化', category: 'classic', xfade: 'fade', legacyType: 'dissolve' },
  { id: 'fadeblack', label: '黑场', category: 'rhythm', xfade: 'fadeblack', legacyType: 'dissolve' },
  { id: 'fadewhite', label: '白闪', category: 'rhythm', xfade: 'fadewhite', legacyType: 'dissolve' },
  { id: 'fadegrays', label: '灰场', category: 'rhythm', xfade: 'fadegrays', legacyType: 'dissolve' },
  { id: 'fadeslow', label: '慢叠', category: 'classic', xfade: 'fadeslow', legacyType: 'dissolve' },
  { id: 'fadefast', label: '快切叠', category: 'classic', xfade: 'fadefast', legacyType: 'dissolve' },
  { id: 'wipe-left', label: '擦除←', category: 'motion', xfade: 'wipeleft', legacyType: 'wipe', legacyDir: 'left' },
  { id: 'wipe-right', label: '擦除→', category: 'motion', xfade: 'wiperight', legacyType: 'wipe', legacyDir: 'right' },
  { id: 'wipe-up', label: '擦除↑', category: 'motion', xfade: 'wipeup', legacyType: 'wipe', legacyDir: 'up' },
  { id: 'wipe-down', label: '擦除↓', category: 'motion', xfade: 'wipedown', legacyType: 'wipe', legacyDir: 'down' },
  { id: 'slide-left', label: '推移←', category: 'motion', xfade: 'slideleft', legacyType: 'slide', legacyDir: 'left' },
  { id: 'slide-right', label: '推移→', category: 'motion', xfade: 'slideright', legacyType: 'slide', legacyDir: 'right' },
  { id: 'slide-up', label: '推移↑', category: 'motion', xfade: 'slideup', legacyType: 'slide', legacyDir: 'up' },
  { id: 'slide-down', label: '推移↓', category: 'motion', xfade: 'slidedown', legacyType: 'slide', legacyDir: 'down' },
  { id: 'smooth-left', label: '柔顺←', category: 'motion', xfade: 'smoothleft', legacyType: 'slide', legacyDir: 'left' },
  { id: 'smooth-right', label: '柔顺→', category: 'motion', xfade: 'smoothright', legacyType: 'slide', legacyDir: 'right' },
  { id: 'radial', label: '径向', category: 'geometry', xfade: 'radial', legacyType: 'dissolve' },
  { id: 'distance', label: '距离溶解', category: 'geometry', xfade: 'distance', legacyType: 'dissolve' },
  { id: 'circleopen', label: '圆开', category: 'geometry', xfade: 'circleopen', legacyType: 'dissolve' },
  { id: 'circleclose', label: '圆合', category: 'geometry', xfade: 'circleclose', legacyType: 'dissolve' },
  { id: 'circlecrop', label: '圆裁', category: 'geometry', xfade: 'circlecrop', legacyType: 'dissolve' },
  { id: 'squeezeh', label: '横向挤压', category: 'geometry', xfade: 'squeezeh', legacyType: 'dissolve' },
  { id: 'squeezev', label: '纵向挤压', category: 'geometry', xfade: 'squeezev', legacyType: 'dissolve' },
  { id: 'pixelize', label: '像素化', category: 'geometry', xfade: 'pixelize', legacyType: 'dissolve' },
  { id: 'zoomin', label: '变焦', category: 'geometry', xfade: 'zoomin', legacyType: 'dissolve' },
  { id: 'diag-tl', label: '斜角↖', category: 'geometry', xfade: 'diagtl', legacyType: 'dissolve' },
  { id: 'hlwind', label: '横风', category: 'motion', xfade: 'hlwind', legacyType: 'dissolve' },
]

const BY_ID = new Map(TRANSITION_PRESETS.map((p) => [p.id, p]))

export function getTransitionPreset(id: string | undefined): TransitionPresetDef | undefined {
  const key = String(id || '').trim()
  return key ? BY_ID.get(key) : undefined
}

export function resolveTransitionPreset(input?: Partial<TransitionEffect> | null): TransitionPresetDef {
  const hit = getTransitionPreset(input?.presetId)
  if (hit) return hit
  const type = input?.type ?? 'dissolve'
  const dir = input?.dir ?? 'left'
  if (type === 'wipe') {
    return BY_ID.get(`wipe-${dir}`) ?? BY_ID.get('dissolve')!
  }
  if (type === 'slide') {
    return BY_ID.get(`slide-${dir}`) ?? BY_ID.get('dissolve')!
  }
  return BY_ID.get('dissolve')!
}

export function isKnownXfadeName(name: string): boolean {
  return TRANSITION_PRESETS.some((p) => p.xfade === name)
}

export const PRESET_CATEGORY_LABEL: Record<TransitionPresetCategory, string> = {
  classic: '经典',
  rhythm: '节奏',
  geometry: '几何',
  motion: '方向',
}
