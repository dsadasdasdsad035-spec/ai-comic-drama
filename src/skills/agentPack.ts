import { peekFrontmatterFields } from './parse'
import type { Skill, SkillProfile, SkillSource, SkillTextRecord } from './types'

export type { SkillProfile }

/** Agent 技能包在 frontmatter 中声明、本应用仅作展示与审计的壳工具名 */
export type AgentPackMeta = {
  name: string
  description: string
  allowedTools: string[]
  /** metadata.version 或 frontmatter version，缺省为 1 */
  version: number
}

const AGENT_PACK_TOOLS = ['read_skill_text', 'read_skill'] as const

/** 旧工作台 manifest：不得当作 Agent 包装载或安装 */
export function isWorkbenchManifestText(text: string): boolean {
  const fields = peekFrontmatterFields(text)
  if (fields.stage || fields.tools || fields.output || fields.contracts || fields.runtime || fields.inputs) {
    return true
  }
  if (/^##\s*角色与约束/m.test(text)) return true
  if (/^##\s*任务/m.test(text)) return true
  return false
}

export const WORKBENCH_MANIFEST_REJECT =
  '工作台形态技能已停用：请改为 SkillHub Agent 包（仅 name/description 等）；平台 read/submit 为内置 Pi 工具。'

/** 从 --- 块内扫描 allowed-tools 列表（与 SkillHub 包兼容） */
export function extractAllowedTools(text: string): string[] {
  const clean = String(text || '').replace(/^\uFEFF/, '')
  const lines = clean.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return []
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end < 0) return []
  const out: string[] = []
  let inAllowed = false
  for (const line of lines.slice(1, end)) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (top && !/^\s/.test(line)) {
      inAllowed = top[1] === 'allowed-tools'
      if (inAllowed && top[2].trim()) {
        const item = top[2].trim().replace(/^-\s*/, '')
        if (item) out.push(item)
      }
      continue
    }
    if (!inAllowed) continue
    const item = line.trim().match(/^-\s+(.+)$/)
    if (item) out.push(item[1].trim())
  }
  return [...new Set(out.filter(Boolean))]
}

export function parseAgentPackMeta(id: string, text: string): AgentPackMeta | null {
  const fields = peekFrontmatterFields(text)
  const name = String(fields.name ?? id).trim()
  if (!name) return null
  const descriptionRaw = fields.description
  const description =
    typeof descriptionRaw === 'string'
      ? descriptionRaw.trim()
      : String(descriptionRaw ?? '').trim() || `Agent 技能包「${id}」`
  let version = 1
  if (fields.version !== undefined) {
    const v = Number(fields.version)
    if (Number.isFinite(v) && v >= 1) version = Math.floor(v)
  } else {
    const m = text.match(/^metadata:\s*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+version:\s*([^\r\n]+)/m)
    if (m) {
      const v = Number(String(m[1]).trim().replace(/^['"]|['"]$/g, ''))
      if (Number.isFinite(v) && v >= 1) version = Math.floor(v)
    }
  }
  return {
    name,
    description,
    allowedTools: extractAllowedTools(text),
    version,
  }
}

/** 工作台解析失败时，仍可当作创意 Pi 宿主的最小 Skill */
export function agentPackAsSkill(record: SkillTextRecord, meta: AgentPackMeta): Skill {
  return {
    id: record.id,
    manifest: {
      name: meta.name,
      description: meta.description,
      stage: 'creative',
      runtime: 'tools',
      tools: [...AGENT_PACK_TOOLS],
      inputs: [],
      output: 'agent-pack',
      contracts: [],
      version: meta.version,
    },
    role: '',
    task: '',
    text: record.text,
    source: record.source,
    builtinText: record.builtinText,
    profile: 'agent-pack',
    agentPack: { allowedTools: meta.allowedTools },
  }
}

export function tryAgentPackSkill(record: SkillTextRecord): Skill | null {
  if (isWorkbenchManifestText(record.text)) return null
  const meta = parseAgentPackMeta(record.id, record.text)
  if (!meta) return null
  if (meta.name !== record.id) return null
  return agentPackAsSkill(record, meta)
}

/** 安装时仅接受 Agent 包；工作台形态 SKILL 请删掉 stage/tools/两节，只保留 SkillHub 写法。 */
export function classifySkillProfile(id: string, text: string, _source: SkillSource = 'upload'): SkillProfile {
  if (isWorkbenchManifestText(text)) {
    throw new Error(WORKBENCH_MANIFEST_REJECT)
  }
  const meta = parseAgentPackMeta(id, text)
  if (!meta || meta.name !== id) {
    throw new Error(`技能「${id}」无法作为 Agent 包安装：frontmatter 须含 name: ${id}`)
  }
  return 'agent-pack'
}

export function isAgentPackSkill(skill: Skill): boolean {
  return skill.profile === 'agent-pack'
}