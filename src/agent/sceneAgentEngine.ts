import type { AppSettings } from '../api'
import type { StagePick } from '../ModelSelect'
import type { SceneCodeAsk } from '../sceneCodeJob'
import type { AgentRunLimits } from './agentLimits'
import type { SceneAgentDeps } from './sceneAgentTypes'
import type { ManifestSummary } from '../contextManifest'

/** 3D 调度聊天的执行引擎；pi 为默认（模型不在原生能力表时自动回退 langgraph）。 */
export type SceneAgentEngine = 'langgraph' | 'pi'

export const SCENE_AGENT_ENGINES: readonly SceneAgentEngine[] = ['langgraph', 'pi']

export const DEFAULT_SCENE_AGENT_ENGINE: SceneAgentEngine = 'pi'

export type RunSceneAgentInput = {
  prompt: string
  deps: SceneAgentDeps
  settings: AppSettings | null
  stagePick?: StagePick
  ask?: SceneCodeAsk
  requirements?: string[]
  /** 可在本轮开始时作为运行基线的当前工作台代码 */
  initialCode?: string
  /** 本轮显式附件清单的摘要；用于每轮审计事件 */
  manifestSummary?: ManifestSummary
  /** 外部已组装好的 system（技能角色层 + 锁定契约 + 验收要求）；缺省用旧常量 */
  system?: string
  /** 外部取消信号 */
  signal?: AbortSignal
  /** 仅供测试缩短超时；生产路径从 settings.agentLimits 解析 */
  limits?: Partial<Pick<AgentRunLimits, 'totalMs'>>
  /** 仅测试/诊断使用；生产路径由设置决定 */
  engine?: SceneAgentEngine
}

export type SceneAgentEnginePick = {
  engine: SceneAgentEngine
  /** 调用方显式要求的引擎；缺省时等于 engine */
  requested?: SceneAgentEngine
  /** 回退到 engine 的原因；正常选择时缺省 */
  fallbackReason?: string
}

export function isSceneAgentEngine(value: unknown): value is SceneAgentEngine {
  return value === 'langgraph' || value === 'pi'
}

/** 设置库读写的归一化：只接受两个已知值，其余回落默认。 */
export function normalizeSceneAgentEngine(value: unknown): SceneAgentEngine {
  return isSceneAgentEngine(value) ? value : DEFAULT_SCENE_AGENT_ENGINE
}

/**
 * 只做「显式入参 → 设置 → 默认」这一层。
 * 模型能力校验在 resolveSceneAgentEngine 里做，避免这里依赖设置表结构。
 */
export function selectSceneAgentEngine(
  requested: unknown,
  fromSettings?: unknown,
): SceneAgentEnginePick {
  if (isSceneAgentEngine(requested)) return { engine: requested, requested }
  if (isSceneAgentEngine(fromSettings)) return { engine: fromSettings, requested: fromSettings }
  return { engine: DEFAULT_SCENE_AGENT_ENGINE, requested: DEFAULT_SCENE_AGENT_ENGINE }
}
