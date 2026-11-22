/**
 * 把仓库根目录的 `.env` 读进 `process.env`。
 *
 * 为什么需要它：`.env` 原本只被 docker compose 读取（compose 自己会解析它），
 * 桌面端与 `npm run dev` 从来没有加载过——渠道 Key 之所以还能用，是因为
 * `app.ts` 里的 `readEnvKey()` 会单独去读这个文件。但创意摄取（DTK / yt-dlp）
 * 走的是 `applyCreativeEnvDefaults(..., process.env)`，进程环境里没有 `DTK_*`，
 * 于是设置页明明写着"已启用"、运行时却报"没有可用的解析器"。
 *
 * 语义与 compose 一致：文件里的值**不覆盖**已存在的环境变量（显式
 * `DTK_API_KEY=… ./app` 仍然优先）。文件不存在时静默返回 false。
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * @param {string} root 仓库根目录（`.env` 所在处）
 * @returns {boolean} 是否读到了文件
 */
export function loadDotEnv(root) {
  const file = path.join(root, '.env')
  try {
    if (!fs.existsSync(file)) return false
  } catch {
    return false
  }
  // node:loadEnvFile 从 20.12 起可用；随包 Node 与 Electron 自带 Node 都满足
  if (typeof process.loadEnvFile !== 'function') return false
  try {
    process.loadEnvFile(file)
    return true
  } catch {
    // 语法错误、无读权限等都不该拦住服务启动：其余功能不依赖它
    return false
  }
}
