import { contractIds, getContract } from './contracts'
import { parseSkillText } from './parse'
import { KNOWN_TOOL_IDS } from './tools'
import type { Skill, SkillTextRecord } from './types'

export type SkillLoadIssue = { id: string; message: string }

export type SkillLoadResult = {
  skills: Map<string, Skill>
  issues: SkillLoadIssue[]
  /** 服务端不可用、使用了打包进前端的默认技能 */
  fallback: boolean
}

function semanticIssues(skill: Skill): string[] {
  const issues: string[] = []
  const contracts = skill.manifest.contracts
  for (const id of contracts) {
    if (!getContract(id)) issues.push(`未知契约「${id}」，可用：${contractIds().join('、')}`)
  }
  if (!contracts.includes(skill.manifest.output)) {
    issues.push(`输出契约「${skill.manifest.output}」不在 contracts 中`)
  }
  for (const tool of skill.manifest.tools) {
    if (!KNOWN_TOOL_IDS.has(tool)) issues.push(`未知工具「${tool}」`)
  }
  return issues
}

function parseRecord(record: SkillTextRecord, issues: SkillLoadIssue[]): Skill | null {
  try {
    const skill = parseSkillText(record.id, record.text, record.source, record.builtinText)
    const bad = semanticIssues(skill)
    if (bad.length) {
      issues.push({ id: record.id, message: bad.join('；') })
      return null
    }
    return skill
  } catch (e) {
    const message = (e as Error).message || String(e)
    // 用户覆盖坏了 → 退回内置文本，技能仍可用，但把错误报出来
    if (record.source === 'override' && record.builtinText) {
      try {
        const fallback = parseSkillText(record.id, record.builtinText, 'builtin')
        const bad = semanticIssues(fallback)
        if (bad.length) throw new Error(bad.join('；'))
        issues.push({ id: record.id, message: `用户覆盖不可用，已退回内置：${message}` })
        return fallback
      } catch (inner) {
        issues.push({ id: record.id, message: `内置技能也不可用：${(inner as Error).message || inner}` })
        return null
      }
    }
    issues.push({ id: record.id, message })
    return null
  }
}

/** 纯函数：装载/测试共用；不依赖 fetch 或 Vite 的 ?raw 导入。 */
export function parseSkillRecords(records: SkillTextRecord[]): SkillLoadResult {
  const skills = new Map<string, Skill>()
  const issues: SkillLoadIssue[] = []
  for (const record of records) {
    if (skills.has(record.id)) {
      issues.push({ id: record.id, message: '技能 id 重复，已忽略后一个' })
      continue
    }
    const skill = parseRecord(record, issues)
    if (skill) skills.set(skill.id, skill)
  }
  return { skills, issues, fallback: false }
}
