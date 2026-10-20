import { useEffect, useRef, useState } from 'react'
import type { Relation, Tool } from './types'

type Props = {
  tool: Tool
  setTool: (t: Tool) => void
  color: string
  setColor: (c: string) => void
  colors: string[]
  guides: boolean
  setGuides: (v: boolean) => void
  relation: Relation
  setRelation: (r: Relation) => void
}

const RELATION_LABEL: Record<Relation, string> = {
  cut: '硬切',
  transition: '转场',
  flashback: '闪回',
  branch: '分支',
}

const TOOL_LABEL: Record<Tool, string> = { none: '选择', pen: '画笔', rect: '框选' }

/** 顶栏太小了：把标注类工具（画笔/框选/颜色/三分线/连线关系）收进一个下拉 */
export default function ToolMenu({
  tool,
  setTool,
  color,
  setColor,
  colors,
  guides,
  setGuides,
  relation,
  setRelation,
}: Props) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const active = tool !== 'none' || guides

  return (
    <div className="tm" ref={boxRef}>
      <button
        className={`tm-btn ${active ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="标注工具：画笔 / 框选 / 颜色 / 三分线 / 连线关系"
      >
        标注
        <span className="tm-dot" style={{ background: tool === 'none' ? 'transparent' : color }} />
        <span className="tm-cur">
          {TOOL_LABEL[tool]}
          {tool !== 'none' ? '' : `· ${RELATION_LABEL[relation]}`}
        </span>
      </button>

      {open && (
        <div className="tm-panel">
          <div className="tm-row">
            <span className="tm-label">工具</span>
            <div className="tools">
              <button className={tool === 'none' ? 'on' : ''} onClick={() => setTool('none')} title="选择 (V)">
                选择
              </button>
              <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')} title="画笔 (P)">
                画笔
              </button>
              <button className={tool === 'rect' ? 'on' : ''} onClick={() => setTool('rect')} title="框选 (R)">
                框选
              </button>
            </div>
          </div>

          <div className="tm-row">
            <span className="tm-label">颜色</span>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  className={`swatch ${color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className="tm-row">
            <span className="tm-label">辅助</span>
            <label className="toggle">
              <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />
              三分线 <kbd>G</kbd>
            </label>
          </div>

          <div className="tm-row">
            <span className="tm-label">新连线</span>
            <select value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>
              <option value="cut">硬切</option>
              <option value="transition">转场</option>
              <option value="flashback">闪回</option>
              <option value="branch">分支（剧情分叉）</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
