/**
 * 由 DSH 宿主（dsh-base）注册、不经应用工具桥执行的工具名。
 * 须与 `src/creative/expertToolGroups.ts` 的 `HOST_NATIVE_TOOLS` 保持一致。
 */
export const HOST_NATIVE_TOOLS = ['bash']

/** `dsh-blender-plugin` bundle 注册的 6 个模型工具（须与插件 README 一致） */
export const BLENDER_HOST_TOOLS = [
  'blender_session',
  'blender_op',
  'blender_py',
  'blender_see',
  'blender_run',
  'blender_inspect',
]