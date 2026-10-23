import type { SceneCodeCheck } from '../sceneCodeSanitize'
import type { PreparedCodeContext } from '../sceneCodePrepare'
import type { Shot3DContext } from '../types'
import { AGENT_LIMIT_DEFAULTS } from './agentLimits'

export type AgentToolName =
  | 'get_shot_context'
  | 'set_scene_code'
  | 'run_sandbox'
  | 'capture_frames'
  | 'review_frames'
  | 'finish'

export type AgentToolStatus = 'running' | 'done' | 'error'

export type AgentTextPart = { type: 'text'; text: string }
export type AgentToolPart = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
  isError?: boolean
  status: AgentToolStatus
  startedAt?: number
  endedAt?: number
}
export type AgentCodePart = { type: 'code'; codeHash: string; lineCount: number }
export type AgentFramesPart = { type: 'frames'; frames: { t: number; url: string }[] }
export type AgentReviewPart = { type: 'review'; items: AgentReviewItem[] }
export type AgentStepPart = {
  type: 'step'
  turn: number
  phase: 'start' | 'end' | 'error'
  text?: string
}

export type AgentMessagePart =
  | AgentTextPart
  | AgentToolPart
  | AgentCodePart
  | AgentFramesPart
  | AgentReviewPart
  | AgentVideoPart
  | AgentVideoReviewPart
  | AgentStepPart

export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  parts: AgentMessagePart[]
  status?: 'running' | 'complete' | 'error' | 'cancelled'
}

export type AgentEvent =
  | { type: 'agent_step'; turn: number; phase: 'start' | 'end' | 'error'; text?: string }
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; toolCallId: string; toolName: string; result: unknown; isError?: boolean }
  | { type: 'code'; codeHash: string; lineCount: number }
  | { type: 'frames'; frames: { t: number; url: string }[] }
  | { type: 'review'; items: AgentReviewItem[] }
  | { type: 'done'; summary: string; code?: string }
  | { type: 'cancelled' }
  | { type: 'error'; message: string; phase?: string }

export type AgentReviewItem = {
  key: string
  label: string
  ok: boolean
  reason?: string
}

export type AgentReview = {
  passed: boolean
  usedVision: boolean
  modelKey?: string
  needsHumanReview?: boolean
  items: AgentReviewItem[]
  summary?: string
}

export type AgentVideoPhase = 'rendering' | 'saving' | 'extracting' | 'reviewing'
export type AgentVideoStatus =
  | 'running'
  | 'passed'
  | 'rejected'
  | 'needs_human'
  | 'failed'
  | 'cancelled'
  | 'timeout'
export type AgentVideoErrorCode =
  | 'render_failed'
  | 'save_failed'
  | 'extract_failed'
  | 'vision_unavailable'
  | 'review_failed'
  | 'cancelled'
  | 'timeout'

export type AgentVideoPart = {
  type: 'video'
  videoId: string
  codeHash: string
  status: AgentVideoStatus
  phase?: AgentVideoPhase
  progress?: number
  videoUrl?: string
  duration: number
  aspect: string
  frames: AgentFrame[]
  error?: string
  errorCode?: AgentVideoErrorCode
  saved?: boolean
  savedAt?: string
  superseded?: boolean
}

export type AgentVideoReviewPart = {
  type: 'video-review'
  videoId: string
  codeHash: string
  videoUrl?: string
  passed: boolean
  needsHumanReview?: boolean
  modelKey?: string
  items: AgentReviewItem[]
  summary?: string
  saved?: boolean
  error?: string
  errorCode?: AgentVideoErrorCode
  superseded?: boolean
}

export type AgentVideoAcceptedInput = {
  code: string
  codeHash: string
  context: Shot3DContext
  prepared: PreparedCodeContext
  video: string
  duration: number
  aspect: string
  frames: AgentFrame[]
  review?: AgentReview
}

export type AgentTrial = {
  ok: boolean
  error?: string
  firstFrame?: string
}

export type AgentFrame = { t: number; url: string }

export type SceneAgentDeps = {
  /** 当前镜头的文本/选择摘要，只读 */
  getShotContext: () => Promise<string> | string
  /** 沙箱试运行；失败返回错误，不抛出旧代码 */
  runTrial: (code: string) => Promise<AgentTrial>
  /** 抓取关键帧；必须返回至少一帧 */
  captureFrames: (code: string, times: number[]) => Promise<AgentFrame[]>
  /** 视觉验收；无视觉模型时返回 needsHumanReview */
  reviewFrames: (frames: AgentFrame[], requirements: string[]) => Promise<AgentReview>
  /** 试运行成功后把草稿交给工作台（不保存） */
  onDraftCode?: (code: string, check: SceneCodeCheck) => void
  /** 事件回调；UI 用它更新工具卡片 */
  onEvent?: (event: AgentEvent) => void
  signal?: AbortSignal
}

export type SceneAgentResult = {
  code?: string
  codeHash?: string
  trial?: AgentTrial
  frames?: AgentFrame[]
  review?: AgentReview
  summary: string
  finished?: boolean
  cancelled?: boolean
  error?: string
  attempts: number
  reviewAttempts: number
  events: AgentEvent[]
}

export const DEFAULT_AGENT_LIMITS = {
  maxCodeAttempts: 3,
  maxReviewAttempts: 2,
  totalMs: AGENT_LIMIT_DEFAULTS.totalSeconds * 1000,
  toolMs: 30_000,
  maxFrames: 5,
} as const

export const DUEL_REQUIREMENTS = [
  '画面有山体或地形背景',
  '画面有两个人物',
  '两名人物可区分男女',
  '两人各持一把剑',
  '两人处于对打/攻防姿态',
  '镜头位置随时间环绕变化',
  '镜头始终正对两人，两人都在画面内',
]
