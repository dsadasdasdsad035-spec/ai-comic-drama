import type { CanvasProdMode } from './canvasProdMode'
import {
  PERFORMANCE_EMOTION_LABELS,
  type PerformanceEntry,
} from './types'

export type ShotInspectorTab = 'visual' | 'video' | 'more'
/** @deprecated 偏好里可能仍存 audio，加载时映射到 more */
export type LegacyShotInspectorTab = ShotInspectorTab | 'audio'
export type InspectorTabPreference = 'auto' | LegacyShotInspectorTab
export type CollapsibleSection =
  | 'shotParams'
  | 'performance'
  | 'schedule'
  | 'refs'
  | 'advanced'
  | 'videoSettings'
  | 'motionPrompt'

export type InspectorPrefs = {
  width: number
  tab: InspectorTabPreference
  collapsed: Record<CollapsibleSection, boolean>
}

export type ShotStatusChip = {
  id: string
  label: string
  tone: 'ok' | 'warn' | 'muted'
  tab: ShotInspectorTab
}

export const INSPECTOR_PREFS_KEY = 'storyboard-inspector-v1'
export const DEFAULT_INSPECTOR_WIDTH = 360
export const MIN_INSPECTOR_WIDTH = 320
export const MAX_INSPECTOR_WIDTH = 520

const TABS: InspectorTabPreference[] = ['auto', 'visual', 'video', 'more']
const SECTIONS: CollapsibleSection[] = [
  'shotParams',
  'performance',
  'schedule',
  'refs',
  'advanced',
  'videoSettings',
  'motionPrompt',
]

export function defaultInspectorPrefs(): InspectorPrefs {
  return {
    width: DEFAULT_INSPECTOR_WIDTH,
    tab: 'auto',
    collapsed: {
      shotParams: true,
      performance: true,
      schedule: true,
      refs: false,
      advanced: true,
      // 出片设置只留一行摘要；运动提示词与正文重复，默认收起
      videoSettings: true,
      motionPrompt: true,
    },
  }
}

export function clampInspectorWidth(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_INSPECTOR_WIDTH
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(n)))
}

function normalizePrefs(input: unknown): InspectorPrefs {
  const base = defaultInspectorPrefs()
  if (!input || typeof input !== 'object') return base
  const raw = input as Record<string, unknown>
  const collapsedRaw =
    raw.collapsed && typeof raw.collapsed === 'object'
      ? (raw.collapsed as Record<string, unknown>)
      : {}
  const collapsed = { ...base.collapsed }
  for (const key of SECTIONS) {
    if (typeof collapsedRaw[key] === 'boolean') collapsed[key] = collapsedRaw[key] as boolean
  }
  return {
    width: clampInspectorWidth(raw.width),
    tab: (() => {
      const t = raw.tab as InspectorTabPreference
      if (t === 'audio') return 'more'
      return TABS.includes(t) ? t : 'auto'
    })(),
    collapsed,
  }
}

export function loadInspectorPrefs(): InspectorPrefs {
  try {
    const raw = localStorage.getItem(INSPECTOR_PREFS_KEY)
    return raw ? normalizePrefs(JSON.parse(raw)) : defaultInspectorPrefs()
  } catch {
    return defaultInspectorPrefs()
  }
}

export function saveInspectorPrefs(prefs: InspectorPrefs): void {
  try {
    localStorage.setItem(INSPECTOR_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* 隐私模式/localStorage 不可用时使用内存状态 */
  }
}

/** 出图模式先进画面；出片模式先进视频 */
export function defaultTabForShot(mode: CanvasProdMode, _hasImage: boolean): ShotInspectorTab {
  return mode === 'image' ? 'visual' : 'video'
}

export function coerceShotTab(
  mode: CanvasProdMode,
  pref: InspectorTabPreference,
  hasImage: boolean,
): ShotInspectorTab {
  let tab: ShotInspectorTab =
    pref === 'auto' ? defaultTabForShot(mode, hasImage) : pref === 'audio' ? 'more' : pref
  const allowed = mode === 'image' ? ['visual', 'more'] : ['video', 'more']
  if (!allowed.includes(tab)) tab = mode === 'image' ? 'visual' : 'video'
  return tab
}

export function performanceSummary(performance?: PerformanceEntry[]): string {
  const rows = (performance ?? [])
    .filter((entry) => entry.character)
    .slice(0, 3)
    .map(
      (entry) =>
        `${entry.character} · ${PERFORMANCE_EMOTION_LABELS[entry.emotion] ?? entry.emotion} · ${entry.intensity}`,
    )
  return rows.length ? rows.join(' / ') : '未设置'
}

export function shotStatusChips(input: {
  hasImage: boolean
  candidateCount: number
  hasVideo: boolean
  seconds: number
  promptSource?: 'auto' | 'override'
  promptStale?: boolean
  nativeAudio?: boolean
}): ShotStatusChip[] {
  const chips: ShotStatusChip[] = [
    {
      id: 'visual',
      label: `画面 ${
        input.hasImage
          ? input.candidateCount > 1
            ? `1/${input.candidateCount}`
            : 'OK'
          : '未出'
      }`,
      tone: input.hasImage ? 'ok' : 'muted',
      tab: 'visual',
    },
    {
      id: 'video',
      label: `视频 ${input.hasVideo ? `${Math.max(1, Math.round(input.seconds))}s` : '未出'}`,
      tone: input.hasVideo ? 'ok' : 'muted',
      tab: 'video',
    },
    {
      id: 'prompt',
      label: `提示词 ${
        input.promptSource === 'override'
          ? input.promptStale
            ? '旧快照'
            : '已手改'
          : '自动'
      }`,
      tone: input.promptStale ? 'warn' : 'muted',
      tab: 'video',
    },
  ]
  if (input.nativeAudio) {
    chips.push({
      id: 'native',
      label: '原生音频',
      tone: 'ok',
      tab: 'video',
    })
  }
  return chips
}
