/**
 * @deprecated 结构化编辑器已被代码优先工作台取代。
 * 保留此入口以兼容旧命令；实际覆盖转到 verify-code-freshness.mjs。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-3d-freshness.mjs
 */
import { execFileSync } from 'node:child_process'
console.log('verify-3d-freshness.mjs -> verify-code-freshness.mjs（代码优先等价回归）')
execFileSync(process.execPath, ['verify-code-freshness.mjs'], { stdio: 'inherit', env: process.env })
