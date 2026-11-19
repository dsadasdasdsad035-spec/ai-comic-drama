/**
 * 创意会话工具桥的**单一来源**出口。
 *
 * 这个文件只做一件事：把应用里已有的工具集（平台读写工具 + Pi 原生技能工具）
 * 原样导出，供 `server/studio-tool-bridge.mjs` 在 Node 里加载。
 *
 * 为什么要有它：
 * - 工具声明（JSON Schema）与执行都必须来自同一份 `ToolDef`，不能为宿主再手写一份；
 * - 工具的实现在浏览器侧（它们用相对路径调 `/api/*`），所以这里按 browser 语义打包，
 *   由 bridge 在 Node 里补 fetch 垫片，把相对路径指回本机。
 */
export { createBuiltinPlatformTools, mergeBuiltinWithSkillTools } from '../src/agent/builtinPlatformTools'
export { createPiNativeToolSet } from '../src/agent/stageTools'
export { modelFacingResult } from '../src/agent/agentToolResult'
export type { ToolDef } from '../src/agent/tool'
