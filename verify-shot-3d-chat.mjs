/**
 * @deprecated 受限 patch 聊天已由完整代码聊天取代。
 * 实际覆盖转到 verify-code-workbench.mjs。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-shot-3d-chat.mjs
 */
import { execFileSync } from 'node:child_process'
console.log('verify-shot-3d-chat.mjs -> verify-code-workbench.mjs（完整代码聊天/试运行/撤销）')
execFileSync(process.execPath, ['verify-code-workbench.mjs'], { stdio: 'inherit', env: process.env })
