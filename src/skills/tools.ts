/** 技能文件可以引用的工具 id；真正的工具实现在阶段 2 注册。 */
export const KNOWN_TOOL_IDS = new Set([
  'read_source',
  'read_episodes',
  'read_characters',
  'read_episode',
  'read_shots',
  'read_designs',
  'submit_characters',
  'submit_designs',
  'submit_shots',
  'submit_joins',
  'submit_prompts',
  'submit_prompt_renders',
  'read_prompt_render_bundle',
  'read_transition_recipes',
  'read_asset_inventory',
  'read_asset_detail',
  'list_camera_lexicon',
  'get_camera_lexicon',
  'get_shot_context',
  'set_scene_code',
  'adopt_scene_from_job',
  'run_render',
  'capture_frames',
  'review_frames',
  'finish',
  // 3D agent full_host 服务端作业工具（须在技能 manifest 中可声明）
  'run_bash',
  'read_file',
  'write_file',
  'list_dir',
  'read_skill',
  'read_skill_text',
  'list_installed_skills',
  'list_experts',
  'validate_contract',
  // 创意会话：会话读、媒体摄取/分析、产物与生成
  'read_creative_session',
  'read_creative_source',
  'read_video_shots',
  'read_frame_detail',
  'probe_source',
  'split_scenes',
  'extract_frames',
  'submit_reverse_pack',
  'generate_image',
  'generate_video',
  'generate_voice',
])

/** 只读工具：只读技能只能拿到这些。 */
export const READ_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter(
    (id) =>
      id.startsWith('read_') ||
      id === 'list_installed_skills' ||
      id === 'list_experts' ||
      id === 'get_shot_context' ||
      id === 'list_camera_lexicon' ||
      id === 'get_camera_lexicon',
  ),
)

/** 写草稿的工具：只有宿主技能可用。 */
export const DRAFT_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('submit_')),
)
