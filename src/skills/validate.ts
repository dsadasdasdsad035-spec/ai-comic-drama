import { tryAgentPackSkill, WORKBENCH_MANIFEST_REJECT } from './agentPack'
import { KNOWN_TOOL_IDS } from './tools'
import { parseSkillText } from './parse'
import type { Skill, SkillTextRecord } from './types'

export type SkillLoadIssue = { id: string; message: string }

export type SkillLoadResult = {
  skills: Map<string, Skill>
  issues: SkillLoadIssue[]
  /** 服务端不可用、使用了打包进前端的默认技能 */
  fallback: boolean
}

/** 3D / 一次性场景代码仍走旧 manifest（非 SkillHub 宿主）；磁盘有 SKILL 时才加载。 */
export const LEGACY_RUNTIME_SKILL_IDS = new Set(['scene3d', 'scene-code', 'scene-code-chat'])

const WORKBENCH_RETIRED = WORKBENCH_MANIFEST_REJECT

function semanticIssues(skill: Skill): string[] {
  const issues: string[] = []
  for (const tool of skill.manifest.tools) {
    if (!KNOWN_TOOL_IDS.has(tool)) issues.push(`未知工具「${tool}」`)
  }
  return issues
}

function parseLegacyRuntime(record: SkillTextRecord, issues: SkillLoadIssue[]): Skill | null {
  if (!LEGACY_RUNTIME_SKILL_IDS.has(record.id)) return null
  if (record.source !== 'builtin' && record.source !== 'override') return null
  try {
    const skill = parseSkillText(record.id, record.text, record.source, record.builtinText)
    const bad = semanticIssues(skill)
    if (bad.length) {
      issues.push({ id: record.id, message: bad.join('；') })
      return null
    }
    return skill
  } catch (e) {
    issues.push({ id: record.id, message: (e as Error).message || String(e) })
    return null
  }
}

function parseRecord(record: SkillTextRecord, issues: SkillLoadIssue[]): Skill | null {
  const legacy = parseLegacyRuntime(record, issues)
  if (legacy) return legacy

  const pack = tryAgentPackSkill(record)
  if (pack) {
    const bad = semanticIssues(pack)
    if (bad.length) {
      issues.push({ id: record.id, message: bad.join('；') })
      return null
    }
    return pack
  }

  try {
    parseSkillText(record.id, record.text, record.source, record.builtinText)
    issues.push({ id: record.id, message: WORKBENCH_RETIRED })
  } catch (e) {
    issues.push({ id: record.id, message: (e as Error).message || String(e) })
  }
  return null
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