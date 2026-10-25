import { createContext, useContext } from 'react'
import type { CreativeSettings } from './settings'

import type { CostRequest } from './tools'

export type CreativeChatContextValue = {
  creative: CreativeSettings
  confirmCost: (req: CostRequest) => Promise<boolean>
  refreshSession: () => Promise<void>
}

export const CreativeChatContext = createContext<CreativeChatContextValue | null>(null)

export function useCreativeChatContext(): CreativeChatContextValue | null {
  return useContext(CreativeChatContext)
}
