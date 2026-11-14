import type { ToolDef } from '../agent/tool'
import { defineTool } from '../agent/tool'
import { expertHasAllSkills, type CreativeExpert } from './expertTypes'

const SKILL_READ_TOOLS = new Set(['read_skill', 'read_skill_text'])

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
    byName.set(t.name, wrapSkillReadForExpert(t, expert.skillIds))
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