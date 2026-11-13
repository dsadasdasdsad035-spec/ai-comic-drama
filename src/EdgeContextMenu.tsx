import { useEffect, useRef, useState } from 'react'

/** 连线右键菜单里的一条关系选项 */
export type EdgeMenuOption = {
  id: string
  label: string
  /** 右侧补充说明：接缝摘要、叙事标注提示等 */
  note?: string
}

type Props = {
  x: number
  y: number
  headTitle: string
  headSub: string
  sectionTitle: string
  options: EdgeMenuOption[]
  /** 当前值，命中项打点 */
  value: string
  /** 点选关系：不关闭菜单，方便连着比较 */
  onPick: (id: string) => void
  /** 关系之外的动作（打开转场设置等） */
  extraActions?: { key: string; label: string; hint?: string; onClick: () => void }[]
  /** 删除连线（底部危险动作） */
  onDelete?: () => void
  onClose: () => void
}

/** 分镜连线右键菜单：关系单选 + 转场设置/删除入口 */
export default function EdgeContextMenu(p: Props) {
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
        className="ctx-menu ctx-menu--edge"
        ref={ref}
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div className="ctx-head">
          <b>{p.headTitle}</b>
          <span>{p.headSub}</span>
        </div>
        <div className="ctx-sec">{p.sectionTitle}</div>
        <div className="ctx-list">
          {p.options.map((o) => (
            <div className={`ctx-row ctx-radio-row ${o.id === p.value ? 'on' : ''}`} key={o.id} data-edge-rel={o.id}>
              <button
                className="ctx-main"
                onClick={() => p.onPick(o.id)}
                title={o.id === p.value ? '当前关系' : `改为${o.label}`}
              >
                <span className="ctx-radio">{o.id === p.value ? '●' : '○'}</span>
                <b>{o.label}</b>
                {o.note && <em className="ctx-note">{o.note}</em>}
              </button>
            </div>
          ))}
        </div>
        {p.extraActions && p.extraActions.length > 0 && (
          <div className="ctx-actions">
            {p.extraActions.map((a) => (
              <button key={a.key} className="ctx-action" onClick={a.onClick} title={a.hint}>
                <span>{a.label}</span>
                {a.hint && <em>{a.hint}</em>}
              </button>
            ))}
          </div>
        )}
        <div className="ctx-hint">点关系即时生效；单击连线只打开菜单，不改动任何设置。</div>
        <div className="ctx-foot">
          {p.onDelete && (
            <button className="danger" onClick={p.onDelete}>
              删除连线
            </button>
          )}
          <button onClick={p.onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
