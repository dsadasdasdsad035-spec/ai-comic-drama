/**
 * 技能读工具的唯一登记点：新增技能读工具只改这里。
 *
 * `SKILL_ID_READ_TOOLS` 按技能 id 读内容，受专家白名单约束；
 * `SKILL_DIRECTORY_TOOLS` 只列目录，没有 id 可约束。
 * 四处消费方（已知工具表 / 专家分组 / 白名单包装 / 会话工具名单）都引用这两个常量，
 * 避免「注册了但专家模式用不了」这类漏改。
 */
export const SKILL_ID_READ_TOOLS = ['read_skill', 'read_skill_text', 'read_skill_file'] as const
export const SKILL_DIRECTORY_TOOLS = ['list_installed_skills'] as const
export const SKILL_READ_TOOL_NAMES = [...SKILL_ID_READ_TOOLS, ...SKILL_DIRECTORY_TOOLS]

/** 技能文件可以引用的工具 id；真正的工具实现在阶段 2 注册。 */
export const KNOWN_TOOL_IDS = new Set([
  'read_source',
  'read_episodes',
  'read_characters',
  'read_episode',
  'read_shots',
  'read_shot_detail',
  'read_shot_video_prompt',
  'read_shot_video_inputs',
  'read_transition_video_inputs',
  'read_designs',
  'submit_episodes',
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
  'read_skill_file',
  'list_installed_skills',
  'list_experts',
  'list_projects',
  'validate_contract',
  // 项目与分镜管理（需用户确认）：新建项目、改项目设定、删分镜
  'create_project',
  'update_project_meta',
  'delete_shots',
  // 生成（有成本，需成本确认）：首帧 / 出片 / 配音 / 角色三视图 / 表情总图
  'generate_keyframe',
  'generate_clip',
  'generate_voice',
  'generate_character_views',
  'generate_expression_sheet',
  // 画布动作（按名字寻址，不用画布节点 id）：连参考 / 指定运镜参照 / 采纳角色外观 / 素材卡
  'link_shot_refs',
  'attach_transition_refs',
  'set_transition_audio',
  'set_shot_camera_lexicon',
  'set_character_visual',
  'set_shot_video_options',
  'set_shot_video_override',
  'set_shot_ref_extras',
  'set_shot_neighbor_refs',
  'submit_assets',
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
      id === 'list_projects' ||
      id === 'get_shot_context' ||
      id === 'list_camera_lexicon' ||
      id === 'get_camera_lexicon',
  ),
)

/** 写草稿的工具：只有宿主技能可用。 */
export const DRAFT_TOOL_IDS = new Set(
  [...KNOWN_TOOL_IDS].filter((id) => id.startsWith('submit_')),
)

/**
 * 支持分批提交的写工具：契约主集合是数组、且业务键稳定（镜号、角色名、素材标题…）。
 *
 * 技能提示提到「一次写不完」时指向这些工具的 `limit` / `cursor`： 分批按业务键合并，未提交的条目不会被删除；游标由宿主签发，失效时用对应读工具重读。
 */
export const PAGED_WRITE_TOOL_IDS = new Set([
  'submit_shots',
  'submit_prompts',
  'submit_prompt_renders',
  'submit_characters',
  'submit_assets',
  'submit_joins',
  'submit_episodes',
])
