import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const MIN_WIDTH = 340
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 400

const widthKey = (surface: string) => `workbench-chat:${surface}:width`

function readWidth(surface: string): number {
  try {
    const saved = Number(localStorage.getItem(widthKey(surface)))
    if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) return saved
  } catch {
    /* localStorage 不可用 */
  }
  return DEFAULT_WIDTH
}

const DATA_ATTRS: Record<string, Record<string, string>> = {
  script: { 'data-script-chat': '' },
  characters: { 'data-characters-chat': '' },
  assets: { 'data-assets-chat': '' },
  shots: { 'data-shots-chat': '' },
  prompts: { 'data-prompts-chat': '' },
  // 发布台：断点由 publishChat.css 的 [data-publish-chat] 作用域覆盖为 1200px
  publish: { 'data-publish-chat': '' },
}

/**
 * 工作台聊天停靠栏：宽屏可拖拽，窄屏变成带遮罩的覆盖式抽屉。
 * 宽度按 surface 记忆，拖拽条支持方向键和双击复位。
 */
export function WorkbenchChatAside({
  surface,
  open,
  onClose,
  children,
}: {
  /** 工作台 surface；发布台用 'publish'，断点由 publishChat.css 覆盖为 1200px */
  surface: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  const [width, setWidth] = useState(() => readWidth(surface))

  useEffect(() => {
    try {
      localStorage.setItem(widthKey(surface), String(Math.round(width)))
    } catch {
      /* 忽略存储失败 */
    }
  }, [surface, width])

  if (!open) return null

  const beginResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const move = (ev: globalThis.PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX))
      setWidth(next)
    }
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setWidth((w) => Math.min(MAX_WIDTH, w + (e.shiftKey ? 40 : 20)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setWidth((w) => Math.max(MIN_WIDTH, w - (e.shiftKey ? 40 : 20)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setWidth(DEFAULT_WIDTH)
    }
  }

  const style = { '--chat-width': `${Math.round(width)}px` } as CSSProperties

  return (
    <>
      <div
        className="workbench-chat-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整聊天面板宽度"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        aria-controls={`workbench-chat-${surface}`}
        tabIndex={0}
        onPointerDown={beginResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        onKeyDown={onKeyDown}
      />
      <div className="workbench-chat-scrim" aria-hidden="true" onClick={onClose} />
      <aside
        id={`workbench-chat-${surface}`}
        className="workbench-chat-aside"
        style={style}
        {...DATA_ATTRS[surface]}
      >
        {children}
      </aside>
    </>
  )
}
