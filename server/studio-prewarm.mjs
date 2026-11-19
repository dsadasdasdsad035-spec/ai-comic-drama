/**
 * 创意会话宿主的空闲预热。
 *
 * 单独成模块的理由：预热是「等待 + 一次性触发 + 失败不重试」的小状态机，
 * 混在 `setupStudio` 的闭包里既难断言也难回滚。这里只做调度，
 * 真正的拉起动作由调用方注入（与反代的 `ensureStarted` 是同一个函数），
 * 因此预热永远不会走一条和「用户首次进入」不同的路径。
 *
 * 三条硬约束：
 * - 只在入口启用时预热：入口关闭却拉起宿主，等于给回滚开关留了个洞；
 * - 只在宿主 `idle` 时预热：`failed` / `stopped` 是显式状态，
 *   由创意入口的错误页「重试」负责，预热不该绕过它反复拉起坏掉的宿主；
 * - 只触发一次：失败只记日志，不安排第二次。
 */

/** 默认延迟：让应用首屏先落地，避免宿主与前端产物跟主 bundle 抢带宽 */
export const DEFAULT_PREWARM_DELAY_MS = 2_000

/**
 * @param {object} options
 * @param {() => boolean} options.isEnabled 创意入口是否启用
 * @param {() => { state: string }} options.status 宿主状态读取（取 `state`）
 * @param {() => Promise<boolean>} options.prepare 与请求路径共用的拉起函数
 * @param {number} [options.delayMs] 延迟毫秒数
 * @param {(line: string) => void} [options.log] 日志输出
 */
export function createStudioPrewarm({
  isEnabled,
  status,
  prepare,
  delayMs = DEFAULT_PREWARM_DELAY_MS,
  log = () => {},
}) {
  let timer = null
  /** 已经跑过一次就不再安排：预热不是守护进程，失败由错误页接管 */
  let fired = false

  /** 取消未触发的预热（进程退出时调用，避免定时器拖住退出） */
  function cancel() {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  /** 安排一次预热。重复调用无副作用，便于在配置变更后重新触发 */
  function schedule() {
    if (fired || timer) return
    timer = setTimeout(() => {
      timer = null
      fired = true
      void warmUp()
    }, delayMs)
    // 定时器不该成为进程活着的理由
    timer.unref?.()
  }

  /**
   * 立即执行一次预热（定时器到点与测试都走这里）。
   * @returns {Promise<boolean>} 是否真的发起了拉起
   */
  async function warmUp() {
    try {
      if (!isEnabled()) return false
      const state = status()?.state
      if (state !== 'idle') {
        // starting 说明别处已在拉起，ready 说明已经热了：都无需动作
        return false
      }
      const ok = await prepare()
      if (ok) log('[studio] 宿主预热完成')
      else log('[studio] 宿主预热未就绪，进入创意时会再次尝试拉起')
      return true
    } catch (e) {
      // 不重试：宿主坏掉时反复拉起只会打满 CPU，而用户看不到原因
      log(`[studio] 宿主预热失败：${e?.message || String(e)}`)
      return false
    }
  }

  return { schedule, cancel, warmUp }
}
