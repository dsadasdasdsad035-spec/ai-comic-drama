/**
 * 转发与预热共用的「拉起宿主」入口。
 *
 * 为什么单独成模块：这段编排原来写在 `setupStudio` 的闭包里，只能靠起一个真
 * 宿主来验证，而它恰好是创意入口每次请求都会经过的路径——短路写错的表现是
 * 「点了创意要等好几秒」，靠肉眼极难定位。抽成可注入依赖的工厂后，
 * 用假宿主就能断言「已就绪时一次准备都不做」。
 *
 * 两条顺序约束：
 *
 * 1. **先读状态再准备**。已就绪时 `start()` 本来就会立刻返回，此时再做
 *    `syncProfile` / `syncExperts` 对本次请求毫无作用，只是每请求 20ms 级的同步阻塞。
 *    派生配置的更新由设置变更事件负责，不依赖请求顺带完成。
 * 2. **准备后重读状态**。`syncExperts` 自身可能在内容变化时重启宿主，
 *    失败判定必须看准备之后的状态，否则会把一次失败的启动当作可继续的启动。
 */
export function createStudioStarter({ host, prepareProfile, prepareExperts, log = () => {} }) {
  return async function startHostForRequest() {
    if (!host) return false
    const before = host.status().state
    // 已就绪：本次请求无事可做，直接交给反代转发
    if (before === 'ready') return true

    try {
      prepareProfile?.()
    } catch (e) {
      log(`[studio] 同步模型配置失败：${e?.message || String(e)}`)
    }
    try {
      await prepareExperts?.({ restartIfRunning: false })
    } catch (e) {
      log(`[studio] 同步专家配置失败：${e?.message || String(e)}`)
    }

    // 准备期间可能被重启（成功）或变成失败态：一律以最新状态为准
    const after = host.status().state
    if (after === 'failed') return false
    return await host.start()
  }
}
