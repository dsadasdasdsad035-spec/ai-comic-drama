import { useCallback, useEffect, useRef, useState } from 'react'
import PlatformBadge from './PlatformBadge'
import { cancelLogin, confirmLogin, connectAccount, deleteAccount, pollLogin, setAutoDraft } from './api'
import type { PlatformCapability, PublishAccount } from './types'

function statusLabel(s: PublishAccount['status']): string {
  if (s === 'connected') return '已连接'
  if (s === 'expired') return '登录失效'
  if (s === 'disabled') return '已停用'
  return '状态未知'
}

/** 登录弹窗：轮询登录结果，四态（等待/成功/超时/需人工）都要有出口 */
export function ConnectDialog({
  platform,
  account,
  onClose,
  onDone,
  onToast,
}: {
  platform: PlatformCapability
  account?: PublishAccount
  onClose: () => void
  onDone: () => void
  onToast: (m: string) => void
}) {
  const [state, setState] = useState<'opening' | 'awaiting' | 'done' | 'timeout' | 'error' | 'cancelled'>('opening')
  const [message, setMessage] = useState('正在打开浏览器…')
  const [loginId, setLoginId] = useState('')
  const [accountId, setAccountId] = useState(account?.id || '')
  const [requireConfirm, setRequireConfirm] = useState(false)
  const [detected, setDetected] = useState(false)
  const timer = useRef<number | null>(null)

  const begin = useCallback(async () => {
    setState('opening')
    setMessage('正在打开浏览器…')
    try {
      const r = await connectAccount({
        platform: platform.id,
        accountId: account?.id,
        label: account?.label || platform.label,
      })
      setLoginId(r.login.id)
      setAccountId(r.account.id)
      setRequireConfirm(Boolean(r.login.requireConfirm))
      setDetected(Boolean(r.login.detected))
      setState('awaiting')
      setMessage(
        r.login.requireConfirm
          ? '已复用现有登录目录。在窗口中完成登录后，点下方「我已完成登录」。'
          : '请在弹出的浏览器窗口中完成登录（扫码或账号密码）',
      )
    } catch (e) {
      setState('error')
      setMessage((e as Error).message)
    }
  }, [platform.id, platform.label, account?.id, account?.label])

  useEffect(() => {
    void begin()
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [begin])

  useEffect(() => {
    if (!loginId || state === 'done' || state === 'cancelled') return
    timer.current = window.setInterval(async () => {
      try {
        const r = await pollLogin(loginId)
        setState(r.login.status)
        setMessage(r.login.message || '')
        setRequireConfirm(Boolean(r.login.requireConfirm))
        setDetected(Boolean(r.login.detected))
        if (r.login.status === 'done') {
          if (timer.current) window.clearInterval(timer.current)
          onToast(`${platform.label}已连接`)
          onDone()
        }
      } catch (e) {
        setState('error')
        setMessage((e as Error).message)
        if (timer.current) window.clearInterval(timer.current)
      }
    }, 1500)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [loginId, state, platform.label, onToast, onDone])

  const busy = state === 'opening' || state === 'awaiting'

  /** 关闭时若登录还没结束，先取消，避免浏览器窗口留到超时 */
  const close = useCallback(async () => {
    if (loginId && busy) {
      try {
        await cancelLogin(loginId)
      } catch {
        /* 取消失败也要关闭弹窗 */
      }
    }
    if (timer.current) window.clearInterval(timer.current)
    onClose()
  }, [loginId, busy, onClose])

  /** 重新登录时由用户点这里结束等待；判定仍由服务端按真实会话确认 */
  const confirmDone = useCallback(async () => {
    if (!loginId) return
    setMessage('正在确认登录状态…')
    try {
      const login = await confirmLogin(loginId)
      if (login.status === 'done') {
        if (timer.current) window.clearInterval(timer.current)
        onToast(`${platform.label}已连接`)
        onDone()
      } else {
        setMessage(login.message || '还没检测到登录状态，请先完成扫码')
      }
    } catch (e) {
      setMessage((e as Error).message)
    }
  }, [loginId, platform.label, onToast, onDone])

  return (
    <div className="pb-modal-mask" role="dialog" aria-modal="true" aria-label={`连接${platform.label}`}>
      <div className="pb-modal">
        <div className="pb-modal-head">{account ? `重新登录 ${platform.label}` : `连接 ${platform.label}`}</div>
        <div className="pb-modal-body">
          <div className="pb-login-qr">
            {busy ? '请在弹出的浏览器窗口中完成登录' : state === 'done' ? '登录成功' : '未完成登录'}
          </div>
          <div className={`pb-login-state ${state === 'error' || state === 'timeout' ? 'error' : state === 'done' ? 'done' : ''}`}>
            {message || '等待中…'}
          </div>
          <div className="pb-hint">
            登录态只保存在本机浏览器 profile，不会上传到服务器。遇到验证码或短信验证请在窗口中手动完成。
          </div>
        </div>
        <div className="pb-modal-foot">
          {(state === 'timeout' || state === 'error' || state === 'cancelled') && (
            <button type="button" className="btn" onClick={() => void begin()}>
              重新获取
            </button>
          )}
          {busy && requireConfirm && (
            <button type="button" className="btn primary" onClick={() => void confirmDone()}>
              我已完成登录
            </button>
          )}
          <button type="button" className={`btn ${busy && requireConfirm ? '' : 'primary'}`} onClick={() => void close()}>
            {state === 'done' ? '完成' : busy ? '取消登录' : '关闭'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AccountList({
  accounts,
  platforms,
  onChanged,
  onToast,
}: {
  accounts: PublishAccount[]
  platforms: PlatformCapability[]
  onChanged: (next: PublishAccount[]) => void
  onToast: (m: string) => void
}) {
  const [connecting, setConnecting] = useState<{ platform: PlatformCapability; account?: PublishAccount } | null>(null)

  const platformOf = (id: string) => platforms.find((p) => p.id === id) || null

  return (
    <div className="pb-accounts">
      {platforms.map((p) => {
        const acc = accounts.find((a) => a.platform === p.id)
        return (
          <div className="pb-account" key={p.id}>
            <PlatformBadge platform={p.id} badge={p.badge} />
            <div className="pb-account-main">
              <div className="pb-account-name">
                {p.label}
                {acc ? (
                  <>
                    <span>{acc.label || '默认账号'}</span>
                    <span className={`pb-status ${acc.status}`}>{statusLabel(acc.status)}</span>
                  </>
                ) : (
                  <span className="pb-status unknown">未连接</span>
                )}
              </div>
              <div className="pb-account-meta">
                <span>支持：{p.modes.map((m) => (m === 'draft' ? '草稿' : m === 'publish' ? '直接发布' : '发布包')).join(' / ')}</span>
                <span>封面：{p.coverAspects.join(' / ')}</span>
                <span>
                  标题：
                  {p.limits.titleOptional
                    ? '无独立标题'
                    : p.limits.titleMin
                      ? `${p.limits.titleMin}–${p.limits.titleMax} 字`
                      : `上限 ${p.limits.titleMax} 字`}
                </span>
                {acc?.lastCheckedAt ? <span>检查于 {acc.lastCheckedAt.slice(11, 16)}</span> : null}
                {!p.verified && !p.manualOnly ? (
                  <span className="pb-hint warn">
                    {p.draftKind === 'none' ? '适配器未验证，只能填好表单由人工发布' : '适配器未验证，只能保存草稿'}
                  </span>
                ) : null}
                {p.manualOnly ? <span className="pb-hint warn">表单结构未核实，只能人工发布</span> : null}
              </div>
            </div>
            <div className="pb-account-acts">
              {acc ? (
                <>
                  <label className="pb-check" title="导出成功后自动上传到平台草稿箱（不会自动公开发布）">
                    <input
                      type="checkbox"
                      checked={acc.autoDraft}
                      onChange={async (e) => {
                        try {
                          const next = await setAutoDraft(acc, e.target.checked)
                          onChanged(accounts.map((a) => (a.id === next.id ? next : a)))
                        } catch (err) {
                          onToast((err as Error).message)
                        }
                      }}
                    />
                    自动草稿
                  </label>
                  <button type="button" className="btn-mini" onClick={() => setConnecting({ platform: p, account: acc })}>
                    重新登录
                  </button>
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={async () => {
                      if (!window.confirm(`删除 ${p.label} 账号？本机登录态会一起删除。`)) return
                      try {
                        onChanged(await deleteAccount(acc.id))
                        onToast('账号已删除')
                      } catch (err) {
                        onToast((err as Error).message)
                      }
                    }}
                  >
                    删除
                  </button>
                </>
              ) : (
                <button type="button" className="btn-mini" onClick={() => setConnecting({ platform: p })}>
                  连接
                </button>
              )}
            </div>
          </div>
        )
      })}

      <div className="pb-hint">
        发布由本机浏览器执行，请保持应用与浏览器窗口可用。未连接账号时可改用「导出发布包」手动上传。
      </div>

      {connecting ? (
        <ConnectDialog
          platform={connecting.platform}
          account={connecting.account}
          onClose={() => setConnecting(null)}
          onDone={() => {
            setConnecting(null)
            // 重新拉取由父组件负责；这里只关闭弹窗
          }}
          onToast={onToast}
        />
      ) : null}
    </div>
  )
}
