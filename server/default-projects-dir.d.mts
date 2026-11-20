/** server/default-projects-dir.mjs 的类型声明 */

export function desktopProjectsCandidates(): string[]

/** 未设置 SB_PROJECTS_DIR 时探测桌面端 projects 并写入环境变量 */
export function applyDefaultProjectsDir(): string | null