import type { RulePack } from '../api'
import {
  DEFAULT_RULES,
  assetSys,
  characterSys,
  normalizeRules,
  promptSys,
  scriptSys,
  storyboardSys,
} from './legacyPrompts'
import { composeSkillBody } from './parse'
import type { Skill } from './types'

type LegacyEntry = {
  key: keyof typeof DEFAULT_RULES
  skillId: string
  sys: (rules?: Record<string, RulePack>) => string
}

const LEGACY: LegacyEntry[] = [
  { key: 'script', skillId: 'script', sys: scriptSys },
  { key: 'character', skillId: 'character', sys: characterSys },
  { key: 'asset', skillId: 'asset', sys: assetSys },
  { key: 'shot', skillId: 'shotlist', sys: storyboardSys },
  { key: 'prompt', skillId: 'prompt', sys: promptSys },
]

/**
 * 旧规则包迁移计划（纯函数）：只有用户真正改过或停用过规则包才生成覆盖。
 * 覆盖保存完整旧角色文本，保证迁移前后逐字一致；任务模板沿用新技能。
 */
export function planLegacySkillOverrides(
  rules: Record<string, RulePack> | undefined,
  skills: Map<string, Skill>,
): { skillId: string; body: string; baseVersion: number }[] {
  const normalized = normalizeRules(rules)
  const out: { skillId: string; body: string; baseVersion: number }[] = []
  for (const entry of LEGACY) {
    const pack = normalized[entry.key]
    const def = DEFAULT_RULES[entry.key]
    const customized = !pack || pack.enabled !== def.enabled || pack.text !== def.text
    if (!customized) continue
    const skill = skills.get(entry.skillId)
    if (!skill) continue
    out.push({
      skillId: entry.skillId,
      body: composeSkillBody(entry.sys(normalized), skill.task),
      baseVersion: skill.manifest.version,
    })
  }
  return out
}
