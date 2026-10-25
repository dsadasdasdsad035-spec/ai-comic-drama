import { useEffect, useRef, useState } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { cn } from '@/chat-ui/lib/utils'
import type { CreativeArtifact, CreativeSessionSummary } from './sessionStore'
import { CreativeCards, type GeneratedItem } from './CreativeMessageParts'

const STORE_KEY = 'creative:artifacts:open'
/** 与 theme.css 的覆盖式抽屉断点保持一致 */
const OVERLAY_QUERY = '(max-width: 1280px)'

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== '0'
  } catch {
    return true
  }
}

function isOverlayWidth(): boolean {
  try {
    return window.matchMedia(OVERLAY_QUERY).matches
  } catch {
    return false
  }
}

/**
 * 产物栏：源视频 / 镜头切分 / 提示词包 / 生成结果。
 * 放在对话右侧而不是上方横带，对话的可视高度才不会被产物挤压。
 * 根节点带 chat-ui class：里面的 Card/Badge 依赖该作用域的 token。
 * 折叠时整栏不渲染，只在右缘留一个展开按钮，对话列因此占满剩余宽度；
 * ≤1280px 时该栏是覆盖式抽屉，默认收起（否则会常驻盖住对话右侧），Esc 可关闭。
 */
export function CreativeArtifacts({
  session,
  generated,
  busy,
  busyAction,
  onSplit,
  onFrames,
  onCopy,
  onExport,
  onPromote,
}: {
  session: CreativeSessionSummary | null
  generated: GeneratedItem[]
  busy: boolean
  busyAction: string
  onSplit: (sourceId: string) => void
  onFrames: (sourceId: string) => void
  onCopy: (text: string) => void
  onExport: (artifact: CreativeArtifact) => void
  onPromote: (artifact: CreativeArtifact) => void
}) {
  // 覆盖形态下永远先收起：那是抽屉，不是常驻栏
  const [open, setOpen] = useState(() => readOpen() && !isOverlayWidth())
  const reopenRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    try {
      // 只记宽屏的偏好；覆盖形态的开关不写回，避免下次宽屏还停在收起
      if (!isOverlayWidth()) localStorage.setItem(STORE_KEY, open ? '1' : '0')
    } catch {
      /* localStorage 不可用 */
    }
  }, [open])

  // 跨到覆盖形态时自动收起，跨回宽屏时恢复用户偏好
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia(OVERLAY_QUERY)
    } catch {
      return
    }
    const onChange = (e: MediaQueryListEvent) => setOpen(e.matches ? false : readOpen())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 覆盖抽屉形态下才吃 Esc：宽屏常驻栏按 Esc 关闭会很意外
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isOverlayWidth()) return
      e.preventDefault()
      setOpen(false)
      requestAnimationFrame(() => reopenRef.current?.focus())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const source = session?.sources[0] ?? null
  const artifacts = session?.artifacts ?? []
  const hasContent = Boolean(source) || artifacts.length > 0 || generated.length > 0
  if (!hasContent) return null

  if (!open) {
    return (
      <button
        type="button"
        ref={reopenRef}
        data-creative-action="toggle-artifacts"
        className="creative-artifacts-reopen"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        title="展开产物"
      >
        <PanelRightOpen className="size-3.5" />
        <span>产物</span>
      </button>
    )
  }

  return (
    <aside
      data-creative-artifacts
      data-open="true"
      className={cn('creative-artifacts chat-ui')}
      aria-label="会话产物"
    >
      <div className="creative-artifacts-head">
        <span>产物</span>
        <button
          type="button"
          data-creative-action="toggle-artifacts"
          className="creative-artifacts-toggle"
          onClick={() => setOpen(false)}
          aria-expanded={true}
          aria-controls="creative-artifacts-body"
          title="折叠产物"
        >
          折叠
        </button>
      </div>
      <div id="creative-artifacts-body" className="creative-artifacts-body">
        <CreativeCards
          session={session}
          generated={generated}
          busy={busy}
          busyAction={busyAction}
          onSplit={onSplit}
          onFrames={onFrames}
          onCopy={onCopy}
          onExport={onExport}
          onPromote={onPromote}
        />
      </div>
    </aside>
  )
}
