import type { ShotProdKind } from './types'

export type CanvasProdMode = 'image' | 'video'

export const CANVAS_PROD_MODE_KEY = 'storyboard-canvas-prod-mode-v1'

export function loadCanvasProdMode(): CanvasProdMode {
  try {
    const v = localStorage.getItem(CANVAS_PROD_MODE_KEY)
    return v === 'video' ? 'video' : 'image'
  } catch {
    return 'image'
  }
}

export function saveCanvasProdMode(mode: CanvasProdMode): void {
  try {
    localStorage.setItem(CANVAS_PROD_MODE_KEY, mode)
  } catch {
    /* 隐私模式 */
  }
}

export const SHOT_TAB_DEFS = [
  { id: 'visual' as const, label: '画面' },
  { id: 'narrative' as const, label: '叙事' },
  { id: 'outgoing' as const, label: '出片' },
] satisfies { id: 'visual' | 'narrative' | 'outgoing'; label: string }[]

/** 生图镜：画面 / 叙事；出片镜：只有出片（参考槽位页） */
export function visibleShotTabs(mode: CanvasProdMode | ShotProdKind) {
  return mode === 'image'
    ? SHOT_TAB_DEFS.filter((t) => t.id === 'visual' || t.id === 'narrative')
    : SHOT_TAB_DEFS.filter((t) => t.id === 'outgoing')
}

/** 按单镜生产类型决定 Inspector Tab（取代画布全局出图/出片） */
export function visibleShotTabsForProdKind(prodKind: ShotProdKind) {
  return visibleShotTabs(prodKind)
}
