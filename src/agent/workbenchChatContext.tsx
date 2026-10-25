import { createContext, useContext } from 'react'
import type { WorkbenchSaveMode, WorkbenchSurface } from './workbenchChat'

export type WorkbenchChatContextValue = {
  surface: WorkbenchSurface
  saveMode: WorkbenchSaveMode
  onSave?: () => Promise<void> | void
  onRetry?: () => void
  running: boolean
  /** 宿主草稿是否未保存；显式保存的工作台用它同步写回执。 */
  dirty?: boolean
}

export const WorkbenchChatContext = createContext<WorkbenchChatContextValue | null>(null)

export function useWorkbenchChatContext() {
  return useContext(WorkbenchChatContext)
}
