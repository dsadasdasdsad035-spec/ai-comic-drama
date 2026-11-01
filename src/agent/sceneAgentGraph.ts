import type { SceneAgentResult } from './sceneAgentTypes'
import { runSceneAgentPi } from './pi/engine'
import { stageModelKey } from '../ModelSelect'
import { findToolCapability } from './toolCapabilities'
import type { AppSettings } from '../api'
import type { StagePick } from '../ModelSelect'
import type { SceneCodeAsk } from '../sceneCodeJob'
import type { AgentRunLimits } from './agentLimits'
import type { SceneAgentDeps } from './sceneAgentTypes'
import type { ManifestSummary } from '../contextManifest'

export type { SceneAgentSession } from './sceneAgentTools'
export type { AgentEvent } from './sceneAgentTypes'

/** 3D 调度聊天的运行输入；只有一个执行引擎，因此不再有引擎选择字段。 */
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
}

export type SceneAgentEngineInput = Pick<RunSceneAgentInput, 'settings' | 'stagePick'>

export type SceneAgentCapability = {
  available: boolean
  /** 当前环节的模型标识；未配置时为空 */
  model: string
  provider: string
  /** 不可用时的可读原因，含可换用的模型清单 */
  reason?: string
}

/** 3D 聊天是否具备运行前提（已绑定环节模型）；不再按能力表拦截原生工具。 */
export function sceneAgentCapability(input: SceneAgentEngineInput): SceneAgentCapability {
  const modelKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  if (!modelKey) {
    return {
      available: false,
      model: '',
      provider: '',
      reason: '没有可用的 3D 代码模型，请到设置页绑定「3D 代码」环节',
    }
  }
  const entry = input.settings?.models.find((m) => m.key === modelKey)
  const provider = entry ? input.settings?.providers.find((p) => p.id === entry.provider) : undefined
  const model = entry?.model || modelKey
  const providerId = provider?.id || ''
  return { available: true, model, provider: providerId }
}

/**
 * 3D 调度聊天的稳定门面。
 *
 * 只有一个执行引擎（pi），且只走原生工具调用；未绑定环节模型时才失败。
 */
export async function runSceneAgent(input: RunSceneAgentInput): Promise<SceneAgentResult> {
  const capability = sceneAgentCapability(input)
  if (!capability.available) throw new Error(capability.reason || '没有可用的 3D 代码模型')

  const raw = await runSceneAgentPi(input)

  const protocolEvent = {
    type: 'custom' as const,
    name: 'tool_protocol',
    value: {
      protocol: 'native' as const,
      model: capability.model,
      provider: capability.provider,
      thinking: findToolCapability(capability.provider, capability.model)?.thinking ?? 'omit',
    },
  }

  return {
    ...raw,
    toolProtocol: 'native',
    events: [...raw.events, protocolEvent],
  }
}
