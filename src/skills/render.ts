import { contractBlocks } from './contracts'
import type { Skill, SkillInputs, SkillPrompt, SkillReference, SkillRenderMode } from './types'

const PLACEHOLDER = /\{\{input:([A-Za-z0-9_]+)\}\}/g
const TASK_HEADING = '## 任务'

export type SkillPromptOptions = {
  /** chat 模式默认 2000；接缝等场景可抬高或设为 Infinity 强制内联 */
  threshold?: number
  /** 这些 input 键无论多长都完整内联，不替换为「用读工具」占位 */
  inlineInputKeys?: string[]
  /** full = 技能正文到「## 任务」之前的全部 Markdown（含标题）；默认仅 role 段 */
  systemMode?: 'role' | 'full-guidance'
}

function skillGuidanceMarkdown(skill: Skill): string {
  const raw = skill.text.replace(/^\uFEFF?/, '')
  const start = raw.indexOf('---')
  if (start !== 0) return skill.role
  const end = raw.indexOf('\n---', 3)
  const body = end >= 0 ? raw.slice(end + 4).replace(/^\s+/, '') : raw
  const taskAt = body.indexOf(`\n${TASK_HEADING}`)
  const guidance = (taskAt >= 0 ? body.slice(0, taskAt) : body).trim()
  return guidance || skill.role
}

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
  inlineInputKeys?: string[],
): { text: string; missing: string[]; references: SkillReference[] } {
  const missing: string[] = []
  const references: SkillReference[] = []
  const seenMissing = new Set<string>()
  const inlineKeys = new Set(inlineInputKeys ?? [])
  const effectiveThreshold =
    threshold === Infinity || threshold <= 0 ? Number.POSITIVE_INFINITY : threshold

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
    if (mode === 'chat' && !inlineKeys.has(key) && str.length > effectiveThreshold) {
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
  options?: SkillPromptOptions,
): SkillPrompt {
  const blocks = contractBlocks(skill.manifest.contracts)
  const guidance =
    options?.systemMode === 'full-guidance' ? skillGuidanceMarkdown(skill) : skill.role
  const system = blocks ? `${guidance}\n\n${blocks}` : guidance
  const rendered = renderSkillTemplate(
    skill.task,
    inputs,
    mode,
    options?.threshold ?? threshold,
    options?.inlineInputKeys,
  )
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
