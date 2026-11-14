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
  { id: 'audio' as const, label: '音画' },
  { id: 'meta' as const, label: '元数据' },
] satisfies { id: 'visual' | 'narrative' | 'outgoing' | 'audio' | 'meta'; label: string }[]

export function visibleShotTabs(mode: CanvasProdMode | ShotProdKind) {
  return mode === 'image'
    ? SHOT_TAB_DEFS.filter((t) => t.id === 'visual' || t.id === 'narrative')
    : SHOT_TAB_DEFS.filter((t) => t.id === 'outgoing' || t.id === 'audio' || t.id === 'meta')
}

/** 按单镜生产类型决定 Inspector Tab（取代画布全局出图/出片） */
export function visibleShotTabsForProdKind(prodKind: ShotProdKind) {
  return visibleShotTabs(prodKind)
}
