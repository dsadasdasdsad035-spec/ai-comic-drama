/** 专家设置：平台工具分组（不含 list_experts） */

export const EXPERT_TOOL_GROUP_LABEL: Record<string, string> = {
  read: '读项目',
  skill: '技能',
  write: '写草稿',
  other: '其它',
}

const READ = new Set([
  'read_source',
  'read_episodes',
  'read_episode',
  'read_characters',
  'read_designs',
  'read_shots',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
])

const SKILL = new Set(['read_skill', 'read_skill_text', 'list_installed_skills'])

const WRITE = new Set([
  'validate_contract',
  'submit_characters',
  'submit_designs',
  'submit_shots',
  'submit_joins',
  'submit_prompts',
  'submit_prompt_renders',
])

export function classifyExpertTool(name: string): keyof typeof EXPERT_TOOL_GROUP_LABEL {
  if (READ.has(name)) return 'read'
  if (SKILL.has(name)) return 'skill'
  if (WRITE.has(name)) return 'write'
  return 'other'
}

export function groupExpertPlatformTools(names: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = { read: [], skill: [], write: [], other: [] }
  for (const name of names) {
    out[classifyExpertTool(name)].push(name)
  }
  for (const k of Object.keys(out)) out[k].sort()
  return out
}

export const DEFAULT_EXPERT_PLATFORM_TOOLS = [
  'read_source',
  'read_episodes',
  'read_episode',
  'read_characters',
  'read_designs',
  'read_shots',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
  'read_skill',
  'read_skill_text',
  'list_installed_skills',
  'validate_contract',
  'submit_characters',
  'submit_designs',
  'submit_shots',
  'submit_joins',
  'submit_prompts',
  'submit_prompt_renders',
]