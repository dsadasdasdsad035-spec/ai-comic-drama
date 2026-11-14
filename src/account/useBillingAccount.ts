/**
 * 账号与充值状态。
 *
 * 为什么从设置工作台里抽出来：账户是独立的顶层导航（与画布、设置同级），
 * 不该依赖 SettingsWorkbench —— 否则打开账户页会连带初始化全部设置数据。
 *
 * 这里同时收拢所有副作用（登录、注册、支付轮询、管理员写入），
 * 组件只负责呈现，避免把 120 秒轮询和错误处理散落在 JSX 里。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchAuthMe,
  fetchBillingSettingsAdmin,
  fetchEmailStatus,
  fetchLedger,
  fetchRechargePacks,
  fetchReconciliationReport,
  loginBilling,
  logoutBilling,
  patchBillingSettingsAdmin,
  registerBilling,
  resendVerifyBilling,
  sendTestEmail,
  startRecharge,
  fetchRechargeOrderStatus,
  type BillingUser,
  type BillingWallet,
  type EmailStatus,
  type RechargePack,
} from '../billingApi'

/** 一条流水（服务端已把 micro 换算成 credits） */
export type LedgerRow = {
  id?: number
  type?: string
  amount_credits?: number
  balance_after_credits?: number
  created_at?: string
}

/** 管理员计费配置：字段随服务端扩展，保留宽松索引签名 */
export type AdminSettings = Record<string, unknown>

export type ReconcileReport = Record<string, unknown>

/** 当前进行中的唯一动作；用于按按钮显示「处理中」且全局互斥 */
export type AccountAction =
  | 'login'
  | 'register'
  | 'logout'
  | 'refresh'
  | 'verify'
  | 'recharge'
  | 'admin'
  | 'test-mail'
  | 'reconcile'
  | null

export type BillingAccount = ReturnType<typeof useBillingAccount>

export function useBillingAccount({ toast }: { toast: (message: string) => void }) {
  const [user, setUser] = useState<BillingUser | null>(null)
  const [wallet, setWallet] = useState<BillingWallet | null>(null)
  const [packs, setPacks] = useState<RechargePack[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [adminSettings, setAdminSettings] = useState<AdminSettings | null>(null)
  const [reconcile, setReconcile] = useState<ReconcileReport | null>(null)
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null)
  const [busy, setBusy] = useState<AccountAction>(null)
  const [payingPackId, setPayingPackId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** 静默刷新失败时保留原因：否则档位/流水会静默变空，用户无从判断 */
  const [loadError, setLoadError] = useState<string | null>(null)

  /** 轮询代次：取消支付或离开页面时自增，让旧循环自然退出 */
  const pollGen = useRef(0)
  // toast 多为内联箭头函数，每次渲染都变；用 ref 固定避免所有回调反复重建
  const toastRef = useRef(toast)
  toastRef.current = toast
  // 供回调读取当前动作，避免把 busy 写进依赖导致回调抖动
  const busyRef = useRef<AccountAction>(null)
  busyRef.current = busy

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setBusy('refresh')
    try {
      const me = await fetchAuthMe()
      setUser(me.user)
      setWallet(me.wallet || null)
      if (!me.user) {
        // 登出后清空上一账号的残留：否则档位、流水、管理员面板会留在未登录界面
        setPacks([])
        setLedger([])
        setAdminSettings(null)
        setReconcile(null)
        setEmailStatus(null)
        setLoadError(null)
        return
      }
      const [nextPacks, nextLedger] = await Promise.all([fetchRechargePacks(), fetchLedger(20)])
      setPacks(nextPacks)
      setLedger(nextLedger.entries as LedgerRow[])
      setLoadError(null)
      if (me.user.is_admin) {
        const [adm, rec, mail] = await Promise.all([
          fetchBillingSettingsAdmin(),
          fetchReconciliationReport().catch(() => null),
          fetchEmailStatus().catch(() => null),
        ])
        setAdminSettings(adm.settings)
        setReconcile((rec?.report as ReconcileReport) ?? null)
        setEmailStatus(mail)
      }
    } catch (e) {
      const message = (e as Error).message
      // 静默刷新也要留下痕迹，UI 才能提示「读取失败，可重试」
      setLoadError(message)
      if (!opts?.silent) toastRef.current(message)
    } finally {
      if (!opts?.silent) setBusy(null)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh({ silent: true })
  }, [refresh])

  // 卸载时让支付轮询失效，避免后台继续请求并弹 toast
  useEffect(() => {
    return () => {
      pollGen.current += 1
    }
  }, [])

  /** 登录成功返回 true，便于调用方清空密码框 */
  const login = useCallback(
    async (email: string, password: string) => {
      if (busyRef.current) return false
      setBusy('login')
      try {
        await loginBilling(email.trim(), password)
        await refresh({ silent: true })
        toastRef.current('登录成功')
        return true
      } catch (e) {
        toastRef.current((e as Error).message)
        return false
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const register = useCallback(async (email: string, password: string) => {
    if (busyRef.current) return false
    setBusy('register')
    try {
      const r = await registerBilling(email.trim(), password)
      toastRef.current(r.message || '注册成功，请查收验证邮件')
      return true
    } catch (e) {
      toastRef.current((e as Error).message)
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const logout = useCallback(async () => {
    if (busyRef.current) return
    setBusy('logout')
    try {
      await logoutBilling()
      await refresh({ silent: true })
      toastRef.current('已退出登录')
    } catch (e) {
      toastRef.current((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [refresh])

  const resendVerify = useCallback(async () => {
    if (!user || busyRef.current) return
    setBusy('verify')
    try {
      const r = await resendVerifyBilling(user.email)
      toastRef.current(r.message || '已请求重发验证邮件')
    } catch (e) {
      toastRef.current((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [user])

  const sendTest = useCallback(async () => {
    if (!user || busyRef.current) return
    setBusy('test-mail')
    try {
      const r = await sendTestEmail(user.email)
      toastRef.current(r.message || '测试邮件已发送')
    } catch (e) {
      toastRef.current((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [user])

  /**
   * 发起充值：打开支付页并轮询到账。
   * 轮询最长 120 秒，用户可取消（cancelPay）或离开页面立即失效。
   */
  const pay = useCallback(
    async (pack: RechargePack) => {
      if (busyRef.current) return
      setBusy('recharge')
      setPayingPackId(pack.id)
      const pollId = ++pollGen.current
      try {
        const order = await startRecharge(pack.id)
        const url = order.url_qrcode || order.url
        if (url) window.open(url, '_blank', 'noopener')
        toastRef.current('已打开支付页，到账后自动更新余额')
        const tradeId = order.trade_order_id
        const deadline = Date.now() + 120_000
        while (Date.now() < deadline) {
          if (pollGen.current !== pollId) return
          await new Promise((r) => setTimeout(r, 3000))
          if (pollGen.current !== pollId) return
          try {
            const st = await fetchRechargeOrderStatus(tradeId)
            if (st.status === 'paid') {
              await refresh({ silent: true })
              toastRef.current('充值已到账')
              return
            }
            if (st.status === 'failed' || st.status === 'closed') {
              toastRef.current('订单已关闭或失败，请重新发起充值')
              return
            }
          } catch {
            /* 轮询忽略瞬时网络错误，等下一次 */
          }
        }
        toastRef.current('仍未检测到入账，请确认支付完成或联系管理员查看虎皮椒回调')
      } catch (e) {
        toastRef.current((e as Error).message)
      } finally {
        // 只有还是自己这一轮才收尾，避免覆盖下一轮的状态
        if (pollGen.current === pollId) {
          setBusy(null)
          setPayingPackId(null)
        }
      }
    },
    [refresh],
  )

  const cancelPay = useCallback(() => {
    pollGen.current += 1
    setPayingPackId(null)
    setBusy(null)
    toastRef.current('已停止等待，若已完成支付可点刷新余额')
  }, [])

  /** 管理员字段写入：统一处理错误，避免 onChange 抛未捕获 Promise */
  const patchAdmin = useCallback(async (patch: AdminSettings) => {
    if (busyRef.current) return
    setBusy('admin')
    try {
      const next = await patchBillingSettingsAdmin(patch)
      setAdminSettings(next.settings)
      return true
    } catch (e) {
      toastRef.current((e as Error).message)
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const refreshEmailStatus = useCallback(async () => {
    const next = await fetchEmailStatus().catch(() => null)
    setEmailStatus(next)
  }, [])

  const refreshReconcile = useCallback(async () => {
    if (busyRef.current) return
    setBusy('reconcile')
    try {
      const rec = await fetchReconciliationReport()
      setReconcile(rec.report as ReconcileReport)
      toastRef.current(rec.report.ok ? '账本自洽' : `对账异常：${rec.report.issues.join('；')}`)
    } catch (e) {
      toastRef.current((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [])

  return {
    user,
    wallet,
    packs,
    ledger,
    adminSettings,
    reconcile,
    emailStatus,
    busy,
    payingPackId,
    loading,
    loadError,
    refresh,
    login,
    register,
    logout,
    resendVerify,
    sendTest,
    pay,
    cancelPay,
    patchAdmin,
    refreshEmailStatus,
    refreshReconcile,
  }
}
