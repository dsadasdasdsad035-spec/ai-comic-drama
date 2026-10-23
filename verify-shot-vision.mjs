/**
 * @deprecated 参考板 VisualBrief 已由可选中素材的 MediaBrief 取代。
 * 实际覆盖转到 verify-media-brief.mjs。
 * 跑法：APP_URL=http://127.0.0.1:5280 node verify-shot-vision.mjs
 */
import { execFileSync } from 'node:child_process'
console.log('verify-shot-vision.mjs -> verify-media-brief.mjs（媒体 brief/缓存/关键帧）')
execFileSync(process.execPath, ['verify-media-brief.mjs'], { stdio: 'inherit', env: process.env })
