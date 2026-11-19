/**
 * 创意视图容器：把 `/studio/` 作为同源 iframe 嵌入，其余一概不管。
 *
 * 为什么是 iframe 而不是把宿主前端重新实现一遍：创意会话的会话列表、消息流、
 * 工具卡片、审批与设置页都由 dsh 自己维护，复刻即等于把运行时成本又搬回项目里。
 *
 * 三件事由这一层负责，且只有这三件：
 * 1. **主题桥**：同源 iframe 可直接改它的根节点，把应用语义 token 映射成
 *    宿主使用的 `--dsw-*` 变量并同步明暗标记，首帧就对齐，不出现闪错主题。
 * 2. **不可用错误态**：宿主还没起来/启动失败时给中文说明与「重试」，
 *    不把白屏或堆栈丢给用户。
 * 3. **导航位置**：容器尺寸变化不影响外壳导航（宽度固定为可用区）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme'

export type StudioFrameProps = {
  /** 失败后重试：宿主进程由服务端重新拉起 */
  onRetry?: () => void
}

type HostState = 'loading' | 'ready' | 'error'

/**
 * 应用语义 token → 宿主 `--dsw-*` 变量。
 *
 * 只映射「表面/描边/文字/主色」这几类：宿主自己的组件语义我们还不知道，
 * 但底色与文字必须一致，否则两套主题切换时外壳和内容会各说各话。
 */
const LIGHT_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#f4f1ea',
  '--dsw-alias-bg-layer-1': '#fffdf8',
  '--dsw-alias-bg-layer-2': '#f8f4ec',
  '--dsw-alias-bg-layer-3': '#ece7dd',
  '--dsw-alias-bg-layer-4': '#e6e0d5',
  '--dsw-alias-border-l1': '#ded5c7',
  '--dsw-alias-border-l2': '#cec3b2',
  '--dsw-alias-brand-primary': '#0e7490',
}

const DARK_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#070b11',
  '--dsw-alias-bg-layer-1': '#0e1620',
  '--dsw-alias-bg-layer-2': '#111c28',
  '--dsw-alias-bg-layer-3': '#0c131c',
  '--dsw-alias-bg-layer-4': '#16222f',
  '--dsw-alias-border-l1': '#1d2b3a',
  '--dsw-alias-border-l2': '#2a3d52',
  '--dsw-alias-brand-primary': '#38bdf8',
}

/** 把主题写到宿主文档上：变量 + 明暗标记 + color-scheme 一次到位 */
export function applyStudioTheme(doc: Document, mode: 'day' | 'night') {
  const root = doc.documentElement
  const tokens = mode === 'day' ? LIGHT_TOKENS : DARK_TOKENS
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value)
  root.style.colorScheme = mode === 'day' ? 'light' : 'dark'
  // 宿主用 body 上的这个标记切暗色（见它的主题样式）
  if (mode === 'night') doc.body?.setAttribute('data-ds-dark-theme', '')
  else doc.body?.removeAttribute('data-ds-dark-theme')
}

export default function StudioFrame({ onRetry }: StudioFrameProps) {
  const { theme: mode } = useTheme()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [state, setState] = useState<HostState>('loading')
  const [message, setMessage] = useState('')
  const [nonce, setNonce] = useState(0)

  /** 首帧与后续主题变化都走这里：iframe 同源，直接改它的文档 */
  const syncTheme = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    try {
      applyStudioTheme(doc, mode)
    } catch {
      // 跨源时无从下手：那就交给宿主自己的主题，至少内容可读
    }
  }, [mode])

  useEffect(() => {
    syncTheme()
  }, [syncTheme])

  /** 宿主状态：错误态要给原因，而不是无限转圈 */
  useEffect(() => {
    let alive = true
    const probe = async () => {
      try {
        const res = await fetch('/studio/_host/status', { credentials: 'include' })
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) {
          setState('error')
          setMessage(body?.message || '创意会话宿主未通过认证或不可用')
          return
        }
        if (body.state === 'failed') {
          setState('error')
          setMessage(body.error || '创意会话宿主启动失败')
          return
        }
        // ready 时由 iframe 的 onLoad 收尾，避免状态先绿后白
      } catch (e) {
        if (!alive) return
        setState('error')
        setMessage(`连不上创意会话宿主：${(e as Error)?.message || String(e)}`)
      }
    }
    void probe()
    return () => {
      alive = false
    }
  }, [nonce])

  const retry = useCallback(async () => {
    setState('loading')
    setMessage('')
    try {
      const res = await fetch('/studio/_host/restart', { method: 'POST', credentials: 'include' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body.ok === false) {
        setState('error')
        setMessage(body?.message || '重试失败：宿主未能启动')
        return
      }
      onRetry?.()
      setNonce((n) => n + 1)
    } catch (e) {
      setState('error')
      setMessage(`重试失败：${(e as Error)?.message || String(e)}`)
    }
  }, [onRetry])

  return (
    <div className="studio-frame" data-state={state}>
      {state === 'error' ? (
        <div className="studio-frame-error" role="alert">
          <h2>创意会话暂时不可用</h2>
          <p>{message}</p>
          <button type="button" className="btn" onClick={() => void retry()}>
            重试
          </button>
        </div>
      ) : null}
      {state === 'loading' ? <div className="studio-frame-loading">正在连接创意会话…</div> : null}
      <iframe
        // key 变化才会真正重挂：重试时要求宿主重新拉起并给新地址
        key={nonce}
        ref={frameRef}
        title="创意会话"
        src="/studio/"
        className="studio-frame-iframe"
        onLoad={() => {
          syncTheme()
          setState((prev) => (prev === 'error' ? prev : 'ready'))
        }}
        onError={() => {
          setState('error')
          setMessage('创意会话页面加载失败')
        }}
      />
    </div>
  )
}
