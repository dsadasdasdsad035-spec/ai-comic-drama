/**
 * 已登录时的账号身份条 + 钱包。
 *
 * 余额是这一页唯一的视觉主角：等宽大数字 + 一条可用/冻结的比例条，
 * 其余信息（邮箱、验证状态、退出）降到次要层级。
 */
import { Loader2, LogOut, MailWarning, RefreshCw, ShieldCheck, Snowflake } from 'lucide-react'
import type { BillingAccount } from './useBillingAccount'
import { formatCredits, initialOf } from './format'

export function WalletPanel({ account }: { account: BillingAccount }) {
  const { user, wallet } = account
  if (!user) return null

  const available = wallet?.available_credits ?? 0
  const balance = wallet?.credits ?? 0
  // 冻结 = 已预扣但任务未结算的部分
  const hold = Math.max(0, balance - available)
  const ratio = balance > 0 ? Math.min(1, Math.max(0, available / balance)) : 1

  return (
    <section className="acct-panel acct-wallet" aria-label="账号信息与余额">
      <header className="acct-identity">
        <span className="acct-avatar" aria-hidden>
          {initialOf(user.email)}
        </span>
        <div className="acct-identity-main">
          <div className="acct-identity-mail" title={user.email}>
            {user.email}
          </div>
          <div className="acct-identity-meta">
            {user.email_verified ? (
              <span className="acct-badge ok">
                <ShieldCheck size={12} aria-hidden />
                邮箱已验证
              </span>
            ) : (
              <span className="acct-badge warn">
                <MailWarning size={12} aria-hidden />
                邮箱未验证
              </span>
            )}
            {user.is_admin && <span className="acct-badge">管理员</span>}
          </div>
        </div>
        <div className="acct-identity-actions">
          {!user.email_verified && (
            <button
              type="button"
              className="btn"
              disabled={Boolean(account.busy)}
              onClick={() => void account.resendVerify()}
            >
              {account.busy === 'verify' ? '发送中…' : '重发验证邮件'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={Boolean(account.busy)}
            onClick={() => void account.logout()}
          >
            <LogOut size={13} aria-hidden />
            退出
          </button>
        </div>
      </header>

      <div className="acct-balance">
        <div className="acct-balance-main">
          <span className="acct-balance-label">可用积分</span>
          <strong className="acct-balance-num" data-testid="acct-balance">
            {formatCredits(available)}
          </strong>
          <span className="acct-balance-sub">
            账户余额 {formatCredits(balance)}
            {hold > 0 && (
              <>
                <span className="acct-dot" aria-hidden />
                <span className="acct-hold">
                  <Snowflake size={11} aria-hidden />
                  冻结 {formatCredits(hold)}
                </span>
              </>
            )}
          </span>
        </div>
        <div className="acct-balance-side">
          <button
            type="button"
            className="btn"
            disabled={Boolean(account.busy)}
            onClick={() => void account.refresh()}
            title="重新拉取余额与流水"
          >
            {account.busy === 'refresh' ? (
              <Loader2 size={13} className="acct-spin" aria-hidden />
            ) : (
              <RefreshCw size={13} aria-hidden />
            )}
            刷新
          </button>
        </div>
      </div>

      {/* 可用 / 余额的比例条：一眼看出有多少被冻结 */}
      <div
        className="acct-meter"
        role="img"
        aria-label={`可用占余额 ${Math.round(ratio * 100)}%`}
      >
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </section>
  )
}
