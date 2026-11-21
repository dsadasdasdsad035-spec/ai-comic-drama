/**
 * 创意宿主侧「须确认且会落库」的工具名。
 * 与 dsh-plugin 包一起复制进 profile；应用进程从同一文件 import，避免名单漂移。
 */
export const STUDIO_SHELL_SYNC_TOOLS = new Set([
  'create_project',
  'update_project_meta',
  'delete_shots',
  'submit_episodes',
  'submit_characters',
  'submit_designs',
  'submit_prompts',
  'submit_shots',
  'submit_assets',
  'submit_joins',
  'set_character_visual',
  'set_shot_camera_lexicon',
  'link_shot_refs',
])

export function isStudioShellSyncTool(name) {
  return STUDIO_SHELL_SYNC_TOOLS.has(String(name || ''))
}