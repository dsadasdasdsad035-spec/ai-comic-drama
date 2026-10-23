import { createContext } from 'react'
import type { ShotData, Tool } from './types'

export type CanvasApi = {
  tool: Tool
  guides: boolean
  color: string
  /** 角色名 → 头像图，分镜卡上叠出场头像用 */
  charImages: Record<string, string>
  patch: (id: string, patch: Partial<ShotData>) => void
  cycleEdge: (id: string) => void
  generate: (id: string) => void
  cancelGenerate: (id: string) => void
  generateVideo: (id: string) => void
}

export const CanvasCtx = createContext<CanvasApi>({
  tool: 'none',
  guides: true,
  color: '#fbbf24',
  charImages: {},
  patch: () => {},
  cycleEdge: () => {},
  generate: () => {},
  cancelGenerate: () => {},
  generateVideo: () => {},
})
