import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const MIN_WIDTH = 320
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 380

/**
 * 发布台右栏：检查器与助手共用的单一槽位。
 *
 * 为什么不是第四栏：编排区四段表单在 1440 下需要约 780px，
 * 再加一栏就会把平台行与封面网格挤到换行。检查器与助手
 * 本来就是「当前状态」与「编辑当前状态」的两面，共用一个槽位最省宽度。
 *
 * 宽度只记一份，切换检查器/助手时布局不跳。
 */
export default function PublishDock({
  mode,
  open,
  width,
  onWidth,
  resizable = true,
  children,
  label,
}: {
  mode: 'inspect' | 'chat'
  open: boolean
  width: number
  onWidth: (next: number) => void
  /** 检查器在窄屏不提供拖拽（它会变成纵向底部区块） */
  resizable?: boolean
  children: ReactNode
  label: string
}) {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const move = (ev: globalThis.PointerEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX))
      onWidth(next)
    }
    const end = () => {
      setDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
  }, [dragging, onWidth])

  if (!open) return null

  const beginResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onWidth(Math.min(MAX_WIDTH, width + (e.shiftKey ? 40 : 20)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onWidth(Math.max(MIN_WIDTH, width - (e.shiftKey ? 40 : 20)))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onWidth(DEFAULT_WIDTH)
    }
  }

  const style = { '--chat-width': `${Math.round(width)}px` } as CSSProperties

  return (
    <>
      {resizable ? (
        <div
          className="pb-dock-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整右栏宽度"
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onPointerDown={beginResize}
          onDoubleClick={() => onWidth(DEFAULT_WIDTH)}
          onKeyDown={onKeyDown}
        />
      ) : null}
      <aside
        className={`pb-dock ${mode === 'chat' ? 'is-chat' : 'is-inspect'}`}
        style={style}
        data-publish-dock={mode}
        aria-label={label}
      >
        {children}
      </aside>
    </>
  )
}

export { MIN_WIDTH as DOCK_MIN_WIDTH, MAX_WIDTH as DOCK_MAX_WIDTH, DEFAULT_WIDTH as DOCK_DEFAULT_WIDTH }
