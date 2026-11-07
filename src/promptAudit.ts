import type { ProjectShot } from './api'
import type { CharacterSheet } from './characters'
import { parseDialogue } from './prompts'

export type PromptAudit = {
  cast: string[]
  /** 硬问题：有台词的角色缺锚点 */
  missing: string[]
  /** 软提示：只在描述里被提到、没有台词的角色缺锚点 */
  maybe: string[]
  unknown: string[]
  empty: boolean
}

function auditByCast(s: ProjectShot, chars: CharacterSheet[], declared: string[]): PromptAudit {
  const kf = s.keyframe_prompt || ''
  const missing: string[] = []
  const unknown: string[] = []
  for (const name of declared) {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      unknown.push(name)
      continue
    }
    if (c.lookEn && !kf.includes(c.lookEn)) missing.push(name)
  }
  return { cast: [...declared], missing, maybe: [], unknown, empty: !kf.trim() }
}

function auditByHeuristic(s: ProjectShot, chars: CharacterSheet[]): PromptAudit {
  const dlg = Array.isArray(s.dialogue) ? s.dialogue : []
  const spoken = new Set<string>()
  for (const d of dlg) if (d?.speaker) spoken.add(d.speaker)
  const desc = s.desc || ''
  const mentioned = new Set<string>()
  for (const c of chars) if (c.name && desc.includes(c.name)) mentioned.add(c.name)

  const kf = s.keyframe_prompt || ''
  const missing: string[] = []
  const maybe: string[] = []
  const unknown: string[] = []

  const judge = (name: string, hard: boolean) => {
    const c = chars.find((x) => x.name === name)
    if (!c) {
      if (hard) unknown.push(name)
      return
    }
    if (!c.lookEn) return
    if (kf.includes(c.lookEn)) return
    ;(hard ? missing : maybe).push(name)
  }

  for (const n of spoken) judge(n, true)
  for (const n of mentioned) if (!spoken.has(n)) judge(n, false)

  return {
    cast: [...new Set([...spoken, ...mentioned])],
    missing,
    maybe,
    unknown,
    empty: !kf.trim(),
  }
}

/** 首帧提示词锚点审计：cast 权威时以 cast 为准，否则台词+描述启发式 */
export function auditKeyframePrompt(s: ProjectShot, chars: CharacterSheet[]): PromptAudit {
  const declared = Array.isArray(s.cast) && s.cast.length > 0 ? s.cast : null
  if (declared) return auditByCast(s, chars, declared)
  return auditByHeuristic(s, chars)
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
