import { createContext } from 'react'
import type { ShotData, Tool } from './types'

export type CanvasApi = {
  tool: Tool
  guides: boolean
  color: string
  /** 角色名 → 头像图，分镜卡上叠出场头像用 */
  charImages: Record<string, string>
  /** 卡片上是否叠俯视调度缩略图 */
  showLayout: boolean
  patch: (id: string, patch: Partial<ShotData>) => void
  cycleEdge: (id: string) => void
  generate: (id: string) => void
  generateVideo: (id: string) => void
}

export const CanvasCtx = createContext<CanvasApi>({
  tool: 'none',
  guides: true,
  color: '#fbbf24',
  charImages: {},
  showLayout: true,
  patch: () => {},
  cycleEdge: () => {},
  generate: () => {},
  generateVideo: () => {},
})
