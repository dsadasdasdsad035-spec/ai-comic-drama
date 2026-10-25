import { contractBlocks } from './contracts'
import type { Skill, SkillInputs, SkillPrompt, SkillReference, SkillRenderMode } from './types'

const PLACEHOLDER = /\{\{input:([A-Za-z0-9_]+)\}\}/g

function stringify(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 渲染技能模板。
 * - inline：一次性生成，所有输入完整内联。
 * - chat：超过阈值的输入只留引用行，由读工具按范围读取，避免每轮重发全文。
 * - 只认 `{{input:key}}`；提示词里的 `{{角色名}}` 是普通文本。
 */
export function renderSkillTemplate(
  template: string,
  inputs: SkillInputs,
  mode: SkillRenderMode = 'inline',
  threshold = 2000,
): { text: string; missing: string[]; references: SkillReference[] } {
  const missing: string[] = []
  const references: SkillReference[] = []
  const seenMissing = new Set<string>()

  const text = template.replace(PLACEHOLDER, (_all, key: string) => {
    const value = inputs[key]
    if (value === undefined || value === null) {
      if (!seenMissing.has(key)) {
        seenMissing.add(key)
        missing.push(key)
      }
      return ''
    }
    const str = stringify(value)
    if (!str) return ''
    if (mode === 'chat' && str.length > threshold) {
      references.push({ key, chars: str.length })
      return `〔${key}：共 ${str.length} 字，使用技能提供的读工具按范围读取〕`
    }
    return str
  })

  return { text, missing, references }
}

/**
 * 组装一次技能调用的提示词。
 * system = 可编辑角色层 + 锁定契约；
 * task = 渲染后的任务模板（一次性生成直接作为 prompt，聊天作为本轮任务卡）。
 */
export function buildSkillPrompt(
  skill: Skill,
  inputs: SkillInputs,
  mode: SkillRenderMode = 'inline',
  threshold = 2000,
): SkillPrompt {
  const blocks = contractBlocks(skill.manifest.contracts)
  const system = blocks ? `${skill.role}\n\n${blocks}` : skill.role
  const rendered = renderSkillTemplate(skill.task, inputs, mode, threshold)
  return {
    system,
    task: rendered.text,
    missing: rendered.missing,
    references: rendered.references,
  }
}

/** 发送前检查：缺必需输入时给出可读错误，不偷偷用空值。 */
export function assertPromptComplete(prompt: SkillPrompt): void {
  if (prompt.missing.length === 0) return
  throw new Error(`技能输入缺失：${prompt.missing.join('、')}。请在发送前补齐，或移除该技能。`)
}
