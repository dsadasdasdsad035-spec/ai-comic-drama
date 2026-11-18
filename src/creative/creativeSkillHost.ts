import { isAgentPackSkill } from '../skills/agentPack'
import type { Skill } from '../skills/types'

const STORAGE_KEY = 'creative.hostSkillId'

/**
 * 创意宿主判定：只看「形态」，不看安装来源。
 *
 * Agent 包（`profile === 'agent-pack'`）是能力契约，`source` 只是安装渠道。
 * 曾按 `skillhub/upload` 过滤，结果内置包整批进不了宿主下拉——每多一个来源就会再失效一次。
 */
export function isCreativeHostSkill(s: Skill): boolean {
  return isAgentPackSkill(s)
}

/** 创意 Pi 宿主候选：全部 Agent 技能包，内置与市场安装一视同仁。 */
export function listCreativeHostSkills(all: Iterable<Skill>): Skill[] {
  return [...all]
    .filter(isCreativeHostSkill)
    .sort((a, b) => (a.manifest.name || a.id).localeCompare(b.manifest.name || b.id, 'zh'))
}

/** 顶栏分组：组头文案与组内选项；空组由调用方过滤掉，不渲染空标题。 */
export type CreativeHostGroup = { label: string; options: Array<{ id: string; label: string }> }

/**
 * 宿主下拉分组：`builtin` / `override` 归「内置技能」，`skillhub` / `upload` 归「市场安装」。
 * 返回结果已剔除空组——「市场安装」为空时不应出现一个没有内容的组头。
 */
export function groupCreativeHostSkills(hosts: Skill[]): CreativeHostGroup[] {
  const builtin: CreativeHostGroup = { label: '内置技能', options: [] }
  const market: CreativeHostGroup = { label: '市场安装', options: [] }
  for (const s of hosts) {
    const target = s.source === 'builtin' || s.source === 'override' ? builtin : market
    target.options.push({ id: s.id, label: `${s.manifest.name || s.id} · ${s.manifest.stage}` })
  }
  return [builtin, market].filter((g) => g.options.length > 0)
}

/** 头部横幅：区分「没有技能」与「有技能但没有可作宿主的 Agent 包」 */
export function creativeHostBanner(
  skillCount: number,
  hostCount: number,
): { tone: 'info'; text: string } | null {
  if (hostCount > 0) return null
  if (skillCount > 0) {
    return {
      tone: 'info',
      text: `已有 ${skillCount} 个技能，但没有可作宿主的 Agent 包。可在「自动（技能目录）」下继续对话，或到设置页检查技能形态。`,
    }
  }
  return {
    tone: 'info',
    text: '技能目录为空：仍可对话，但 list_installed_skills 无技能可列。可到技能市场安装 Agent 包。',
  }
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
