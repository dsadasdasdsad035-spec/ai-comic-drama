/**
 * 把工具桥以「本地 bundle」的形式装进 dsh 的 profile。
 *
 * 为什么不是改 `cordis.patch.yml`：profile 的用户层只能**覆盖已有行**，
 * 新增行会被拒绝（`patch: entry "xxx" not found`）。新增插件必须来自
 * `dsh.profile.bundles` 里的 bundle 层，而 bundle 需要是一个带 `dsh.bundle.patch`
 * 元数据、并且能被 Node 从 profile 目录解析到的包。
 *
 * 所以这里做三件事，全部幂等：
 * 1. 把插件目录复制到 `<profile>/node_modules/dsh-plugin-creative-tools`；
 * 2. 在 profile 的 `package.json` 里登记依赖与 bundle 选择；
 * 3. 不动 profile 的用户层 patch —— 那里只放模型配置。
 *
 * 复制而不是软链：Windows 上建软链需要额外权限，而这三个文件加起来不到 10KB。
 */
import fs from 'node:fs'
import path from 'node:path'

export const CREATIVE_TOOLS_BUNDLE = 'dsh-plugin-creative-tools'
/** 专家闸门插件：被 preset 子插件列表按包名引用，必须能从 profile 目录解析到 */
export const CREATIVE_EXPERT_PLUGIN = 'dsh-plugin-creative-expert'

/**
 * web profile 的基础层。必须完整保留：`dsh.profile.bundles` 是**全量选择**，
 * 只写我们自己那一项会把 dsh-base / dsh-web-app 一起踢掉，
 * 表现出来就是插件永远挂在 `waiting for service: tools`。
 */
const BASE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** bundle 源目录（随应用分发的插件源码） */
export function bundleSourceDir(root) {
  return path.join(root, 'server', 'dsh-plugins', 'creative-tools')
}

/** 专家闸门插件源目录 */
export function expertPluginSourceDir(root) {
  return path.join(root, 'server', 'dsh-plugins', 'creative-expert')
}

/** profile 目录：与 studio-profile.mjs 的 profilePatchPath 保持同一位置约定 */
export function profileDir(dshHome) {
  return path.join(dshHome, 'profiles', 'web')
}

/**
 * 把插件源码复制进 profile 的 node_modules（内容相同则跳过）。
 * @returns 是否有变化
 */
function copyPluginPackage(source, dest, files, log) {
  if (!fs.existsSync(path.join(source, 'index.js'))) {
    throw new Error(`插件源码缺失：${source}`)
  }
  fs.mkdirSync(dest, { recursive: true })
  let changed = false
  for (const file of files) {
    const from = path.join(source, file)
    const to = path.join(dest, file)
    if (!fs.existsSync(from)) continue
    const next = fs.readFileSync(from, 'utf8')
    const prev = fs.existsSync(to) ? fs.readFileSync(to, 'utf8') : null
    if (prev !== next) {
      fs.writeFileSync(to, next, 'utf8')
      changed = true
    }
  }
  return changed
}

/**
 * 安装/更新工具桥 bundle 与专家闸门插件。
 * @param {{ dshHome: string, root: string, log?: (line: string) => void }} options
 * @returns {{ installed: boolean, profileDir: string }}
 */
export function installCreativeToolsBundle({ dshHome, root, log = () => {} }) {
  const source = bundleSourceDir(root)
  const target = profileDir(dshHome)
  const dest = path.join(target, 'node_modules', CREATIVE_TOOLS_BUNDLE)

  if (!fs.existsSync(path.join(source, 'index.js'))) {
    throw new Error(`工具桥插件源码缺失：${source}`)
  }

  let changed = copyPluginPackage(source, dest, ['index.js', 'package.json', 'cordis.patch.yml'], log)

  // 专家闸门插件不是 bundle（它只被 preset 子插件列表按包名引用），
  // 但同样必须能被 profile 目录解析到，否则 preset 加载时会报找不到插件。
  const expertDest = path.join(target, 'node_modules', CREATIVE_EXPERT_PLUGIN)
  if (copyPluginPackage(expertPluginSourceDir(root), expertDest, ['index.js', 'package.json'], log)) changed = true

  // profile 的 package.json：dsh 按 dependencies + dsh.profile.bundles 决定加载哪些层
  const manifestPath = path.join(target, 'package.json')
  let manifest = {}
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      log(`[studio-bundle] profile 清单损坏，已重建：${e?.message || String(e)}`)
      manifest = {}
    }
  }
  manifest.name = manifest.name || 'dsh-profile-web'
  manifest.private = true
  manifest.dependencies = { ...(manifest.dependencies || {}) }
  // 用 file: 指回源码目录：以后升级应用时复制到 node_modules 的内容由本函数刷新
  manifest.dependencies[CREATIVE_TOOLS_BUNDLE] = `file:${source}`
  // 闸门插件是普通依赖（无 dsh.bundle），装进 profile 只为能被按名解析
  manifest.dependencies[CREATIVE_EXPERT_PLUGIN] = `file:${expertPluginSourceDir(root)}`
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.length
    ? [...manifest.dsh.profile.bundles]
    : [...BASE_BUNDLES]
  // 基础层必须在前面：bundle 的 patch 是按顺序叠加的，我们这层要叠在它们之上
  for (const base of BASE_BUNDLES) {
    if (!bundles.includes(base)) bundles.unshift(base)
  }
  if (!bundles.includes(CREATIVE_TOOLS_BUNDLE)) bundles.push(CREATIVE_TOOLS_BUNDLE)
  manifest.dsh = { ...(manifest.dsh || {}), profile: { ...(manifest.dsh?.profile || {}), bundles } }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== serialized) {
    fs.writeFileSync(manifestPath, serialized, 'utf8')
    changed = true
  }
  fs.writeFileSync(path.join(target, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', 'utf8')

  if (changed) log(`[studio-bundle] 已安装工具桥 bundle：${dest}`)
  return { installed: changed, profileDir: target }
}
