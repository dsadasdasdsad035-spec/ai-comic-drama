import type { CharacterSheet } from './characters'

/** project.json 里的角色结构（与 manga-pipeline/prompts.py 的 CHARACTER_SYS 一致） */
export type ProjectChar = {
  name: string
  role?: string
  age?: string
  look_cn?: string
  look_en?: string
  palette?: string
  keywords?: string[]
}

/**
 * project.json → 角色卡。
 * id 直接用角色名：中文名当 React key 没问题，且跨会话稳定（随机 uuid 会每次重建都对不上）。
 */
export function toSheet(c: ProjectChar): CharacterSheet {
  return {
    id: String(c.name || '').trim() || 'char',
    name: c.name || '',
    role: c.role || '',
    age: c.age,
    lookCn: c.look_cn || '',
    lookEn: c.look_en || '',
    palette: c.palette || '',
    keywords: Array.isArray(c.keywords) ? c.keywords : [],
  }
}

/** 角色卡 → project.json，蛇形字段名保持一致 */
export function toProject(s: CharacterSheet): ProjectChar {
  const out: ProjectChar = {
    name: s.name,
    role: s.role,
    look_cn: s.lookCn,
    look_en: s.lookEn,
    palette: s.palette,
    keywords: s.keywords ?? [],
  }
  if (s.age) out.age = s.age
  return out
}

/** 给 LLM 的角色外观锚点清单：keyframe_prompt 必须原样嵌入 look_en */
export function characterBible(chars: CharacterSheet[]): string {
  return chars
    .filter((c) => c.name && c.lookEn)
    .map((c) => `${c.name}：${c.lookEn}`)
    .join('\n')
}
