import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getProject, type ProjectShot } from './api'

type Ep = { no: number; title?: string; hook?: string }

type Props = {
  projectName: string
  epNo: number
  setEpNo: (n: number) => void
  /** 工作台保存后由 App 递增，用来刷新镜数 */
  version: number
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 集选择器。集号是「镜头表 / 提示词 / 剧本」等视图共用的数据维度，
 * 所以放在全局带上；横条形态已取消，改成下拉列表，避免再占一行高度。
 */
export default function EpPicker({ projectName, epNo, setEpNo, version }: Props) {
  const [eps, setEps] = useState<Ep[]>([])
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 })
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const load = useCallback(async () => {
    if (!projectName) {
      setEps([])
      setCounts({})
      return
    }
    try {
      const p = await getProject(projectName)
      const declared = (p.episodes ?? []) as Ep[]
      const shots = (p.shots ?? []) as ProjectShot[]
      const c: Record<number, number> = {}
      for (const s of shots) {
        const n = Number(s.episode) || 1
        c[n] = (c[n] ?? 0) + 1
      }
      // episodes 表和 shots 里出现过的集号取并集，避免「有镜头但没写 episodes」的集消失
      const nos = [...new Set([...declared.map((e) => Number(e.no)), ...Object.keys(c).map(Number)])]
        .filter((n) => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b)
      setEps(nos.map((n) => ({ no: n, ...(declared.find((e) => Number(e.no) === n) ?? {}) })))
      setCounts(c)
    } catch {
      setEps([])
      setCounts({})
    }
  }, [projectName])

  useEffect(() => {
    load()
  }, [load, version])

  const current = eps.find((e) => e.no === epNo) ?? null

  const close = useCallback((focusBack = false) => {
    setOpen(false)
    if (focusBack) triggerRef.current?.focus()
  }, [])

  const openList = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width })
    const idx = eps.findIndex((e) => e.no === epNo)
    setActive(idx >= 0 ? idx : 0)
    setOpen(true)
  }, [eps, epNo])

  // 弹层在 portal 里用 fixed 定位，窗口变化就关掉，避免贴在错位置
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

  const choose = (no: number) => {
    setEpNo(no)
    close(true)
  }

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
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
      if (eps.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + eps.length) % eps.length)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      if (eps.length === 0) return
      setActive(e.key === 'Home' ? 0 : eps.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const label = current
    ? `E${pad(current.no)}${current.title ? ` ${current.title}` : ''} · ${counts[current.no] ?? 0} 镜`
    : '未选集'

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`epbar-trigger ${open ? 'open' : ''} ${current ? '' : 'empty'}`}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`选择集，当前 ${label}`}
        title={current ? current.hook || current.title || `第 ${current.no} 集` : '当前项目还没有集'}
      >
        {current ? (
          <span className="epbar-trigger-text">
            <b>E{pad(current.no)}</b>
            {current.title && <span className="epbar-ep-title">{current.title}</span>}
            <span className="epbar-ep-count">· {counts[current.no] ?? 0} 镜</span>
          </span>
        ) : (
          <span className="epbar-trigger-text">未选集</span>
        )}
        <span className="epbar-caret" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="epbar-panel"
            role="listbox"
            aria-label="集列表"
            style={{ left: pos.left, top: pos.top, minWidth: Math.max(200, pos.width) }}
            onKeyDown={onListKey}
          >
            {eps.length === 0 ? (
              <div className="epbar-empty">
                {projectName ? '这个项目还没有集。先去剧本页生成分集，或在镜头表里建镜头。' : '先在全局带选择项目。'}
              </div>
            ) : (
              eps.map((e, i) => (
                <button
                  key={e.no}
                  ref={(el) => {
                    itemRefs.current[i] = el
                  }}
                  type="button"
                  role="option"
                  aria-selected={e.no === epNo}
                  tabIndex={-1}
                  className={`epbar-tab ${e.no === epNo ? 'on' : ''}`}
                  onClick={() => choose(e.no)}
                  title={e.hook || e.title || `第 ${e.no} 集`}
                >
                  <b>E{pad(e.no)}</b>
                  {e.title && <span className="epbar-title">{e.title}</span>}
                  <span className="epbar-count">{counts[e.no] ?? 0} 镜</span>
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
