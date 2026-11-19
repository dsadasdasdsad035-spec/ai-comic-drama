/**
 * 运行时基线校验。
 *
 * 创意会话宿主（dsh）要求 Node >= 24.9.0，低于该版本时宿主无法启动，
 * 但应用其它视图仍然可用 —— 如果不在这里拦住，用户会先看到完整界面，
 * 点开创意才撞上一个无法解释的空白页。所以在进程启动最早期直接拒绝启动，
 * 一次说清楚「当前版本 / 需要版本 / 怎么装」。
 */

/** 宿主声明的最低 Node 版本；升级宿主时必须同步这里 */
export const MIN_NODE_VERSION = '24.9.0'

/**
 * 把 `v24.9.0` / `24.9.0-rc.1` / `24.9` 之类的写法解析成数字三元组。
 * 解析不出来返回 null —— 宁可跳过校验，也不要因为版本串奇怪就拒绝启动。
 */
export function parseNodeVersion(raw) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(raw ?? '').trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

/** current >= minimum 时返回 true；任一版本无法解析时返回 true（跳过校验） */
export function nodeVersionAtLeast(current, minimum = MIN_NODE_VERSION) {
  const a = parseNodeVersion(current)
  const b = parseNodeVersion(minimum)
  if (!a || !b) return true
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return true
}

/**
 * 校验当前运行时；不达标时打印可读错误并返回 false。
 * 调用方决定怎么退出（服务端进程 exit(1)，测试里只断言返回值）。
 */
export function assertNodeVersion({ current = process.versions.node, minimum = MIN_NODE_VERSION, log = console.error } = {}) {
  if (nodeVersionAtLeast(current, minimum)) return true
  log(`[runtime] Node 版本过低：当前 v${current}，需要 v${minimum} 或更高。`)
  log('[runtime] 创意会话的宿主运行时要求 Node 24.9 以上；请升级 Node 后重新启动。')
  log('[runtime] 若使用 nvm：nvm install 24 && nvm use 24')
  return false
}
