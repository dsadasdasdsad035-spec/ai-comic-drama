/**
 * @deprecated 结构化拖拽编辑器已移除；旧结构化镜头现在只读，转换入口由代码工作台提供。
 * 实际覆盖转到 verify-code-auto-legacy.mjs。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-scene-blocking.mjs
 */
import { execFileSync } from 'node:child_process'
console.log('verify-scene-blocking.mjs -> verify-code-auto-legacy.mjs（legacy 只读/显式转换）')
execFileSync(process.execPath, ['verify-code-auto-legacy.mjs'], { stdio: 'inherit', env: process.env })
