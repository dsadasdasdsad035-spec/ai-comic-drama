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
/** 上游 Blender 直连 bundle（npm 包 `dsh-blender-plugin`） */
export const BLENDER_PLUGIN_BUNDLE = 'dsh-blender-plugin'
/**
 * 知识库选择器 bundle：浏览器半边在会话头部注册「本会话检索哪个库」下拉。
 * 与 creative-tools 同为本地 bundle（需要 patch 层才能新增插件行）。
 */
export const KNOWLEDGE_UI_PLUGIN = 'dsh-plugin-knowledge-ui'

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

/** `dsh-blender-plugin` 安装路径（缺失时跳过 bundle 登记） */
export function blenderPluginDir(root) {
  return path.join(root, 'node_modules', BLENDER_PLUGIN_BUNDLE)
}

/** 专家闸门插件源目录 */
export function expertPluginSourceDir(root) {
  return path.join(root, 'server', 'dsh-plugins', 'creative-expert')
}

/** 知识库选择器插件源目录 */
export function knowledgeUiSourceDir(root) {
  return path.join(root, 'server', 'dsh-plugins', 'knowledge-ui')
}

/** profile 目录：与 studio-profile.mjs 的 profilePatchPath 保持同一位置约定 */
export function profileDir(dshHome) {
  return path.join(dshHome, 'profiles', 'web')
}

/**
 * profile 清单里声明的 bundle 层。
 *
 * 宿主对解析不到的 bundle 只是跳过并打一行日志，不会失败；应用侧拿这份清单在启动后
 * 核对「该起的都起了」，否则少一个插件只会表现成功能凭空消失。
 * @returns {string[]} 声明的 bundle 包名；读不到清单时返回空数组
 */
export function expectedBundles(dshHome) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir(dshHome), 'package.json'), 'utf8'))
    const bundles = manifest?.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name) => typeof name === 'string') : []
  } catch {
    return []
  }
}

/**
 * 插件需要但源码在 server/ 根目录的共享模块。
 *
 * 为什么不在 server/dsh-plugins/creative-tools/ 里放第二份：那会变成两份实现，
 * 迟早不一致。这里在安装时从唯一来源复制过去，并且复制清单里已声明，
 * copyPluginPackage 会校验它存在。
 */
const SHARED_PLUGIN_MODULES = ['studio-tool-aliases.mjs']

/** 共享模块的源目录（server/ 根） */
function sharedModuleDir(root) {
  return path.join(root, 'server')
}

/**
 * 把共享模块同步进插件源目录，使插件包自包含。
 * 目标文件由 .gitignore 忽略（生成物，不属于源码树）。
 * @returns 是否有变化
 */
function syncSharedModulesIntoPlugin(root, log) {
  const from = sharedModuleDir(root)
  const to = bundleSourceDir(root)
  let changed = false
  for (const file of SHARED_PLUGIN_MODULES) {
    const src = path.join(from, file)
    const dest = path.join(to, file)
    if (!fs.existsSync(src)) throw new Error(`共享模块缺失：${src}`)
    const next = fs.readFileSync(src, 'utf8')
    const prev = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf8') : null
    if (prev !== next) {
      fs.writeFileSync(dest, next, 'utf8')
      changed = true
      log(`[studio-bundle] 已同步共享模块 ${file} → ${path.relative(root, to)}`)
    }
  }
  return changed
}

/**
 * 把上游 Blender bundle 链进 profile 的 node_modules。
 *
 * 为什么是软链而不是像工具桥那样逐文件复制：
 * 1. 这个包 11MB，`lib/` 里还有二进制与大量子模块，文件清单无法穷举，
 *    漏一个就是「插件加载失败但只打一行 warn」；
 * 2. 它的 peer 依赖（`@deepseek-ai/dsh-tools` 等）只装在应用根 node_modules，
 *    profile 目录下没有。软链让 Node 按 realpath 从应用根解析，peer 才能找到；
 *    复制一份反而会让 peer 解析失败。
 *
 * 为什么必须落在这里：宿主按**包名**从 profile 目录解析 bundle 层。只在 profile 的
 * `package.json` 里写 `file:` 依赖是不够的 —— 没有任何一步会替我们跑 pnpm install，
 * 于是每次启动都 `ERR_MODULE_NOT_FOUND`，整层 Blender 工具静默消失。
 *
 * @returns 是否有变化
 */
function linkBlenderBundle(source, dest, log) {
  let prevTarget = null
  try {
    prevTarget = fs.readlinkSync(dest)
  } catch {
    /* 不存在或不是链接 */
  }
  if (prevTarget === source) return false
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir')
  log(`[studio-bundle] 已链接 ${BLENDER_PLUGIN_BUNDLE} → ${source}`)
  return true
}

/**
 * 把插件源码复制进 profile 的 node_modules（内容相同则跳过）。
 *
 * 清单里的文件缺失时就**抛错**而不是跳过。这里曾静默 continue，
 * 导致 index.js 新增的 import 没被一起部署时整个插件加载失败却无人察觉：
 * 宿主只打一行 warn，界面上所有工具凭空消失，模型只能看到宿主自带工具。
 * 宁可启动时报错，也好过半残的插件桥 —— 这与 creative-tools 插件
 * 「缺 baseUrl/token 就整插件不注册」的取舍一致。
 *
 * @returns 是否有变化
 */
function copyPluginPackage(source, dest, files, log) {
  if (!fs.existsSync(path.join(source, 'index.js'))) {
    throw new Error(`插件源码缺失：${source}`)
  }
  const missing = files.filter((file) => !fs.existsSync(path.join(source, file)))
  if (missing.length) {
    throw new Error(`插件源码缺文件：${missing.join('、')}（目录 ${source}）`)
  }
  fs.mkdirSync(dest, { recursive: true })
  let changed = false
  for (const file of files) {
    const from = path.join(source, file)
    const to = path.join(dest, file)
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

  // 先把共享模块同步进插件源目录，插件包才会自包含（index.js 用 './' 引用）
  let changed = syncSharedModulesIntoPlugin(root, log)

  if (
    copyPluginPackage(
      source,
      dest,
      ['index.js', 'package.json', 'cordis.patch.yml', 'shell-sync-tools.mjs', ...SHARED_PLUGIN_MODULES],
      log,
    )
  ) {
    changed = true
  }

  // 专家闸门插件不是 bundle（它只被 preset 子插件列表按包名引用），
  // 但同样必须能被 profile 目录解析到，否则 preset 加载时会报找不到插件。
  const expertDest = path.join(target, 'node_modules', CREATIVE_EXPERT_PLUGIN)
  if (copyPluginPackage(expertPluginSourceDir(root), expertDest, ['index.js', 'package.json'], log)) changed = true

  // 知识库选择器是 bundle（浏览器半边 + patch 层）：需要 index.js / client.js /
  // package.json / cordis.patch.yml 四件套，缺 client.js 就没有插槽组件。
  const knowledgeSource = knowledgeUiSourceDir(root)
  const knowledgeDest = path.join(target, 'node_modules', KNOWLEDGE_UI_PLUGIN)
  if (
    copyPluginPackage(
      knowledgeSource,
      knowledgeDest,
      ['index.js', 'client.js', 'package.json', 'cordis.patch.yml'],
      log,
    )
  ) {
    changed = true
  }

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
  manifest.dependencies[KNOWLEDGE_UI_PLUGIN] = `file:${knowledgeUiSourceDir(root)}`
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.length
    ? [...manifest.dsh.profile.bundles]
    : [...BASE_BUNDLES]
  // 基础层必须在前面：bundle 的 patch 是按顺序叠加的，我们这层要叠在它们之上
  for (const base of BASE_BUNDLES) {
    if (!bundles.includes(base)) bundles.unshift(base)
  }
  if (!bundles.includes(CREATIVE_TOOLS_BUNDLE)) bundles.push(CREATIVE_TOOLS_BUNDLE)
  if (!bundles.includes(KNOWLEDGE_UI_PLUGIN)) bundles.push(KNOWLEDGE_UI_PLUGIN)
  const blenderPkg = blenderPluginDir(root)
  const blenderEntry = path.join(blenderPkg, 'lib', 'index.js')
  if (fs.existsSync(blenderEntry)) {
    manifest.dependencies[BLENDER_PLUGIN_BUNDLE] = `file:${blenderPkg}`
    if (!bundles.includes(BLENDER_PLUGIN_BUNDLE)) bundles.push(BLENDER_PLUGIN_BUNDLE)
    if (linkBlenderBundle(blenderPkg, path.join(target, 'node_modules', BLENDER_PLUGIN_BUNDLE), log)) changed = true
  } else {
    log(
      `[studio-bundle] 未找到 ${BLENDER_PLUGIN_BUNDLE}，跳过 Blender bundle（npm install dsh-blender-plugin@3.1.0-alpha.1 --legacy-peer-deps）`,
    )
  }
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
