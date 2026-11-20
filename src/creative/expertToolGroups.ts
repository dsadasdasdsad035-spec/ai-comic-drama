/** 专家设置：平台工具分组（不含 list_experts） */
import { SKILL_READ_TOOL_NAMES } from '../skills/tools'

/** dsh-base 自带、不经应用工具桥的工具（与 server/studio-host-tools.mjs 同步） */
export const HOST_NATIVE_TOOLS = ['bash'] as const

/** dsh-blender-plugin 注册的模型工具（与 server/studio-host-tools.mjs 同步） */
export const BLENDER_HOST_TOOLS = [
  'blender_session',
  'blender_op',
  'blender_py',
  'blender_see',
  'blender_run',
  'blender_inspect',
] as const

export const EXPERT_TOOL_GROUP_LABEL: Record<string, string> = {
  read: '读项目',
  skill: '技能',
  write: '写草稿',
  project: '项目与分镜管理',
  generate: '生成（有成本）',
  host: '宿主 Shell',
  blender: 'Blender',
  other: '其它',
}

const HOST = new Set<string>(HOST_NATIVE_TOOLS)
const BLENDER = new Set<string>(BLENDER_HOST_TOOLS)

const READ = new Set([
  'read_source',
  'read_episodes',
  'read_episode',
  'read_characters',
  'read_designs',
  'read_shots',
  'read_shot_detail',
  'read_shot_video_prompt',
  'read_shot_video_inputs',
  'read_transition_video_inputs',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
  'list_projects',
])

const SKILL = new Set<string>(SKILL_READ_TOOL_NAMES)

const WRITE = new Set([
  'submit_episodes',
  'submit_characters',
  'submit_designs',
  'submit_assets',
  'submit_shots',
  'submit_joins',
  'submit_prompts',
])

const PROJECT = new Set([
  'create_project',
  'update_project_meta',
  'delete_shots',
  // 画布与角色上的写动作：改的是项目里的具体对象，不是整表草稿
  'link_shot_refs',
  'attach_transition_refs',
  'set_transition_audio',
  'set_shot_camera_lexicon',
  'set_character_visual',
  'set_shot_video_options',
  'set_shot_video_override',
  'set_shot_ref_extras',
  'set_shot_neighbor_refs',
])
const GENERATE = new Set([
  'generate_keyframe',
  'generate_clip',
  'generate_voice',
  'generate_character_views',
  'generate_expression_sheet',
])

export function classifyExpertTool(name: string): keyof typeof EXPERT_TOOL_GROUP_LABEL {
  if (READ.has(name)) return 'read'
  if (SKILL.has(name)) return 'skill'
  if (WRITE.has(name)) return 'write'
  if (PROJECT.has(name)) return 'project'
  if (GENERATE.has(name)) return 'generate'
  if (BLENDER.has(name)) return 'blender'
  if (HOST.has(name)) return 'host'
  return 'other'
}

export function groupExpertPlatformTools(names: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {
    read: [],
    skill: [],
    write: [],
    project: [],
    generate: [],
    host: [],
    blender: [],
    other: [],
  }
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
  'read_shot_detail',
  'read_shot_video_prompt',
  'read_shot_video_inputs',
  'read_transition_video_inputs',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
  'read_skill',
  'read_skill_text',
  'read_skill_file',
  'list_installed_skills',
  'list_projects',
  'submit_episodes',
  'submit_characters',
  'submit_designs',
  'submit_assets',
  'submit_shots',
  'submit_joins',
  'submit_prompts',
  'create_project',
  'update_project_meta',
  'delete_shots',
  'generate_keyframe',
  'generate_clip',
  'generate_voice',
  'link_shot_refs',
  'attach_transition_refs',
  'set_transition_audio',
  'set_shot_camera_lexicon',
  'set_character_visual',
  'set_shot_video_options',
  'set_shot_video_override',
  'set_shot_ref_extras',
  'set_shot_neighbor_refs',
  'generate_character_views',
  'generate_expression_sheet',
  ...HOST_NATIVE_TOOLS,
]