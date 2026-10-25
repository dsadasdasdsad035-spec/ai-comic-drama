import type { Stage } from '../api'
import { validateContract } from './contracts'

export type StageRuntimeConfig = {
  maxTokens: number
  temperature: number
  /** 该环节的输出契约；视觉/视频理解返回建议文本，没有结构化产物 */
  output: string | null
}

/** 环节运行参数：一次性生成与聊天执行器共用，避免两套默认值。 */
export const STAGE_RUNTIME: Record<Stage, StageRuntimeConfig> = {
  script: { maxTokens: 8192, temperature: 0.4, output: 'script-v1' },
  character: { maxTokens: 6000, temperature: 0.3, output: 'characters-v1' },
  asset: { maxTokens: 6000, temperature: 0.3, output: 'designs-v1' },
  shot: { maxTokens: 8192, temperature: 0.3, output: 'shots-v1' },
  prompt: { maxTokens: 4096, temperature: 0.3, output: 'prompts-v1' },
  sceneCode: { maxTokens: 12000, temperature: 0.3, output: 'scene3d-code-v1' },
  vision: { maxTokens: 4096, temperature: 0.2, output: null },
  videoVision: { maxTokens: 4096, temperature: 0.2, output: null },
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
