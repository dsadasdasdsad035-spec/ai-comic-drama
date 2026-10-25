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
  // 创意会话：会话读、媒体摄取/分析、产物与生成
  'read_creative_session',
  'read_creative_source',
  'read_video_shots',
  'read_frame_detail',
  'ingest_source',
  'probe_source',
  'split_scenes',
  'extract_frames',
  'submit_reverse_pack',
  'generate_image',
  'generate_video',
  'generate_voice',
  // 发布助手：读当前事实、写发布配置、暂存提交意图
  'read_publish_state',
  'read_deliverables',
  'read_config',
  'read_accounts',
  'read_platforms',
  'read_preflight',
  'read_jobs',
  'set_targets',
  'set_copy',
  'set_mode',
  'set_cover',
  'stage_submit',
  'stage_package',
  'connect_account',
  'ask_user',
])

/** 只读工具：只读技能只能拿到这些。 */
export const READ_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('read_') || id === 'get_shot_context'),
)

/** 写草稿的工具：只有宿主技能可用。 */
export const DRAFT_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('submit_')),
)
