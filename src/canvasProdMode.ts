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
  { id: 'video' as const, label: '视频' },
  { id: 'more' as const, label: '更多' },
] satisfies { id: 'visual' | 'video' | 'more'; label: string }[]

export function visibleShotTabs(mode: CanvasProdMode) {
  return mode === 'image'
    ? SHOT_TAB_DEFS.filter((t) => t.id === 'visual' || t.id === 'more')
    : SHOT_TAB_DEFS.filter((t) => t.id === 'video' || t.id === 'more')
}
