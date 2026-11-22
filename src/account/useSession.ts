/**
 * 全局登录态（App 级，单例）。
 *
 * 为什么不复用 useBillingAccount：那个 hook 一挂载就并行拉充值档位、流水，
 * 管理员还会多拉三项配置。闸门只需要知道「有没有会话」，把这一串请求绑到
 * 每次进应用上是浪费，也会让未登录用户白打一堆 401。
 *
 * 三态刻意区分 loading / anonymous / authenticated：
 * - loading 期间**不许**跳转，否则已登录用户每次刷新都会闪一下登录页；
 * - 探测失败也留在 loading（见 status 注释），宁可不拦，也不要把
 *   「后端挂了」渲染成「请登录」。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAuthMe, type BillingUser } from '../billingApi'

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated'

export type Session = {
  user: BillingUser | null
  status: SessionStatus
  /** 计费开关；未知时按 false 处理（等于不拦，与服务端 skipBilling 一致） */
  billingEnabled: boolean
  /** 探测失败原因；有值时界面应给出可重试提示 */
  error: string | null
  refresh: () => Promise<void>
  /** 登录/登出后同步全局态，避免闸门还拿着旧值 */
  setUser: (user: BillingUser | null) => void
}

export function useSession(): Session {
  const [user, setUserState] = useState<BillingUser | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 卸载后不再 setState：探测可能晚于页面切换返回 */
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAuthMe()
      if (!aliveRef.current) return
      setUserState(me.user ?? null)
      setBillingEnabled(Boolean(me.billingEnabled))
      setStatus(me.user ? 'authenticated' : 'anonymous')
      setError(null)
    } catch (e) {
      if (!aliveRef.current) return
      // 保持 loading：区分「确定未登录」与「读不到」。后者若被当成未登录，
      // 后端一挂用户就会被踢到登录页，看起来像账号失效。
      setError((e as Error)?.message || String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setUser = useCallback((next: BillingUser | null) => {
    setUserState(next)
    setStatus(next ? 'authenticated' : 'anonymous')
  }, [])

  return { user, status, billingEnabled, error, refresh, setUser }
}
