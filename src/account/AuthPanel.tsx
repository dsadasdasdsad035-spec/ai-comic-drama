/**
 * 未登录时的登录 / 注册面板。
 *
 * 为什么改成二选一的分段控件：原来并排两个按钮，用户会两边都点。
 * 现在先选模式再提交，注册模式额外校验确认密码，减少输错密码的账户被创建。
 */
import { useState } from 'react'
import { Loader2, LogIn, UserPlus } from 'lucide-react'
import brandMark from '../assets/brand/icon-mark.png'
import type { BillingAccount } from './useBillingAccount'

type Mode = 'login' | 'register'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 6

export function AuthPanel({ account }: { account: BillingAccount }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  const busy = account.busy === 'login' || account.busy === 'register'

  const switchMode = (next: Mode) => {
    if (busy || next === mode) return
    setMode(next)
    setError('')
    setConfirm('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    // 本地先校验，省掉一次必然失败的请求
    if (!EMAIL_RE.test(email.trim())) {
      setError('请填写有效的邮箱地址')
      return
    }
    if (mode === 'register' && password.length < MIN_PASSWORD) {
      setError(`密码至少 ${MIN_PASSWORD} 位`)
      return
    }
    if (!password) {
      setError('请填写密码')
      return
    }
    if (mode === 'register' && confirm !== password) {
      setError('两次输入的密码不一致')
      return
    }
    setError('')
    const ok =
      mode === 'login'
        ? await account.login(email, password)
        : await account.register(email, password)
    if (ok) {
      setPassword('')
      setConfirm('')
      if (mode === 'register') setMode('login')
    }
  }

  return (
    <div className="acct-auth">
      <div className="acct-auth-card">
        <div className="acct-auth-head">
          <img className="acct-auth-mark" src={brandMark} alt="" aria-hidden />
          <h2>{mode === 'login' ? '登录账号' : '创建账号'}</h2>
          <p>积分用于平台代调用模型；本地自有 Key 不消耗积分。</p>
        </div>

        <div className="acct-seg" role="group" aria-label="登录或注册">
          <button
            type="button"
            aria-pressed={mode === 'login'}
            className={mode === 'login' ? 'on' : ''}
            onClick={() => switchMode('login')}
            disabled={busy}
          >
            登录
          </button>
          <button
            type="button"
            aria-pressed={mode === 'register'}
            className={mode === 'register' ? 'on' : ''}
            onClick={() => switchMode('register')}
            disabled={busy}
          >
            注册
          </button>
        </div>

        <form className="acct-form" onSubmit={submit} noValidate>
          <label className="acct-field">
            <span>邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (error) setError('')
              }}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={busy}
            />
          </label>

          <label className="acct-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (error) setError('')
              }}
              placeholder={mode === 'register' ? `至少 ${MIN_PASSWORD} 位` : '输入密码'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              disabled={busy}
            />
          </label>

          {mode === 'register' && (
            <label className="acct-field">
              <span>确认密码</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  if (error) setError('')
                }}
                placeholder="再输入一次"
                autoComplete="new-password"
                disabled={busy}
              />
            </label>
          )}

          {error && (
            <p className="acct-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn primary acct-submit" disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={14} className="acct-spin" aria-hidden />
                {mode === 'login' ? '登录中…' : '提交中…'}
              </>
            ) : (
              <>
                {mode === 'login' ? <LogIn size={14} aria-hidden /> : <UserPlus size={14} aria-hidden />}
                {mode === 'login' ? '登录' : '注册并发送验证邮件'}
              </>
            )}
          </button>
        </form>

        <p className="acct-auth-foot">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')} disabled={busy}>
            {mode === 'login' ? '去注册' : '去登录'}
          </button>
        </p>
      </div>
    </div>
  )
}
