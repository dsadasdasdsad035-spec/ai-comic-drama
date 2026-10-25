import { createContext } from 'react'
import type { Relation, ShotData, Tool } from './types'

export type CanvasApi = {
  tool: Tool
  guides: boolean
  color: string
  /** 角色名 → 头像图，分镜卡上叠出场头像用 */
  charImages: Record<string, string>
  patch: (id: string, patch: Partial<ShotData>) => void
  cycleEdge: (id: string) => void
  /** 设置连线关系；落到转场时补默认接缝 */
  setEdgeRelation: (id: string, relation: Relation) => void
  /** 打开转场详情面板 */
  openTransition: (id: string) => void
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
  setEdgeRelation: () => {},
  openTransition: () => {},
  generate: () => {},
  cancelGenerate: () => {},
  generateVideo: () => {},
})
