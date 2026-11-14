/**
 * 管理员区：计费开关、验证邮件 SMTP、渠道对账。
 *
 * 这些是低频配置，默认折叠，避免把普通用户的充值页撑成一张大表单。
 * 折叠用原生 <details>：无状态、可访问、刷新后不残留错误展开态。
 */
import { useState } from 'react'
import { Loader2, MailCheck, RefreshCw, Scale, Settings2 } from 'lucide-react'
import type { BillingAccount } from './useBillingAccount'

export function AdminPanel({ account }: { account: BillingAccount }) {
  const settings = account.adminSettings
  if (!account.user?.is_admin || !settings) return null

  const busy = Boolean(account.busy)
  const str = (key: string) => String(settings[key] ?? '')
  const num = (key: string, fallback: number) => {
    const v = Number(settings[key])
    return Number.isFinite(v) && v !== 0 ? v : fallback
  }

  return (
    <section className="acct-panel acct-admin" aria-label="管理员设置">
      <header className="acct-panel-head">
        <h3>
          <Settings2 size={14} aria-hidden />
          管理员
        </h3>
        <span className="acct-panel-hint">仅管理员可见；改动即时保存。</span>
      </header>

      <details className="acct-fold">
        <summary>计费开关与赠送</summary>
        <div className="acct-fold-body">
          <label className="acct-switch">
            <input
              type="checkbox"
              checked={Boolean(settings.billing_enabled)}
              disabled={busy}
              onChange={(e) => void account.patchAdmin({ billing_enabled: e.target.checked })}
            />
            <span>
              启用平台计费
              <em>关闭后不再按积分扣费，仅保留本地估算</em>
            </span>
          </label>

          <div className="acct-form-grid">
            <label className="acct-field">
              <span>注册赠送积分</span>
              <input
                type="number"
                min={0}
                value={num('signup_bonus_credits', 0)}
                disabled={busy}
                onChange={(e) => void account.patchAdmin({ signup_bonus_credits: Number(e.target.value) || 0 })}
              />
              <em>新账号注册后自动到账</em>
            </label>
            <label className="acct-field">
              <span>调用加成 %</span>
              <input
                type="number"
                min={0}
                step={1}
                value={num('usage_markup_percent', 0)}
                disabled={busy}
                onChange={(e) => void account.patchAdmin({ usage_markup_percent: Number(e.target.value) || 0 })}
              />
              <em>在渠道原价之上叠加的比例</em>
            </label>
          </div>
        </div>
      </details>

      <details className="acct-fold">
        <summary>验证邮件（SMTP）</summary>
        <div className="acct-fold-body">
          <p className="acct-note">
            选 <code>console</code> 时验证链接只打印在服务端日志，桌面端看不到；
            要给真实用户发信请选 <code>smtp</code> 并填完下面各项。
          </p>

          <div className="acct-form-grid">
            <label className="acct-field">
              <span>邮件驱动</span>
              <select
                value={str('email_driver') || 'console'}
                disabled={busy}
                onChange={(e) => void account.patchAdmin({ email_driver: e.target.value })}
              >
                <option value="console">console（仅日志，调试用）</option>
                <option value="smtp">smtp（真实发送）</option>
              </select>
            </label>
            <label className="acct-field">
              <span>SMTP 服务器</span>
              <input
                placeholder="smtp.example.com"
                defaultValue={str('smtp_host')}
                disabled={busy}
                onBlur={(e) => {
                  if (e.target.value === str('smtp_host')) return
                  void account.patchAdmin({ smtp_host: e.target.value }).then(() => account.refreshEmailStatus())
                }}
              />
            </label>
            <label className="acct-field">
              <span>端口</span>
              <input
                type="number"
                placeholder="465"
                defaultValue={num('smtp_port', 465)}
                disabled={busy}
                onBlur={(e) => {
                  const port = Number(e.target.value) || 465
                  // 端口决定默认加密方式：465 用隐式 TLS，587 走 STARTTLS
                  void account.patchAdmin({ smtp_port: port, smtp_secure: port === 465 })
                }}
              />
            </label>
            <label className="acct-field">
              <span>SMTP 用户名</span>
              <input
                placeholder="no-reply@example.com"
                defaultValue={str('smtp_user')}
                disabled={busy}
                onBlur={(e) => {
                  if (e.target.value === str('smtp_user')) return
                  void account.patchAdmin({ smtp_user: e.target.value }).then(() => account.refreshEmailStatus())
                }}
              />
            </label>
            <SmtpPasswordField account={account} saved={Boolean(settings.smtp_pass_set)} />
            <label className="acct-field">
              <span>发信人</span>
              <input
                placeholder="短剧创作台 <no-reply@example.com>"
                defaultValue={str('email_from')}
                disabled={busy}
                onBlur={(e) => {
                  if (e.target.value === str('email_from')) return
                  void account.patchAdmin({ email_from: e.target.value })
                }}
              />
              <em>留空则用 SMTP 用户名</em>
            </label>
          </div>

          <label className="acct-switch">
            <input
              type="checkbox"
              checked={
                typeof settings.smtp_secure === 'boolean'
                  ? settings.smtp_secure
                  : (account.emailStatus?.secure ?? num('smtp_port', 465) === 465)
              }
              disabled={busy}
              onChange={(e) => void account.patchAdmin({ smtp_secure: e.target.checked })}
            />
            <span>
              使用 SSL/TLS
              <em>465 端口勾选，587 端口不勾</em>
            </span>
          </label>

          {account.emailStatus && (
            <dl className="acct-kv">
              <div>
                <dt>当前驱动</dt>
                <dd>{account.emailStatus.driver}</dd>
              </div>
              <div>
                <dt>服务器</dt>
                <dd>
                  {account.emailStatus.host || '未配置'}:{account.emailStatus.port}
                </dd>
              </div>
              <div>
                <dt>用户</dt>
                <dd>{account.emailStatus.user || '未配置'}</dd>
              </div>
              <div>
                <dt>密码</dt>
                <dd className={account.emailStatus.pass_set ? 'ok' : 'warn'}>
                  {account.emailStatus.pass_set ? '已设置' : '未设置'}
                </dd>
              </div>
            </dl>
          )}

          <div className="acct-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void account.sendTest()}>
              {account.busy === 'test-mail' ? (
                <Loader2 size={13} className="acct-spin" aria-hidden />
              ) : (
                <MailCheck size={13} aria-hidden />
              )}
              发送测试邮件给我
            </button>
          </div>
        </div>
      </details>

      <details className="acct-fold">
        <summary>渠道对账</summary>
        <div className="acct-fold-body">
          <p className="acct-note">
            价目同步时间：{String(settings.price_catalog_synced_at || '（内置样例）')}
          </p>
          <div className="acct-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void account.refreshReconcile()}>
              {account.busy === 'reconcile' ? (
                <Loader2 size={13} className="acct-spin" aria-hidden />
              ) : (
                <RefreshCw size={13} aria-hidden />
              )}
              刷新对账
            </button>
          </div>
          {account.reconcile && (
            <>
              <p className={`acct-note ${account.reconcile.ok ? 'ok' : 'warn'}`}>
                <Scale size={12} aria-hidden />
                {account.reconcile.ok
                  ? '账本自洽'
                  : `发现异常：${String(
                      (account.reconcile.issues as string[] | undefined)?.join('；') || '未知',
                    )}`}
              </p>
              <pre className="acct-pre">{JSON.stringify(account.reconcile, null, 2)}</pre>
            </>
          )}
        </div>
      </details>
    </section>
  )
}

/**
 * SMTP 密码：服务端从不回传明文，所以用「已设置 + 留空不改」的语义，
 * 只在失焦且有输入时才提交，提交后清空输入框。
 */
function SmtpPasswordField({ account, saved }: { account: BillingAccount; saved: boolean }) {
  const [draft, setDraft] = useState('')

  return (
    <label className="acct-field">
      <span>
        SMTP 密码
        {saved && <em className="acct-inline-em">已设置，留空则不修改</em>}
      </span>
      <input
        type="password"
        placeholder={saved ? '••••••••' : '授权码或密码'}
        value={draft}
        disabled={Boolean(account.busy)}
        autoComplete="new-password"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft.trim()
          if (!v) return
          void account.patchAdmin({ smtp_pass: v }).then((ok) => {
            if (!ok) return
            setDraft('')
            void account.refreshEmailStatus()
          })
        }}
      />
    </label>
  )
}
