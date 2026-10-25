import {
  PERFORMANCE_EMOTION_LABELS,
  type PerformanceEntry,
} from './types'

export type ShotInspectorTab = 'visual' | 'video' | 'audio' | 'more'
export type InspectorTabPreference = 'auto' | ShotInspectorTab
export type CollapsibleSection = 'shotParams' | 'performance' | 'schedule' | 'refs' | 'advanced'

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

const TABS: InspectorTabPreference[] = ['auto', 'visual', 'video', 'audio', 'more']
const SECTIONS: CollapsibleSection[] = ['shotParams', 'performance', 'schedule', 'refs', 'advanced']

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
    tab: TABS.includes(raw.tab as InspectorTabPreference)
      ? (raw.tab as InspectorTabPreference)
      : 'auto',
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

/** 有画面才能直接看出片提示词；没有画面先把人送到画面页 */
export function defaultTabForShot(hasImage: boolean): ShotInspectorTab {
  return hasImage ? 'video' : 'visual'
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
  voiceUrl?: string
  voiceSeconds?: number
  voiceOver?: boolean
  voiceStale?: boolean
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
      id: 'voice',
      label: `配音 ${
        input.voiceUrl ? `${(input.voiceSeconds ?? 0).toFixed(1)}s` : '未生成'
      }`,
      tone: input.voiceStale || input.voiceOver ? 'warn' : input.voiceUrl ? 'ok' : 'muted',
      tab: 'audio',
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
