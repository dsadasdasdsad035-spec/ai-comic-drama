/**
 * 账号与充值页。
 *
 * 从「设置 → 费用 → 账户与充值」提升为顶层视图。布局遵循「余额优先」：
 * 未登录只给一张登录卡；登录后依次是身份条、余额、充值、流水，
 * 管理员配置折叠在最后，不打扰日常使用。
 */
import { AlertTriangle, Loader2 } from 'lucide-react'
import { AdminPanel } from './AdminPanel'
import { AuthPanel } from './AuthPanel'
import { LedgerPanel } from './LedgerPanel'
import { RechargePanel } from './RechargePanel'
import { WalletPanel } from './WalletPanel'
import type { BillingAccount } from './useBillingAccount'
import { useBillingAccount } from './useBillingAccount'

type Props = {
  toast: (message: string) => void
}

export default function AccountPage({ toast }: Props) {
  const account = useBillingAccount({ toast })

  return (
    <main className="settings settings-shell" data-view="account">
      <div className="st-main" data-settings-pane="account">
        <header className="st-topbar">
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
