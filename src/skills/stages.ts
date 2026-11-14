import type { Stage } from '../api'
import { validateContract } from './contracts'

export type StageRuntimeConfig = {
  /**
   * 输出上限（tokens）。
   *
   * 默认不设：上限交给渠道自己的默认值，避免在环节配置里写死一个
   * 「一集分镜必然超」的数字。确实需要收窄的环节才填。
   */
  maxTokens?: number
  temperature: number
  /** 该环节的输出契约；视觉/视频理解返回建议文本，没有结构化产物 */
  output: string | null
}

/** 环节运行参数：一次性生成与聊天执行器共用，避免两套默认值。 */
export const STAGE_RUNTIME: Record<Stage, StageRuntimeConfig> = {
  character: { temperature: 0.3, output: 'characters-v1' },
  asset: { temperature: 0.3, output: 'designs-v1' },
  shot: { temperature: 0.3, output: 'shots-v1' },
  prompt: { temperature: 0.3, output: 'prompts-v1' },
  sceneCode: { temperature: 0.3, output: 'scene3d-code-v1' },
  vision: { temperature: 0.2, output: null },
  videoVision: { temperature: 0.2, output: null },
  /** 创意会话：反推走 reverse-v1；策划模式由技能 frontmatter 覆盖输出 */
  creative: { temperature: 0.4, output: 'reverse-v1' },
}

export function stageRuntime(stage: Stage): StageRuntimeConfig {
  return STAGE_RUNTIME[stage]
}

export function stageOutput(stage: Stage): string | null {
  return STAGE_RUNTIME[stage]?.output ?? null
}

/** 环节输出校验：没有结构化产物的环节直接通过。 */
export function assertStageOutput(stage: Stage, raw: unknown): void {
  const contract = stageOutput(stage)
  if (!contract) return
  const result = validateContract(contract, raw)
  if (!result.ok) {
    throw new Error(`模型输出不符合「${contract}」契约：${result.errors.join('；')}`)
  }
}
