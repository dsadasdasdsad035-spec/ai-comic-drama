import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import NewProjectDialog from './NewProjectDialog'
import ProjectManagerDialog from './ProjectManagerDialog'

type Props = {
  /** 新建成功：父级刷新列表并切换项目 */
  onCreated: (name: string) => void | Promise<void>
  /** 删除成功：父级刷新列表并处理上下文回退 */
  onDeleted: (names: string[]) => void | Promise<void>
}

/**
 * 全局带的项目生命周期入口。放在项目选择器旁边，不进入任何视图的上下文带，
 * 因此不受 WorkbenchBar 的窄密度折叠影响。
 * 弹层沿用 EpPicker 的规则：点击外部 / Esc / 窗口变化都关闭并归还焦点。
 */
export default function ProjectMenu({ onCreated, onDeleted }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [creating, setCreating] = useState(false)
  const [managing, setManaging] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback((focusBack = false) => {
    setOpen(false)
    if (focusBack) triggerRef.current?.focus()
  }, [])

  const openPanel = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6 })
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onViewport = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  useLayoutEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        className="btn-mini topbar-project-menu"
        data-project-menu
        title="新建或管理项目"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(true) : openPanel())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPanel()
          }
        }}
      >
        项目 ▾
      </button>

      {open &&
        createPortal(
          <div
            className="proj-menu-panel"
            data-project-menu-panel
            role="menu"
            aria-label="项目操作"
            ref={panelRef}
            style={{ left: pos.left, top: pos.top }}
          >
            <button
              type="button"
              role="menuitem"
              data-project-new
              onClick={() => {
                close()
                setCreating(true)
              }}
            >
              新建项目
            </button>
            <button
              type="button"
              role="menuitem"
              data-project-manage
              onClick={() => {
                close()
                setManaging(true)
              }}
            >
              管理项目…
            </button>
          </div>,
          document.body,
        )}

      <NewProjectDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (name) => {
          setCreating(false)
          await onCreated(name)
        }}
      />

      {managing && (
        <ProjectManagerDialog
          variant="dialog"
          onClose={() => setManaging(false)}
          onDeleted={async (names) => {
            await onDeleted(names)
          }}
        />
      )}
    </>
  )
}
