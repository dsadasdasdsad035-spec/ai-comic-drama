import { validateContract } from './contracts'
import { buildPromptForSkill } from './registry'
import { assertPromptComplete } from './render'
import type { SkillInputs, SkillPrompt } from './types'

/**
 * 工作台生成按钮的技能入口。
 * 技能不可用或输入缺失都直接抛错；不再退回旧提示词常量。
 */
export async function buildBoardSkillPrompt(id: string, inputs: SkillInputs): Promise<SkillPrompt> {
  const prompt = await buildPromptForSkill(id, inputs, 'inline')
  assertPromptComplete(prompt)
  return prompt
}

/** 输出契约校验：不合法就拒绝写入草稿/项目。 */
export function assertSkillOutput(contractId: string, raw: unknown): void {
  const result = validateContract(contractId, raw)
  if (!result.ok) {
    throw new Error(`模型输出不符合技能契约：${result.errors.join('；')}`)
  }
}
