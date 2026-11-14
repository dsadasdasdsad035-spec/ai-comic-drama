/**
 * 媒体根与只读资产根的解析。
 *
 * 为什么单独成一个模块：
 * 1. 桌面端安装包内的代码目录是只读的，运行时产物必须落到用户数据目录；
 *    但如果每个 server/*.mjs 各自读 env，就会出现「一半写 public、一半写别处」。
 * 2. URL 前缀（/generated、/videos ...）必须保持不变，否则前端与 100+ 个验收脚本全要改。
 *    所以只换磁盘根，不换 URL。
 *
 * 约定：
 * - SB_MEDIA_ROOT 存在时，媒体根 = 该路径；否则回退 <root>/public（保持现有开发行为）。
 * - 只读资产根永远是 <root>/public（presets 这类随代码分发的东西）。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 允许通过 URL 前缀读写的媒体子目录；与 vite.config.ts 的静态分发分支一致 */
export const MEDIA_DIRS = [
  'generated',
  'videos',
  'voices',
  'exports',
  'publish-packages',
  'lipsync-qa',
  'imports',
]

/** 媒体根：可写目录 */
export function resolveMediaRoot(appRoot) {
  const env = String(process.env.SB_MEDIA_ROOT || '').trim()
  if (env) return path.resolve(env)
  return path.join(path.resolve(appRoot || process.cwd()), 'public')
}

/** 只读资产根：随代码分发，不参与运行时写入 */
export function resolveStaticRoot(appRoot) {
  return path.join(path.resolve(appRoot || process.cwd()), 'public')
}

/**
 * 媒体根下的绝对路径。越界（../、绝对路径）直接抛错，不返回可疑路径。
 * 不创建目录：读路径也会走这里，创建空目录是副作用。
 */
export function mediaPath(appRoot, ...segments) {
  const root = resolveMediaRoot(appRoot)
  const rel = path.join(...segments.filter((s) => s !== undefined && s !== null && s !== ''))
  const full = path.join(root, rel)
  const back = path.relative(root, full)
  if (!back || back.startsWith('..') || path.isAbsolute(back)) {
    throw new Error(`媒体路径越界：${rel}`)
  }
  return full
}

/** 写盘前用这个：先越界校验再建目录 */
export function ensureMediaDir(appRoot, ...segments) {
  const dir = mediaPath(appRoot, ...segments)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 站内 URL 路径 → 媒体根下的绝对路径；越界抛错。
 * 例：'/videos/a.mp4' → <mediaRoot>/videos/a.mp4
 */
export function mediaPathFromUrl(appRoot, url) {
  const raw = String(url || '').split('?')[0].replace(/^\//, '')
  return mediaPath(appRoot, raw)
}
