import type { ShotProdKind } from './shotProdKind'

/** 生图镜：画面 / 叙事；出片镜：只有出片（参考槽位页） */
export type ShotInspectorTab = 'visual' | 'narrative' | 'outgoing'

/** 偏好里可能仍存旧 id：`audio` / `meta` / `more` 都并入出片页，`video` 是更早的旧名 */
export type LegacyShotInspectorTab = ShotInspectorTab | 'video' | 'more' | 'audio' | 'meta'

export type InspectorTabPreference = 'auto' | LegacyShotInspectorTab

export type CollapsibleSection = 'shotParams' | 'refs'

export type InspectorPrefs = {
  width: number
  tab: InspectorTabPreference
  collapsed: Record<CollapsibleSection, boolean>
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
  'video',
  'more',
  'audio',
  'meta',
]

const SECTIONS: CollapsibleSection[] = ['shotParams', 'refs']

export function defaultInspectorPrefs(): InspectorPrefs {
  return {
    width: DEFAULT_INSPECTOR_WIDTH,
    tab: 'auto',
    collapsed: {
      shotParams: true,
      refs: false,
    },
  }
}

export function clampInspectorWidth(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_INSPECTOR_WIDTH
  return Math.min(MAX_INSPECTOR_WIDTH, Math.max(MIN_INSPECTOR_WIDTH, Math.round(n)))
}

function migrateTabPref(tab: unknown): InspectorTabPreference {
  // 单页四槽位之后，原来能落到「声音 / 元数据 / 更多」的偏好一律归到出片页
  if (tab === 'video' || tab === 'more' || tab === 'audio' || tab === 'meta') return 'outgoing'
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
  const migrated = pref === 'auto' ? 'auto' : migrateTabPref(pref)
  if (migrated === 'auto') return defaultTabForShot(prodKind, hasImage)
  const allowed: ShotInspectorTab[] =
    prodKind === 'image' ? ['visual', 'narrative'] : ['outgoing']
  return allowed.includes(migrated as ShotInspectorTab)
    ? (migrated as ShotInspectorTab)
    : defaultTabForShot(prodKind, hasImage)
}
