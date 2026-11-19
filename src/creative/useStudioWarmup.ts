import { useEffect, useRef } from 'react'
import { resolveStudioWarmup, type StudioWarmupInput } from './keepalive'

/** 宿主状态探测的间隔：预热是后台行为，宁可慢一点也不要挤占首屏 */
const PROBE_INTERVAL_MS = 800
/** 最多探测几次：宿主 2 秒延迟预热 + 约 4 秒启动，8 秒内必然 ready */
const PROBE_MAX_ATTEMPTS = 12
/** 连续几次请求异常就认定探测不可靠（接口不存在、鉴权失败等） */
const PROBE_MAX_FAILURES = 3
/** 空闲回调的兜底时限：页面不忙但仍被判定为不空闲时也要落地 */
const IDLE_TIMEOUT_MS = 3000

type NetworkHints = Pick<StudioWarmupInput, 'saveData' | 'effectiveType' | 'deviceMemory'>

/**
 * 读浏览器对链路与设备的自述。
 *
 * 三个字段都不是标准：Safari/Firefox 没有 `connection`，Safari 没有 `deviceMemory`。
 * 拿不到时按「允许预热」处理——不知道不等于链路差，否则会把一大批正常用户排除在外。
 */
export function readNetworkHints(): NetworkHints {
  if (typeof navigator === 'undefined') {
    return { saveData: false, effectiveType: '', deviceMemory: 0 }
  }
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection
  const deviceMemory = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0)
  return {
    saveData: Boolean(connection?.saveData),
    effectiveType: String(connection?.effectiveType ?? ''),
    deviceMemory: Number.isFinite(deviceMemory) ? deviceMemory : 0,
  }
}

/** 宿主是否已经就绪；只读接口，不会催起宿主 */
async function probeHostReady(signal: AbortSignal): Promise<'ready' | 'failed' | 'pending'> {
  const res = await fetch('/studio/_host/status', { credentials: 'include', signal })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return 'failed'
  if (body?.state === 'ready') return 'ready'
  if (body?.state === 'failed') return 'failed'
  return 'pending'
}

export interface StudioWarmupOptions {
  enabled: boolean
  keepAlive: boolean
  preload: boolean
  mounted: boolean
  active: boolean
  /** 此前进入过创意（`sb.studioVisited`） */
  visited: boolean
  /** 指针悬停或聚焦过创意入口 */
  intent: boolean
  /** 裁决为 `mount` 时调用；只调用一次 */
  onMount: () => void
}

/**
 * 创意外壳的后台预热编排。
 *
 * 顺序是硬约束：先判「值不值得预热」（弱网、省流量、低配、首访无意图一律不发请求），
 * 再等宿主就绪，最后等主线程空闲。反过来写就会先打一串探测请求、再决定不预热，
 * 既浪费又会让测试环境里凭空多出 `/studio/` 的流量。
 *
 * 与 `resolveStudioMount` 共用同一组输入（入口、常驻、已挂载、当前视图），
 * 因此两处不会各写一份「什么时候该挂」而漂移。
 */
export function useStudioWarmup({
  enabled,
  keepAlive,
  preload,
  mounted,
  active,
  visited,
  intent,
  onMount,
}: StudioWarmupOptions): void {
  const hostReadyRef = useRef(false)
  const idleRef = useRef(false)
  const firedRef = useRef(false)
  /** 回调放进引用：`onMount` 通常是内联箭头函数，进依赖数组会让编排放电重来 */
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount

  const hints = readNetworkHints()
  const { saveData, effectiveType, deviceMemory } = hints

  /** 把「还没等到的那两项」按最乐观取值，用来判断是否根本不值得预热 */
  const withGateOpen = resolveStudioWarmup({
    enabled,
    keepAlive,
    preload,
    mounted,
    active,
    visited,
    intent,
    saveData,
    effectiveType,
    deviceMemory,
    hostReady: true,
    idle: true,
  })
  // `off` 时连探测都不该发：判定「不预热」的代价必须是零请求
  const worthWaiting = withGateOpen !== 'off'

  useEffect(() => {
    if (!worthWaiting) return
    // 已经挂载过就别再探测：预热目标已达成
    if (mounted || active) return

    const controller = new AbortController()
    let alive = true
    let attempts = 0
    let failures = 0
    let timer = 0

    const tick = () => {
      if (!alive) return
      attempts += 1
      probeHostReady(controller.signal)
        .then((state) => {
          if (!alive) return
          if (state === 'ready') {
            hostReadyRef.current = true
            scheduleIdle()
            return
          }
          if (state === 'failed') {
            // 宿主自己坏了：这一轮放弃，操作员点击时由既有错误页与重试承担
            alive = false
            return
          }
          next()
        })
        .catch(() => {
          if (!alive) return
          failures += 1
          // 接口本身不可用（不存在、鉴权失败）：继续轮询没有意义
          if (failures >= PROBE_MAX_FAILURES) {
            alive = false
            return
          }
          next()
        })
    }

    const next = () => {
      if (!alive) return
      if (attempts >= PROBE_MAX_ATTEMPTS) {
        // 超过十秒仍未就绪：宿主真有问题，交给点击时的错误页
        alive = false
        return
      }
      timer = window.setTimeout(tick, PROBE_INTERVAL_MS)
    }

    let idleHandle = 0
    const scheduleIdle = () => {
      const ric = window.requestIdleCallback
      if (typeof ric === 'function') {
        idleHandle = ric(() => {
          if (!alive) return
          idleRef.current = true
          fireIfMount()
        }, { timeout: IDLE_TIMEOUT_MS })
        return
      }
      // 无 `requestIdleCallback`（Safari）：退化成一次宏任务，至少让出当前帧
      timer = window.setTimeout(() => {
        if (!alive) return
        idleRef.current = true
        fireIfMount()
      }, 1)
    }

    /**
     * 裁决一次。这里重新走 `resolveStudioWarmup` 而不是直接挂：
     * 等宿主与空闲期间，入口可能被关掉、也可能用户已经自己点进创意了。
     */
    const fireIfMount = () => {
      const verdict = resolveStudioWarmup({
        enabled,
        keepAlive,
        preload,
        mounted,
        active,
        visited,
        intent,
        saveData,
        effectiveType,
        deviceMemory,
        hostReady: hostReadyRef.current,
        idle: idleRef.current,
      })
      if (verdict !== 'mount' || firedRef.current) return
      firedRef.current = true
      onMountRef.current()
    }

    tick()

    return () => {
      alive = false
      controller.abort()
      window.clearTimeout(timer)
      if (idleHandle && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
    }
    // 输入变化时重新编排：入口开关、意图、访问记录都可能让「不值得预热」变「值得」
  }, [worthWaiting, mounted, active, enabled, keepAlive, preload, visited, intent, saveData, effectiveType, deviceMemory])
}
