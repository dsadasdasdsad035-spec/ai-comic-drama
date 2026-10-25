/** 技能文件可以引用的工具 id；真正的工具实现在阶段 2 注册。 */
export const KNOWN_TOOL_IDS = new Set([
  'read_source',
  'read_episodes',
  'read_script',
  'read_characters',
  'read_episode',
  'read_shots',
  'read_designs',
  'submit_script',
  'submit_characters',
  'submit_designs',
  'submit_shots',
  'submit_prompts',
  'get_shot_context',
  'begin_scene_draft',
  'append_scene_draft',
  'read_scene_draft',
  'patch_scene_draft',
  'commit_scene_draft',
  'discard_scene_draft',
  'set_scene_code',
  'run_render',
  'capture_frames',
  'review_frames',
  'finish',
])

/** 只读工具：只读技能只能拿到这些。 */
export const READ_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('read_') || id === 'get_shot_context'),
)

/** 写草稿的工具：只有宿主技能可用。 */
export const DRAFT_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('submit_')),
)
