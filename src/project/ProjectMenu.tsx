import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import NewProjectDialog from './NewProjectDialog'
import ProjectManagerDialog from './ProjectManagerDialog'

type RecentProject = { name: string; title?: string; updated_at?: string }

type Props = {
  /** 当前项目名（目录名）；大厅传空串 */
  currentProjectName?: string
  /** 最近项目数据源；缺省就没有「最近」分组 */
  projects?: RecentProject[]
  /** 触发按钮样式：bar = 大厅顶栏，rail = 工作区左栏项目块 */
  variant?: 'bar' | 'rail'
  /** 点最近项目：父级走路由切项目 */
  onOpenProject?: (name: string) => void
  /** 左栏菜单里的「返回项目大厅」；不传就不显示 */
  onReturnHub?: () => void
  /** 新建成功：父级刷新列表并切换项目 */
  onCreated: (name: string) => void | Promise<void>
  /** 删除成功：父级刷新列表并处理上下文回退 */
  onDeleted: (names: string[]) => void | Promise<void>
}

/**
 * 项目生命周期入口：大厅顶栏与工作区左栏共用。
 *
 * 左栏把「最近项目 / 新建 / 管理 / 返回大厅」收进同一个弹层，
 * 弹层沿用 EpPicker 的规则：点击外部 / Esc / 窗口变化都关闭并归还焦点；
 * 打开时焦点落到第一项，保证纯键盘可用。
 */
export default function ProjectMenu({
  currentProjectName = '',
  projects = [],
  variant = 'bar',
  onOpenProject,
  onReturnHub,
  onCreated,
  onDeleted,
}: Props) {
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
    if (r) setPos({ left: Math.max(8, r.left), top: r.bottom + 6 })
    setOpen(true)
  }, [])

  /** 最近项目：按更新时间倒序，最多 5 个，且不含当前项目本身 */
  const recent = useMemo(
    () =>
      [...projects]
        .filter((p) => p.name && p.name !== currentProjectName)
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
        .slice(0, 5),
    [projects, currentProjectName],
  )

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
        className={
          variant === 'rail'
            ? 'btn-mini rail-project-trigger'
            : 'btn-mini topbar-project-menu'
        }
        data-project-menu
        title="项目菜单：最近项目 / 新建 / 管理"
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
        {variant === 'rail' ? (
          <>
            <span className="rail-project-name">{currentProjectName || '未命名项目'}</span>
            <span className="rail-project-caret" aria-hidden>
              ▾
            </span>
          </>
        ) : (
          '项目 ▾'
        )}
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
            {recent.length > 0 ? (
              <>
                <div className="proj-menu-label" aria-hidden>
                  最近项目
                </div>
                {recent.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    role="menuitem"
                    data-project-recent={p.name}
                    onClick={() => {
                      close()
                      onOpenProject?.(p.name)
                    }}
                  >
                    {p.title || p.name}
                  </button>
                ))}
                <div className="proj-menu-sep" role="separator" />
              </>
            ) : null}
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
            {onReturnHub ? (
              <button
                type="button"
                role="menuitem"
                data-project-hub
                onClick={() => {
                  close()
                  onReturnHub()
                }}
              >
                返回项目大厅
              </button>
            ) : null}
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
          currentProjectName={currentProjectName}
          onClose={() => setManaging(false)}
          onDeleted={async (names) => {
            await onDeleted(names)
          }}
        />
      )}
    </>
  )
}
