/**
 * 账号与充值页（全局视图）。
 *
 * 它不再是项目工作区的一部分：账号是跨项目的身份，所以路由是 `#/account`，
 * 与项目大厅同级。未登录时这一页就是登录页（独立的整屏登录/注册卡片），
 * 登录后依次是身份条、余额、充值、流水，管理员配置折叠在最后。
 *
 * 为什么不套 AppShell：未登录时左栏所有项目菜单都不可用，留着外壳等于给出
 * 一堆点不动的入口。整屏也顺带让「登录」这件事有一个明确的落点。
 */
import { useEffect } from 'react'
import { AlertTriangle, ChevronLeft, Loader2 } from 'lucide-react'
import { AdminPanel } from './AdminPanel'
import { AuthPanel } from './AuthPanel'
import { LedgerPanel } from './LedgerPanel'
import { RechargePanel } from './RechargePanel'
import { WalletPanel } from './WalletPanel'
import type { BillingAccount } from './useBillingAccount'
import { useBillingAccount } from './useBillingAccount'
import type { Session } from './useSession'

type Props = {
  toast: (message: string) => void
  /** 登录成功后要去的 hash；由路由的 `#/account?next=` 传入，已校验 */
  next?: string
  session: Session
  /** 登录成功回调：把新身份同步给全局闸门，并按 next 回跳 */
  onLoggedIn: (target?: string) => void
  /** 回项目大厅。账号页不套 AppShell，没有面包屑，必须自带出口 */
  onBackToHub: () => void
}

export default function AccountPage({ toast, next, session, onLoggedIn, onBackToHub }: Props) {
  const account = useBillingAccount({ toast })

  /**
   * 账号页自己也会读到会话（useBillingAccount），把它同步给全局闸门。
   *
   * 为什么必须同步：登录发生在这一页，但闸门在 App 层读 `session`。
   * 不同步的话登录成功、界面刷新，闸门仍认为未登录，用户会被弹回登录页。
   */
  useEffect(() => {
    if (account.loading) return
    session.setUser(account.user)
    // 只在会话身份变化时同步；session 对象每次渲染都是新引用，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.loading, account.user])

  const loggedIn = Boolean(account.user)

  // 登录成功后按 next 回跳；没有 next 回项目大厅
  useEffect(() => {
    if (loggedIn && next) onLoggedIn(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  return (
    <main className="settings settings-shell acct-page" data-view="account" data-acct-logged-in={loggedIn ? 'true' : 'false'}>
      <div className="st-main" data-settings-pane="account">
        <header className="st-topbar">
          {/*
           * 返回大厅的出口。账号页是独立整屏（不套 AppShell），没有面包屑，
           * 所以必须自带；否则用户从大厅点「登录」进来、改主意了也出不去，
           * 已登录用户看完余额同样只能改地址栏。
           */}
          <button
            type="button"
            className="btn-ghost acct-back"
            data-acct-back
            onClick={onBackToHub}
            title="返回项目大厅"
          >
            <ChevronLeft size={14} aria-hidden />
            项目大厅
          </button>
          <div>
            <h2>账号与充值</h2>
            <span className="st-hint">积分仅用于平台代调用模型；本地自有 Key 不扣积分。</span>
          </div>
        </header>

        {account.loading && !account.user ? (
          <div className="acct-loading">
            <Loader2 size={16} className="acct-spin" aria-hidden />
            正在读取账号信息…
          </div>
        ) : (
          <div className="acct-scroll">
            {/* 读取失败对未登录同样成立：接口挂了不能让人以为是没登录 */}
            {account.loadError && <LoadErrorBanner account={account} />}
            {!account.user ? (
              <AuthPanel account={account} />
            ) : (
              <>
                <WalletPanel account={account} />
                <RechargePanel account={account} />
                <LedgerPanel account={account} />
                <AdminPanel account={account} />
              </>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function LoadErrorBanner({ account }: { account: BillingAccount }) {
  return (
    <div className="acct-banner" role="alert">
      <AlertTriangle size={14} aria-hidden />
      <span>账号数据读取失败：{account.loadError}</span>
      <button
        type="button"
        className="btn"
        disabled={Boolean(account.busy)}
        onClick={() => void account.refresh()}
      >
        重试
      </button>
    </div>
  )
}
