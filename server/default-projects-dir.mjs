/**
 * 开发/独立服务未配置 SB_PROJECTS_DIR 时，回退到桌面端 userData 里的 projects/
 *（与 electron data-roots 一致），避免画布能看图、出片却报「参考图不存在」。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function desktopProjectsCandidates() {
  const out = []
  if (process.platform === 'darwin') {
    out.push(path.join(os.homedir(), 'Library', 'Application Support', 'storyboard-canvas', 'projects'))
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    out.push(path.join(appData, 'storyboard-canvas', 'projects'))
  }
  out.push(path.join(os.homedir(), '.config', 'storyboard-canvas', 'projects'))
  return out
}

/** 若未设置 SB_PROJECTS_DIR，探测桌面数据目录并写入环境变量；返回选用路径或 null */
export function applyDefaultProjectsDir() {
  if (String(process.env.SB_PROJECTS_DIR || '').trim()) {
    return process.env.SB_PROJECTS_DIR
  }
  for (const dir of desktopProjectsCandidates()) {
    try {
      if (fs.existsSync(path.join(dir, 'storyboard.sqlite'))) {
        process.env.SB_PROJECTS_DIR = dir
        return dir
      }
    } catch {
      /* 忽略不可读目录 */
    }
  }
  return null
}