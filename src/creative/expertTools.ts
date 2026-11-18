import type { ToolDef } from '../agent/tool'
import { defineTool } from '../agent/tool'
import { expertHasAllSkills, type CreativeExpert } from './expertTypes'
import { SKILL_DIRECTORY_TOOLS, SKILL_ID_READ_TOOLS } from '../skills/tools'

const SKILL_READ_TOOLS = new Set<string>(SKILL_ID_READ_TOOLS)
const SKILL_DIRECTORY_TOOL = SKILL_DIRECTORY_TOOLS[0]

/** 专家模式下限制 read_skill* 仅允许名单内 id；名单含 `*` 表示全部已安装技能 */
export function wrapSkillReadForExpert(tool: ToolDef, allowedSkillIds: string[]): ToolDef {
  if (!SKILL_READ_TOOLS.has(tool.name)) return tool
  if (expertHasAllSkills(allowedSkillIds)) return tool
  const allowed = new Set(allowedSkillIds.map((x) => String(x).trim()).filter(Boolean))
  return defineTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    run: async (args) => {
      const id = String((args as { id?: string }).id || '').trim()
      if (!allowed.size) {
        return { ok: false, error: '当前专家未配置可读技能名单' }
      }
      if (!allowed.has(id)) {
        return { ok: false, error: `专家不允许读取技能「${id}」` }
      }
      return tool.run(args as never)
    },
  })
}

type SkillListRow = { id: string }
type SkillListResult = {
  ok?: boolean
  count?: number
  skills?: SkillListRow[]
  loadIssues?: unknown[]
  note?: string
}

/**
 * 专家模式下让 `list_installed_skills` 的可见集等于可读集。
 *
 * 列表曾返回全部技能、读取才按白名单拒绝，模型会先推荐再吃闭门羹，
 * 用户看到的是「技能明明在列表里却读不到」。这里把限制前移，并说明还有多少被限制。
 */
export function wrapSkillListForExpert(
  tool: ToolDef,
  expert: Pick<CreativeExpert, 'name' | 'skillIds'>,
): ToolDef {
  if (tool.name !== SKILL_DIRECTORY_TOOL) return tool
  if (expertHasAllSkills(expert.skillIds)) return tool
  const allowed = new Set(expert.skillIds.map((x) => String(x).trim()).filter(Boolean))
  return defineTool({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
    run: async (args) => {
      const out = (await tool.run(args as never)) as SkillListResult
      if (!out || out.ok === false || !Array.isArray(out.skills)) return out
      const kept = out.skills.filter((s) => allowed.has(String(s.id)))
      const blocked = out.skills.length - kept.length
      const next: SkillListResult = { ...out, count: kept.length, skills: kept }
      if (!allowed.size) {
        next.note = `专家「${expert.name}」未配置可读技能名单：共 ${out.skills.length} 个技能全部不可读，请让用户在专家设置里勾选技能。`
        return next
      }
      if (blocked > 0) {
        next.note = `另有 ${blocked} 个技能被专家「${expert.name}」限制，不在本列表内；需要时请提示用户在顶栏切到「无（技能目录）」或调整专家白名单。`
      }
      return next
    },
  })
}

export function buildCreativeExpertTools(
  expert: CreativeExpert,
  platformTools: ToolDef[],
  mcpTools: ToolDef[],
  listExpertsTool: ToolDef,
): ToolDef[] {
  const allowed = new Set(expert.toolIds)
  const byName = new Map<string, ToolDef>()
  for (const t of platformTools) {
    if (!allowed.has(t.name)) continue
    byName.set(t.name, wrapSkillListForExpert(wrapSkillReadForExpert(t, expert.skillIds), expert))
  }
  for (const t of mcpTools) {
    if (allowed.has(t.name)) byName.set(t.name, t)
  }
  byName.set(listExpertsTool.name, listExpertsTool)
  return [...byName.values()]
}

export function expertToolNames(expert: CreativeExpert): string[] {
  const names = new Set(expert.toolIds)
  names.add('list_experts')
  return [...names].sort()
}
