import { useEffect, useRef, useState, type ReactNode } from 'react'

export type WorkbenchBarProps = {
  /** 范围槽：本视图在看什么（视图名 · 集 · 数量） */
  scope?: ReactNode
  /** 范围槽里的次级细节：窄列时被收起 */
  scopeDetail?: ReactNode
  /** 设置槽：模型、批次等只影响本视图的参数 */
  settings?: ReactNode
  /** 动作槽：本视图的入口与主操作，永不换行 */
  actions?: ReactNode
}

/**
 * 视图上下文带（两段式上沿的第二条）。
 * 固定「范围 | 设置 | 动作」三段位，各工作台只往槽里填内容。
 *
 * 宽度用自身测量而不是容器查询：`.board` 里还有 `position: fixed` 的抽屉，
 * 给板加 `container-type` 会把它们改成相对板定位。ResizeObserver 只读尺寸，
 * 不建立包含块，行为一样且没有这个副作用。
 */
export default function WorkbenchBar({ scope, scopeDetail, settings, actions }: WorkbenchBarProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [density, setDensity] = useState<'wide' | 'narrow' | 'tight'>('wide')

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = (w: number) => {
      const next = w <= 620 ? 'tight' : w <= 1100 ? 'narrow' : 'wide'
      setDensity((cur) => (cur === next ? cur : next))
    }
    apply(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="wb-bar" data-density={density} ref={ref}>
      <div className="wb-bar-scope">
        {scope}
        {scopeDetail ? <span className="wb-bar-detail">{scopeDetail}</span> : null}
      </div>
      {settings ? <div className="wb-bar-settings">{settings}</div> : null}
      <div className="spacer" />
      {actions ? <div className="wb-bar-actions">{actions}</div> : null}
    </div>
  )
}
