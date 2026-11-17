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

/** 设置页可配置的环节输出上限（tokens）；缺省/非法值都回落到环节默认 */
export type StageBudgetSettings = {
  stageMaxTokens?: Partial<Record<Stage, unknown>>
}

export type StageTokenBudget = {
  /** 不传 = 请求里不带 max_tokens，交给渠道默认值 */
  maxTokens?: number
  /** 数字来源：设置页配置 / 环节默认 / 未设置（等于渠道默认） */
  source: 'configured' | 'stage-default' | 'unset'
  /** 配置了但不合法时的原值，供界面与错误文案说明 */
  invalid?: unknown
}

/** 上限的合法区间：挡住 0、负数、NaN 和明显误填的超大值 */
export const STAGE_MAX_TOKENS_MIN = 1
export const STAGE_MAX_TOKENS_MAX = 200_000

export function isValidStageMaxTokens(value: unknown): boolean {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isFinite(n) && n >= STAGE_MAX_TOKENS_MIN && n <= STAGE_MAX_TOKENS_MAX
}

/**
 * 解析环节输出上限。
 *
 * 产品约束：未配置就不下发 `max_tokens`（渠道默认），而不是写死一个
 * 「一集分镜必然超」的数字；配置了非法值也不能悄悄生效或让请求失败，
 * 一律回落到环节默认并保留原值供报错说明。
 */
export function resolveStageMaxTokens(stage: Stage, settings?: StageBudgetSettings | null): StageTokenBudget {
  const configured = settings?.stageMaxTokens?.[stage]
  const base = STAGE_RUNTIME[stage]?.maxTokens
  const fallback = (invalid?: unknown): StageTokenBudget => ({
    ...(typeof base === 'number' ? { maxTokens: base } : {}),
    source: typeof base === 'number' ? 'stage-default' : 'unset',
    ...(invalid !== undefined ? { invalid } : {}),
  })
  if (configured === undefined || configured === null || String(configured).trim() === '') return fallback()
  if (!isValidStageMaxTokens(configured)) return fallback(configured)
  return { maxTokens: Math.floor(Number(String(configured).trim())), source: 'configured' }
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
