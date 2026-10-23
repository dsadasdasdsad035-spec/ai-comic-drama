import { createContext, useContext } from 'react'
import type { AgentVideoPart, AgentVideoReviewPart } from '@/agent/sceneAgentTypes'

export type VideoUiContextValue = {
  /** 当前聊天里最新的代码哈希；用于标记旧视频/旧验收。 */
  currentCodeHash?: string
  onAdopt?: (video: AgentVideoPart) => void
  onRetry?: (video: AgentVideoPart) => void
  onContinueRepair?: (review: AgentVideoReviewPart) => void
}

export const VideoUiContext = createContext<VideoUiContextValue>({})

export function useVideoUi(): VideoUiContextValue {
  return useContext(VideoUiContext)
}
