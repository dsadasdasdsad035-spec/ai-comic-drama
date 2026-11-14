/**
 * 充值档位。
 *
 * 交互选择：先点档位选中，再点「去支付」——原来点一下就直接拉起支付页，
 * 容易误触扣款。最划算档（每积分单价最低）自动打标，帮用户少算一次。
 */
import { useMemo, useState } from 'react'
import { Check, CreditCard, Gift, Loader2, X } from 'lucide-react'
import type { BillingAccount } from './useBillingAccount'
import { bonusPercent, formatCny, formatCredits, unitPrice } from './format'

export function RechargePanel({ account }: { account: BillingAccount }) {
  const { packs } = account
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 单价最低的档位打「最划算」标；只有两档以上才有比较意义
  const bestId = useMemo(() => {
    if (packs.length < 2) return null
    let best = packs[0]
    for (const p of packs) {
      if (unitPrice(p.price_cny, p.credits_total) < unitPrice(best.price_cny, best.credits_total)) best = p
    }
    return best.id
  }, [packs])

  const selected = packs.find((p) => p.id === selectedId) ?? null
  const paying = Boolean(account.payingPackId)
  const busy = Boolean(account.busy)

  return (
    <section className="acct-panel" aria-label="充值">
      <header className="acct-panel-head">
        <h3>充值</h3>
        <span className="acct-panel-hint">支付完成后余额自动刷新；未到账可点上方「刷新」。</span>
      </header>

      {packs.length === 0 ? (
        <p className="acct-empty">暂无可用档位，请联系管理员配置充值包。</p>
      ) : (
        <>
          <div className="acct-packs" role="radiogroup" aria-label="选择充值档位">
            {packs.map((p) => {
              const bonus = bonusPercent(p.credits_bonus, p.credits_total)
              const active = selectedId === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`acct-pack${active ? ' on' : ''}`}
                  onClick={() => setSelectedId(active ? null : p.id)}
                  disabled={busy}
                >
                  {bestId === p.id && <span className="acct-pack-ribbon">最划算</span>}
                  <span className="acct-pack-title">{p.title}</span>
                  <span className="acct-pack-price">¥{formatCny(p.price_cny)}</span>
                  <span className="acct-pack-credits">
                    {formatCredits(p.credits_total)}
                    <em>积分</em>
                    {active && (
                      <span className="acct-pack-check" aria-hidden>
                        <Check size={11} />
                      </span>
                    )}
                  </span>
                  <span className="acct-pack-meta">
                    {p.credits_bonus && p.credits_bonus > 0 ? (
                      <span className="acct-pack-bonus">
                        <Gift size={11} aria-hidden />
                        {formatCredits(p.credits_bonus)}
                        {bonus > 0 ? ` / +${bonus}%` : ''}
                      </span>
                    ) : (
                      <span className="acct-pack-unit">无赠送</span>
                    )}
                    <span className="acct-pack-unit">¥{unitPrice(p.price_cny, p.credits_total)}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="acct-paybar">
            {selected ? (
              <span className="acct-paybar-summary">
                已选 <b>{formatCredits(selected.credits_total)}</b> 积分 · ¥{formatCny(selected.price_cny)}
              </span>
            ) : (
              <span className="acct-paybar-summary muted">选择一个档位后可发起支付</span>
            )}
            <span className="spacer" />
            {paying ? (
              <button type="button" className="btn" onClick={() => account.cancelPay()}>
                <X size={13} aria-hidden />
                停止等待
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={!selected || busy}
              onClick={() => selected && void account.pay(selected)}
            >
              {paying ? (
                <>
                  <Loader2 size={13} className="acct-spin" aria-hidden />
                  等待支付…
                </>
              ) : (
                <>
                  <CreditCard size={13} aria-hidden />
                  去支付
                </>
              )}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
