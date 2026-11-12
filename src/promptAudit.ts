import type { ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import { parseDialogue } from './prompts'
import { auditKeyframePromptCore } from './promptAuditCore.mjs'

export type PromptAudit = {
  cast: string[]
  /** 硬问题：有台词的角色缺锚点 */
  missing: string[]
  /** 软提示：只在描述里被提到、没有台词的角色缺锚点 */
  maybe: string[]
  unknown: string[]
  empty: boolean
}

/**
 * 首帧提示词锚点审计：cast 权威时以 cast 为准，否则台词+描述启发式。
 *
 * 判定逻辑已抽到 `promptAuditCore.mjs`（服务端大厅健康统计复用同一份），
 * 这里只做「浏览器角色卡 → 核心入参」的字段映射，避免两边口径漂移。
 */
export function auditKeyframePrompt(s: ProjectShot, chars: CharacterSheet[]): PromptAudit {
  return auditKeyframePromptCore(
    s,
    chars.map((c) => ({ name: c.name, lookEn: c.lookEn })),
  )
}

export function promptCastLabel(s: ProjectShot): string {
  const declared = Array.isArray(s.cast) && s.cast.length > 0 ? s.cast : null
  if (declared) return declared.join('、')
  const dlg = Array.isArray(s.dialogue)
    ? s.dialogue
    : typeof s.dialogue === 'string'
      ? parseDialogue(s.dialogue)
      : []
  const spoken = dlg.map((d) => d.speaker).filter(Boolean)
  return spoken.join('、')
}
