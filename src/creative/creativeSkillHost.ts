import { isAgentPackSkill } from '../skills/agentPack'
import type { Skill } from '../skills/types'

const STORAGE_KEY = 'creative.hostSkillId'

/** 仅 SkillHub 市场安装或本地上传的技能可作创意宿主；不含仓库磁盘内置/覆盖。 */
export function isMarketInstalledSkill(s: Skill): boolean {
  return s.source === 'skillhub' || s.source === 'upload'
}

/** 创意 Pi 宿主：仅 SkillHub / 上传的 Agent 技能包（无仓库内置、无工作台专用宿主）。 */
export function listCreativeHostSkills(all: Iterable<Skill>): Skill[] {
  return [...all]
    .filter((s) => isMarketInstalledSkill(s) && isAgentPackSkill(s))
    .sort((a, b) => (a.manifest.name || a.id).localeCompare(b.manifest.name || b.id, 'zh'))
}

export function readStoredCreativeHostId(): string {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function storeCreativeHostId(id: string) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 隐私模式等 */
  }
}

/** 创意顶栏「自动」：不设固定宿主，由 Pi 通过 list_installed_skills 发现技能 */
export const CREATIVE_HOST_AUTO = ''

/** 解析顶栏偏好技能 id；默认自动，不再回落到目录第一项 */
export function resolveCreativeHostId(catalog: Skill[], preferred?: string): string {
  const want = preferred !== undefined ? String(preferred).trim() : readStoredCreativeHostId()
  if (!want) return CREATIVE_HOST_AUTO
  if (catalog.some((s) => s.id === want)) return want
  return CREATIVE_HOST_AUTO
}
