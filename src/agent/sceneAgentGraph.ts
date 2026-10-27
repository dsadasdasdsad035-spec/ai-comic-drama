import type { SceneAgentResult } from './sceneAgentTypes'
import { runSceneAgentLangGraph } from './sceneAgentGraphLangGraph'
import { runSceneAgentPi } from './pi/engine'
import { stageModelKey } from '../ModelSelect'
import { resolveToolProtocol } from './toolCapabilities'
import {
  selectSceneAgentEngine,
  type RunSceneAgentInput,
  type SceneAgentEngine,
  type SceneAgentEnginePick,
} from './sceneAgentEngine'

export type { RunSceneAgentInput, SceneAgentEngine, SceneAgentEnginePick }
export type { SceneAgentSession } from './sceneAgentTools'
export type { AgentEvent } from './sceneAgentTypes'

function providerOf(input: SceneAgentEngineInput, modelKey: string) {
  const entry = input.settings?.models.find((m) => m.key === modelKey)
  const provider = entry ? input.settings?.providers.find((p) => p.id === entry.provider) : undefined
  return { entry, provider }
}

/** 只解析引擎所需的最小输入；UI 展示与门面运行共用同一套判断。 */
export type SceneAgentEngineInput = Pick<RunSceneAgentInput, 'engine' | 'settings' | 'stagePick'>

/**
 * 解析本轮引擎：
 * - 显式入参优先，其次设置，最后默认
 * - pi 只对已声明原生工具调用的模型生效
 * - 显式要求 pi 但模型不支持 → 可读错误；设置要求 pi 但模型不支持 → 回退 langgraph
 */
export function resolveSceneAgentEngine(input: SceneAgentEngineInput): SceneAgentEnginePick {
  const pick = selectSceneAgentEngine(input.engine, input.settings?.agentEngine)
  if (pick.engine !== 'pi') return pick

  const modelKey = stageModelKey(input.settings, 'sceneCode', input.stagePick)
  const { entry, provider } = modelKey ? providerOf(input, modelKey) : { entry: undefined, provider: undefined }
  const protocol = resolveToolProtocol(input.settings?.agentToolProtocol, provider?.id, entry?.model)

  if (protocol.protocol === 'native' && !protocol.error) {
    return { ...pick, requested: input.engine ?? input.settings?.agentEngine ?? 'pi' }
  }

  const reason = `模型「${provider?.id || '未知渠道'} / ${entry?.model || '未配置'}」未声明支持原生工具调用，pi 引擎不适用`
  if (input.engine === 'pi') {
    throw new Error(`${reason}；请换用能力表内的模型，或把 agentEngine 设回 langgraph`)
  }
  return { engine: 'langgraph', requested: 'pi', fallbackReason: reason }
}

/**
 * 3D 调度聊天的稳定门面：调用方只依赖本函数与 SceneAgentResult。
 * 引擎实现可切换；默认行为与升级前一致。
 */
export async function runSceneAgent(input: RunSceneAgentInput): Promise<SceneAgentResult> {
  const pick = resolveSceneAgentEngine(input)
  const raw =
    pick.engine === 'pi'
      ? await runSceneAgentPi(input)
      : await runSceneAgentLangGraph(input)

  const engineEvent = {
    type: 'custom' as const,
    name: 'engine',
    value: {
      engine: pick.engine,
      requested: pick.requested ?? pick.engine,
      ...(pick.fallbackReason ? { fallbackReason: pick.fallbackReason } : {}),
    },
  }

  return {
    ...raw,
    engine: pick.engine,
    ...(pick.fallbackReason ? { engineFallbackReason: pick.fallbackReason } : {}),
    events: [...raw.events, engineEvent],
  }
}
