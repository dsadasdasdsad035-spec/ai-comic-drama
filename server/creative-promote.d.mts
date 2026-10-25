/** server/creative-promote.mjs 的类型声明（反推产物晋升项目与文本导出） */

export declare function reverseShotToProjectShot(
  shot: Record<string, unknown>,
  ix: number,
  meta?: {
    sessionId?: string
    sourceUrl?: string
    episode?: number
    title?: string
  },
): Record<string, unknown>

export declare function promoteReversePack(
  root: string,
  payload: Record<string, unknown>,
  opts?: {
    sessionId?: string
    sourceId?: string
    sourceUrl?: string
    title?: string
    style?: string
    aspect?: string
    target?: 'new' | 'existing'
    projectName?: string
    episode?: number
  },
): {
  projectName: string
  created: boolean
  shots: number
  updated?: number
  newShots?: number
  kept?: number
  savedShots: number
}

export declare function reversePackToText(payload: Record<string, unknown>, title?: string): string
