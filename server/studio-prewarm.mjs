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
 * - 至多两次机会：正常情况一次就够；若第一次到点时宿主正被别处拉起
 *   （`starting`），记一次**延后**而不是就此作废——用户进入创意失败后回到
 *   入口，这一次补触发就是「不用再等一轮冷启动」的唯一机会。
 *
 * 为什么延后不算作废：到点那一刻宿主 `starting`，说明用户刚点进创意、
 * 启动已在路上。此前的实现把它当作「已用掉」，于是用户退出后入口再点回来
 * 仍要冷启动；而补触发在宿主回到 `idle` 时才动手，不会和进行中的启动打架。
 */

/** 默认延迟：让应用首屏先落地，避免宿主与前端产物跟主 bundle 抢带宽 */
export const DEFAULT_PREWARM_DELAY_MS = 2_000

/** 延后补触发的延迟：一次启动通常在这个量级内尘埃落定 */
export const DEFAULT_RETRY_DELAY_MS = 1_000

/**
 * @param {object} options
 * @param {() => boolean} options.isEnabled 创意入口是否启用
 * @param {() => { state: string }} options.status 宿主状态读取（取 `state`）
 * @param {() => Promise<boolean>} options.prepare 与请求路径共用的拉起函数
 * @param {number} [options.delayMs] 延迟毫秒数
 * @param {number} [options.retryDelayMs] 延后补触发的延迟
 * @param {(line: string) => void} [options.log] 日志输出
 */
export function createStudioPrewarm({
  isEnabled,
  status,
  prepare,
  delayMs = DEFAULT_PREWARM_DELAY_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  log = () => {},
}) {
  let timer = null
  /**
   * 三态：
   * - `pending`：还没到点（可能已有定时器）
   * - `deferred`：到点时宿主正被别处拉起，等一次补触发
   * - `spent`：机会用完，不再安排
   */
  let phase = 'pending'

  /** 取消所有未触发的定时器（进程退出时调用，避免定时器拖住退出） */
  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  /** 安排一次预热。重复调用无副作用，便于在配置变更后重新触发 */
  function schedule() {
    if (phase !== 'pending' || timer) return
    timer = setTimeout(() => {
      timer = null
      void warmUp()
    }, delayMs)
    // 定时器不该成为进程活着的理由
    timer.unref?.()
  }

  /** 宿主已热或已坏：两种都不该再由预热插手 */
  function isSettled(state) {
    return state === 'ready' || state === 'failed' || state === 'stopped'
  }

  /** 一次补触发：宿主回到 idle 才动手，其余状态一律放手 */
  function deferOnce() {
    phase = 'deferred'
    timer = setTimeout(async () => {
      timer = null
      // 补触发也只用一次机会，无论结果如何都结束
      const state = status()?.state
      if (state !== 'idle') {
        phase = 'spent'
        return
      }
      phase = 'spent'
      await warmUp()
    }, retryDelayMs)
    timer.unref?.()
  }

  /**
   * 立即执行一次预热（定时器到点与测试都走这里）。
   * @returns {Promise<boolean>} 是否真的发起了拉起
   */
  async function warmUp() {
    try {
      if (!isEnabled()) {
        // 入口关闭不是「临时占用」：保持与旧实现一致的一次性语义
        phase = 'spent'
        return false
      }
      const state = status()?.state
      if (state === 'starting') {
        // 启动已在路上：记一次延后，等它尘埃落定再看要不要补
        deferOnce()
        return false
      }
      if (isSettled(state)) {
        phase = 'spent'
        return false
      }
      if (state !== 'idle') {
        // 未知状态按「不插手」处理，避免把调度错误变成反复拉起
        phase = 'spent'
        return false
      }
      phase = 'spent'
      const ok = await prepare()
      if (ok) log('[studio] 宿主预热完成')
      else log('[studio] 宿主预热未就绪，进入创意时会再次尝试拉起')
      return true
    } catch (e) {
      // 不重试：宿主坏掉时反复拉起只会打满 CPU，而用户看不到原因
      phase = 'spent'
      log(`[studio] 宿主预热失败：${e?.message || String(e)}`)
      return false
    }
  }

  return {
    schedule,
    cancel,
    warmUp,
    /** 观察当前阶段（测试与排障用，不参与调度） */
    phase: () => phase,
  }
}
