/**
 * @deprecated 工作台 SkillChat 已在「收敛 Agent 聊天并移除发布台」（0f21f45）删除；
 * 创意工作室也已迁到宿主（`/studio/`），原 `verify-creative-notices-ui.mjs` /
 * `verify-creative-ui.mjs` 驱动的选择器都不存在了。
 *
 * 对话相关验收现在分两处：
 * - 创意会话（宿主）：`node tests/studio-flow-smoke.mjs`、`node tests/studio-shell.mjs`
 * - 3D 工作台：`verify-agent-3d-duel.mjs`
 *
 * 本脚本保留为转发入口，避免老命令直接报「文件不存在」。
 */
import { execFileSync } from 'node:child_process'

console.log('verify-workbench-chat-ui.mjs -> tests/studio-shell.mjs（创意会话外壳）')
execFileSync(process.execPath, ['tests/studio-shell.mjs'], { stdio: 'inherit', env: process.env })
console.log('verify-workbench-chat-ui.mjs -> tests/studio-flow-smoke.mjs（创意会话宿主全链路）')
execFileSync(process.execPath, ['tests/studio-flow-smoke.mjs'], { stdio: 'inherit', env: process.env })
