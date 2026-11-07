import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProjectShot } from './api'

export type ShotPickerItem = {
  shot: ProjectShot
  status: string
}

type Props = {
  items: ShotPickerItem[]
  shotId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
}

function sortShots(items: ShotPickerItem[]): ShotPickerItem[] {
  return [...items].sort((a, b) => {
    const na = (a.shot.no ?? '').trim()
    const nb = (b.shot.no ?? '').trim()
    if (na && nb) return na.localeCompare(nb, undefined, { numeric: true })
    return a.shot.id.localeCompare(b.shot.id)
  })
}

function shotLabel(s: ProjectShot): string {
  const no = (s.no ?? '').trim() || s.id
  const size = (s.size ?? '').trim()
  const move = (s.move ?? '').trim()
  const bits = [size, move].filter(Boolean)
  return bits.length ? `${no} · ${bits.join('·')}` : no
}

/**
 * 3D 调度视图的镜号选择器。行为对齐全局 EpPicker。
 */
export default function ShotPicker({ items, shotId, onSelect, disabled }: Props) {
  const sorted = sortShots(items)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 })
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const current = shotId ? sorted.find((x) => x.shot.id === shotId) ?? null : null

  const close = useCallback((focusBack = false) => {
    setOpen(false)
    if (focusBack) triggerRef.current?.focus()
  }, [])

  const openList = useCallback(() => {
    if (disabled || sorted.length === 0) return
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width })
    const idx = sorted.findIndex((x) => x.shot.id === shotId)
    setActive(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [disabled, sorted, shotId])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    const onViewport = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('scroll', onViewport, true)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    itemRefs.current[active]?.focus()
  }, [open, active])

  const choose = (id: string) => {
    onSelect(id)
    close(true)
  }

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openList()
    }
  }

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (sorted.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + sorted.length) % sorted.length)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      if (sorted.length === 0) return
      setActive(e.key === 'Home' ? 0 : sorted.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const triggerLabel = current
    ? `镜 ${shotLabel(current.shot)} · ${current.status}`
    : sorted.length === 0
      ? '无镜头'
      : '未选镜'

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`shotbar-trigger ${open ? 'open' : ''} ${current ? '' : 'empty'}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`选择镜头，当前 ${triggerLabel}`}
        disabled={disabled || sorted.length === 0}
        title={current ? `镜 ${current.shot.no || current.shot.id}` : '当前集还没有镜头'}
      >
        {current ? (
          <span className="shotbar-trigger-text">
            <b>镜 {current.shot.no || current.shot.id}</b>
            <span className="shotbar-shot-meta">
              {[current.shot.size, current.shot.move].filter(Boolean).join('·')}
            </span>
            <span className="shotbar-shot-status">{current.status}</span>
          </span>
        ) : (
          <span className="shotbar-trigger-text">{sorted.length === 0 ? '无镜头' : '选镜头'}</span>
        )}
        <span className="shotbar-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="shotbar-panel"
            role="listbox"
            aria-label="镜头列表"
            style={{ left: pos.left, top: pos.top, minWidth: Math.max(240, pos.width) }}
            onKeyDown={onListKey}
          >
            {sorted.map((row, i) => (
              <button
                key={row.shot.id}
                ref={(el) => {
                  itemRefs.current[i] = el
                }}
                type="button"
                role="option"
                aria-selected={row.shot.id === shotId}
                tabIndex={-1}
                className={`shotbar-tab ${row.shot.id === shotId ? 'on' : ''}`}
                data-shot-id={row.shot.id}
                onClick={() => choose(row.shot.id)}
                title={`镜 ${row.shot.no || row.shot.id}`}
              >
                <b>{row.shot.no || row.shot.id}</b>
                <span className="shotbar-title">
                  {[row.shot.size, row.shot.move].filter(Boolean).join(' · ') || '—'}
                </span>
                <span className="shotbar-status">{row.status}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
