import { createContext } from 'react'
import type { ShotData, Tool } from './types'

export type CanvasApi = {
  tool: Tool
  guides: boolean
  color: string
  patch: (id: string, patch: Partial<ShotData>) => void
  cycleEdge: (id: string) => void
  generate: (id: string) => void
  generateVideo: (id: string) => void
}

export const CanvasCtx = createContext<CanvasApi>({
  tool: 'none',
  guides: true,
  color: '#fbbf24',
  patch: () => {},
  cycleEdge: () => {},
  generate: () => {},
  generateVideo: () => {},
})
