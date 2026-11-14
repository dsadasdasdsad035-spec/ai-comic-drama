import type { SettingsWorkbench } from '../../useSettingsWorkbench'
import { loginBilling, logoutBilling, registerBilling, startRecharge, fetchRechargeOrderStatus, patchBillingSettingsAdmin, fetchReconciliationReport } from '../../../billingApi'

type Props = { wb: SettingsWorkbench }

export function BillingPane({ wb }: Props) {
  return (
<section className="st-sec" data-settings-pane="billing">
      <header className="st-sec-head">
        <h3>计费</h3>
        <span className="st-hint">平台积分（Credits）；仅 APIMart 平台 Key 代调用时扣费。上方「计价」仍是创作估算。</span>
      </header>
      {!wb.billUser ? (
        <div className="st-grid">
          <label className="st-field">
            <span>邮箱</span>
            <input value={wb.billAuthEmail} onChange={(e) => wb.setBillAuthEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="st-field">
            <span>密码</span>
            <input
              type="password"
              value={wb.billAuthPassword}
              onChange={(e) => wb.setBillAuthPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <div className="st-actions">
            <button
              type="button"
              className="btn primary"
              disabled={wb.billBusy}
              onClick={async () => {
                wb.setBillBusy(true)
                try {
                  await loginBilling(wb.billAuthEmail, wb.billAuthPassword)
                  wb.toast('登录成功')
                  await wb.refreshBilling()
                } catch (e) {
                  wb.toast((e as Error).message)
                } finally {
                  wb.setBillBusy(false)
                }
              }}
            >
              登录
            </button>
            <button
              type="button"
              className="btn"
              disabled={wb.billBusy}
              onClick={async () => {
                wb.setBillBusy(true)
                try {
                  const r = await registerBilling(wb.billAuthEmail, wb.billAuthPassword)
                  wb.toast(r.message || '请查收验证邮件')
                } catch (e) {
                  wb.toast((e as Error).message)
                } finally {
                  wb.setBillBusy(false)
                }
              }}
            >
              注册
            </button>
          </div>
        </div>
      ) : (
        <>
          <p>
            {wb.billUser.email}
            {wb.billUser.email_verified ? '' : '（未验证邮箱，部分功能不可用）'} · 可用积分{' '}
            <strong>{wb.billWallet?.available_credits ?? 0}</strong>
            <button type="button" className="btn" onClick={() => void logoutBilling().then(() => wb.refreshBilling())}>
              退出
            </button>
          </p>
          <h4>充值</h4>
          <p className="st-hint">
            支付完成后余额会自动刷新；若未及时到账请点「刷新余额」，并确认服务端已配置公网{' '}
            <code>XUNHUPAY_NOTIFY_URL</code>。
          </p>
          <button type="button" className="btn" disabled={wb.billBusy} onClick={() => void wb.refreshBilling()}>
            刷新余额
          </button>
          <div className="st-grid">
              {wb.billPacks.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn"
                  disabled={wb.billBusy}
                  onClick={async () => {
                    wb.setBillBusy(true)
                    const pollId = ++wb.billRechargePollGen.current
                    try {
                      const pay = await startRecharge(p.id)
                      const url = pay.url_qrcode || pay.url
                      if (url) window.open(url, '_blank', 'noopener')
                      wb.toast('已打开支付页，到账后自动更新余额')
                      const tradeId = pay.trade_order_id
                      const deadline = Date.now() + 120_000
                      while (Date.now() < deadline) {
                        if (wb.billRechargePollGen.current !== pollId) return
                        await new Promise((r) => setTimeout(r, 3000))
                        if (wb.billRechargePollGen.current !== pollId) return
                        try {
                          const st = await fetchRechargeOrderStatus(tradeId)
                          if (st.status === 'paid') {
                            await wb.refreshBilling()
                            wb.toast('充值已到账')
                            return
                          }
                          if (st.status === 'failed' || st.status === 'closed') {
                            wb.toast('订单已关闭或失败，请重新发起充值')
                            return
                          }
                        } catch {
                          /* 轮询忽略瞬时网络错误 */
                        }
                      }
                      wb.toast('仍未检测到入账，请确认支付完成或联系管理员查看虎皮椒回调')
                    } catch (e) {
                      wb.toast((e as Error).message)
                    } finally {
                      wb.setBillBusy(false)
                    }
                  }}
                >
                  {p.title} · ¥{p.price_cny} → {p.credits_total} Credits
                </button>
              ))}
          </div>
          <h4>近期流水</h4>
          <ul className="st-hint">
            {wb.billLedger.map((raw, i) => {
              const row = raw as { id?: number; type?: string; amount_credits?: number; created_at?: string }
              return (
                <li key={row.id ?? i}>
                  {row.created_at} {row.type} {row.amount_credits}
                </li>
              )
            })}
          </ul>
          {wb.billUser.is_admin && wb.billAdminSettings && (
            <>
              <h4>管理员</h4>
              <label className="st-field">
                <span>启用平台计费</span>
                <input
                  type="checkbox"
                  checked={Boolean(wb.billAdminSettings.billing_enabled)}
                  onChange={async (e) => {
                    const next = await patchBillingSettingsAdmin({ billing_enabled: e.target.checked })
                    wb.setBillAdminSettings(next.settings)
                    wb.toast('已更新')
                  }}
                />
              </label>
              <label className="st-field">
                <span>注册赠送 Credits</span>
                <input
                  type="number"
                  value={Number(wb.billAdminSettings.signup_bonus_credits) || 0}
                  onChange={async (e) => {
                    const v = Number(e.target.value) || 0
                    const next = await patchBillingSettingsAdmin({ signup_bonus_credits: v })
                    wb.setBillAdminSettings(next.settings)
                  }}
                />
              </label>
              <label className="st-field">
                <span>调用加成 %</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={Number(wb.billAdminSettings.usage_markup_percent) || 0}
                  onChange={async (e) => {
                    const v = Number(e.target.value) || 0
                    const next = await patchBillingSettingsAdmin({ usage_markup_percent: v })
                    wb.setBillAdminSettings(next.settings)
                  }}
                />
              </label>
              <p className="st-hint">
                价目同步时间：{String(wb.billAdminSettings.price_catalog_synced_at || '（内置样例）')}
              </p>
              <h4>渠道对账</h4>
              <button
                type="button"
                className="btn"
                disabled={wb.billBusy}
                onClick={async () => {
                  wb.setBillBusy(true)
                  try {
                    const rec = await fetchReconciliationReport()
                    wb.setBillReconcile(rec.report as Record<string, unknown>)
                    wb.toast(rec.report.ok ? '账本自洽' : `对账异常：${rec.report.issues.join('；')}`)
                  } catch (e) {
                    wb.toast((e as Error).message)
                  } finally {
                    wb.setBillBusy(false)
                  }
                }}
              >
                刷新对账
              </button>
              {wb.billReconcile && (
                <pre className="st-hint" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                  {JSON.stringify(wb.billReconcile, null, 2)}
                </pre>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
