/** 近期流水：表格而不是裸列表，让时间/类型/积分/余额四列对齐好扫 */
import type { BillingAccount } from './useBillingAccount'
import { formatCredits, formatTime, ledgerTypeMeta } from './format'

export function LedgerPanel({ account }: { account: BillingAccount }) {
  const rows = account.ledger

  return (
    <section className="acct-panel" aria-label="近期流水">
      <header className="acct-panel-head">
        <h3>近期流水</h3>
        <span className="acct-panel-hint">最近 {rows.length || 20} 条</span>
      </header>

      {rows.length === 0 ? (
        <p className="acct-empty">还没有积分变动记录。</p>
      ) : (
        <div className="acct-table-wrap">
          <table className="acct-table">
            <thead>
              <tr>
                <th scope="col">时间</th>
                <th scope="col">类型</th>
                <th scope="col" className="num">
                  变动
                </th>
                <th scope="col" className="num">
                  变动后
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const meta = ledgerTypeMeta(row.type)
                const amount = row.amount_credits ?? 0
                return (
                  <tr key={row.id ?? i}>
                    <td className="acct-time">{formatTime(row.created_at)}</td>
                    <td>
                      <span className={`acct-ledger-type ${meta.tone}`}>{meta.label}</span>
                    </td>
                    <td className={`num acct-amount ${meta.tone}`}>
                      {amount > 0 ? '+' : amount < 0 ? '−' : ''}
                      {formatCredits(Math.abs(amount))}
                    </td>
                    <td className="num acct-after">
                      {typeof row.balance_after_credits === 'number'
                        ? formatCredits(row.balance_after_credits)
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
