/**
 * 桌面端的数据根计算。
 *
 * 为什么放在主进程而不是服务端（见 design.md 决策 6）：
 * 「macOS 的 Application Support 在哪」是平台知识，服务端要保持平台无关；
 * 而且主进程本来就是唯一负责注入环境变量的地方。
 *
 * 三个根各有分工：
 * - projects/  项目库（SQLite + 项目目录），用户会想备份
 * - media/     生成产物、视频、配音、导出包，体积大但同样要备份
 * - state/     暂存、渲染作业、场景草稿、计费库，机器私有
 */
import fs from 'node:fs'
import path from 'node:path'

export const DATA_SUBDIRS = ['projects', 'media', 'state']

/**
 * 计算并（按需）创建三个数据子目录。
 * @param {string} userData  app.getPath('userData')
 * @returns {{ projects: string, media: string, state: string, env: Record<string,string> }}
 */
export function resolveDataRoots(userData, { create = true, env = process.env } = {}) {
  const base = path.resolve(userData)
  const defaults = {
    projects: path.join(base, 'projects'),
    media: path.join(base, 'media'),
    state: path.join(base, 'state'),
  }
  // 显式配置优先（specs/desktop-app-packaging「用户自定义数据位置」）：
  // 已设置的环境变量不被默认值覆盖，这样用户能整体搬迁项目库或把媒体放到外置卷，
  // 也让「用打包产物承载服务跑既有验收脚本」可以指向与 dev 相同的数据。
  const given = {
    projects: String(env.SB_PROJECTS_DIR || '').trim(),
    media: String(env.SB_MEDIA_ROOT || '').trim(),
    state: String(env.SB_STATE_ROOT || '').trim(),
  }
  const roots = {
    projects: given.projects ? path.resolve(given.projects) : defaults.projects,
    media: given.media ? path.resolve(given.media) : defaults.media,
    state: given.state ? path.resolve(given.state) : defaults.state,
  }
  if (create) {
    for (const dir of Object.values(roots)) fs.mkdirSync(dir, { recursive: true })
  }
  return {
    ...roots,
    /** 注入给服务进程；三项都是显式路径，服务端不再做任何平台推断 */
    env: {
      SB_PROJECTS_DIR: roots.projects,
      SB_MEDIA_ROOT: roots.media,
      SB_STATE_ROOT: roots.state,
    },
  }
}

/**
 * 老版本数据位置探测（只探测不迁移）。
 *
 * 用户可能已经在仓库目录里跑过 dev 版，那里有 projects/ 与 public/ 产物。
 * 首次启动时给出提示，让用户知道旧数据在哪、要不要自己搬。
 */
export function detectLegacyData(appRoot) {
  const found = []
  const legacyProjects = path.join(appRoot, 'projects')
  const legacyMedia = path.join(appRoot, 'public')
  try {
    if (fs.existsSync(legacyProjects)) found.push({ kind: 'projects', dir: legacyProjects })
  } catch {
    /* ignore */
  }
  try {
    // public/ 里可能只有随代码分发的只读资产；有 generated 或 videos 才算真数据
    if (fs.existsSync(path.join(legacyMedia, 'generated')) || fs.existsSync(path.join(legacyMedia, 'videos'))) {
      found.push({ kind: 'media', dir: legacyMedia })
    }
  } catch {
    /* ignore */
  }
  return found
}
