import type { ShotProdKind } from './shotProdKind'
import {
  PERFORMANCE_EMOTION_LABELS,
  type PerformanceEntry,
} from './types'

export type ShotInspectorTab = 'visual' | 'narrative' | 'outgoing' | 'audio' | 'meta'

/** 偏好里可能仍存旧 id */
export type LegacyShotInspectorTab = ShotInspectorTab | 'video' | 'more'

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
export const DEFAULT_INSPECTOR_WIDTH = 380
export const MIN_INSPECTOR_WIDTH = 320
export const MAX_INSPECTOR_WIDTH = 520

const TAB_PREFS: InspectorTabPreference[] = [
  'auto',
  'visual',
  'narrative',
  'outgoing',
  'audio',
  'meta',
  'video',
  'more',
]

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

function migrateTabPref(tab: unknown): InspectorTabPreference {
  if (tab === 'video') return 'outgoing'
  if (tab === 'more') return 'more'
  if (typeof tab === 'string' && TAB_PREFS.includes(tab as InspectorTabPreference)) {
    return tab as InspectorTabPreference
  }
  return 'auto'
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
    tab: migrateTabPref(raw.tab),
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

/** 生图镜默认画面 Tab；出片镜默认出片 Tab */
export function defaultTabForShot(prodKind: ShotProdKind, _hasImage: boolean): ShotInspectorTab {
  return prodKind === 'image' ? 'visual' : 'outgoing'
}

export function coerceShotTab(
  prodKind: ShotProdKind,
  pref: InspectorTabPreference,
  hasImage: boolean,
): ShotInspectorTab {
  let tab: ShotInspectorTab | 'more' =
    pref === 'auto'
      ? defaultTabForShot(prodKind, hasImage)
      : pref === 'more'
        ? 'more'
        : (pref as ShotInspectorTab)
  if (pref === 'more') {
    tab = prodKind === 'image' ? 'narrative' : 'meta'
  }
  const allowedImage: ShotInspectorTab[] = ['visual', 'narrative']
  const allowedVideo: ShotInspectorTab[] = ['outgoing', 'audio', 'meta']
  const allowed = prodKind === 'image' ? allowedImage : allowedVideo
  if (!allowed.includes(tab as ShotInspectorTab)) {
    tab = defaultTabForShot(prodKind, hasImage)
  }
  return tab as ShotInspectorTab
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

const MODE_LABEL: Record<string, string> = {
  first: '首帧',
  ref: '多参考图',
  video: '参考视频',
  native: '原生音频',
}

export function shotReadinessSummary(input: {
  mode?: string
  blocking?: string
  warning?: string
}): string {
  if (input.blocking) return input.blocking
  if (input.warning) return input.warning
  return `${MODE_LABEL[input.mode || 'ref'] ?? '出片'} · 可提交`
}

export function shotStatusChips(input: {
  prodKind: ShotProdKind
  hasImage: boolean
  candidateCount: number
  hasVideo: boolean
  seconds: number
  promptSource?: 'auto' | 'override'
  promptStale?: boolean
  nativeAudio?: boolean
  refCount?: number
}): ShotStatusChip[] {
  if (input.prodKind === 'image') {
    return [
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
    ]
  }
  const chips: ShotStatusChip[] = [
    {
      id: 'refs',
      label: `参考 ${input.refCount ?? 0}`,
      tone: (input.refCount ?? 0) > 0 ? 'ok' : 'muted',
      tab: 'outgoing',
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
      tab: 'outgoing',
    },
    {
      id: 'video',
      label: `成片 ${input.hasVideo ? `${Math.max(1, Math.round(input.seconds))}s` : '未出'}`,
      tone: input.hasVideo ? 'ok' : 'muted',
      tab: 'outgoing',
    },
  ]
  if (input.nativeAudio) {
    chips.push({
      id: 'native',
      label: '原生音频',
      tone: 'ok',
      tab: 'audio',
    })
  }
  return chips
}
