import { createContext, useContext } from 'react'
import type { WorkbenchSaveMode, WorkbenchSurface } from './workbenchChat'

export type WorkbenchChatContextValue = {
  surface: WorkbenchSurface | 'scene3d'
  saveMode: WorkbenchSaveMode
  onSave?: () => Promise<void> | void
  onRetry?: () => void
  running: boolean
  /** 宿主草稿是否未保存；显式保存的工作台用它同步写回执。 */
  dirty?: boolean
  /**
   * 「用它生成三视图」这类需要人确认的花钱动作。
   * 不提供时回执不渲染按钮——聊天绝不自作主张生图。
   */
  onRenderTurnaround?: (charNames: string[]) => Promise<void> | void
  /** 单个角色生成三视图的估算费用，用于按钮上显示 */
  turnaroundCost?: number
}

export const WorkbenchChatContext = createContext<WorkbenchChatContextValue | null>(null)

export function useWorkbenchChatContext() {
  return useContext(WorkbenchChatContext)
}
