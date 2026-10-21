import { useEffect, useRef, useState } from 'react'

/** 右键菜单里的一行：画布上的某张卡（角色 / 素材 / 分镜） */
export type CtxItem = {
  id: string
  title: string
  tag?: string
  img?: string
  /** 已建立参考关系 */
  on?: boolean
}

type Props = {
  x: number
  y: number
  headTitle: string
  headSub: string
  sectionTitle: string
  emptyText: string
  hint?: string
  items: CtxItem[]
  /** 点行主体：切换参考关系 */
  onClickItem: (id: string) => void
  /** 点「首帧」：用这张图当本镜首帧（视频参考） */
  onFirstFrame?: (id: string) => void
  onEdit?: () => void
  onDelete?: () => void
  onClose: () => void
}

/** 画布右键菜单：不填 URL，直接从画布上的卡片里点选参考 */
export default function NodeContextMenu(p: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: p.x, y: p.y })

  // 贴边翻面：菜单超出视口就换到另一侧
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let x = p.x
    let y = p.y
    if (x + r.width + 8 > window.innerWidth) x = Math.max(8, p.x - r.width)
    if (y + r.height + 8 > window.innerHeight) y = Math.max(8, window.innerHeight - r.height - 8)
    setPos({ x, y })
  }, [p.x, p.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') p.onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [p.onClose])

  return (
    <div
      className="ctx-scrim"
      onMouseDown={p.onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onClose()
      }}
    >
      <div
        className="ctx-menu"
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="ctx-head">
          <b>{p.headTitle}</b>
          <span>{p.headSub}</span>
        </div>
        <div className="ctx-sec">{p.sectionTitle}</div>
        {p.items.length === 0 ? (
          <div className="ctx-empty">{p.emptyText}</div>
        ) : (
          <div className="ctx-list">
            {p.items.map((it) => (
              <div className={`ctx-row ${it.on ? 'on' : ''}`} key={it.id} data-ref={it.id}>
                <button
                  className="ctx-main"
                  onClick={() => p.onClickItem(it.id)}
                  title={it.on ? '点击取消参考' : '点击作为参考'}
                >
                  <span className="ctx-thumb">{it.img ? <img src={it.img} alt="" /> : <i />}</span>
                  <span className="ctx-text">
                    <b>{it.title}</b>
                    {it.tag && <em>{it.tag}</em>}
                  </span>
                  <span className="ctx-tick">{it.on ? '✓' : '+'}</span>
                </button>
                {p.onFirstFrame && it.img && (
                  <button
                    className="ctx-act"
                    onClick={() => p.onFirstFrame!(it.id)}
                    title="用这张图当本镜首帧（出片参考）"
                  >
                    首帧
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {p.hint && <div className="ctx-hint">{p.hint}</div>}
        <div className="ctx-foot">
          {p.onEdit && <button onClick={p.onEdit}>编辑</button>}
          {p.onDelete && (
            <button className="danger" onClick={p.onDelete}>
              删除卡片
            </button>
          )}
          <button onClick={p.onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
