/**
 * @deprecated 工作台 SkillChat 已在「收敛 Agent 聊天并移除发布台」（0f21f45）删除：
 * 剧本/角色/素材/镜头表/提示词工作台不再挂聊天面板，`[data-script-chat]` 一类选择器
 * 已不存在，本脚本无法再驱动它。对话壳现在只剩创意工作室与 3D：
 * - 创意会话的续写/压缩提示：verify-creative-notices-ui.mjs（提示可见、重开会话仍在）
 * - 创意会话整体 UI：verify-creative-ui.mjs
 * 跑法：node verify-workbench-chat-ui.mjs（转发到续写提示验收）
 */
import { execFileSync } from 'node:child_process'
console.log('verify-workbench-chat-ui.mjs -> verify-creative-notices-ui.mjs（创意对话壳的续写提示）')
execFileSync(process.execPath, ['verify-creative-notices-ui.mjs'], { stdio: 'inherit', env: process.env })
