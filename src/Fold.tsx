import { useId, type ReactNode } from 'react'

export type FoldProps = {
  /** 受控开合状态 */
  open: boolean
  onToggle: () => void
  /** 标题行左侧，通常是一句话说明这一段是什么 */
  title: ReactNode
  /** 标题行右侧的摘要：折叠态也必须能读懂当前状态 */
  meta?: ReactNode
  /** 展开后的内容 */
  children: ReactNode
  /** 折叠态仍要露出的一行（例如阻断原因），不进 body */
  peek?: ReactNode
  className?: string
  bodyClassName?: string
  /** 显式指定 body id 前缀，便于测试与 aria 关联 */
  idPrefix?: string
}

/**
 * 受控折叠原语：单行摘要条 + 就地展开。
 *
 * 不用原生 <details>，因为摘要行内容随状态变化，且项目里已经出现过
 * 原生 open 与 React 状态互相打架的问题。这里用 button + aria 承担
 * 语义，body 用 hidden 控制可见性。
 */
export default function Fold({
  open,
  onToggle,
  title,
  meta,
  children,
  peek,
  className = '',
  bodyClassName = '',
  idPrefix,
}: FoldProps) {
  const auto = useId()
  const base = idPrefix ?? `fold-${auto.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const headId = `${base}-head`
  const bodyId = `${base}-body`

  return (
    <div className={`fold ${className}`.trim()} data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        id={headId}
        className="fold-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="fold-chevron" aria-hidden="true" />
        <span className="fold-title">{title}</span>
        {meta ? <span className="fold-meta">{meta}</span> : null}
      </button>
      {!open && peek ? <div className="fold-peek">{peek}</div> : null}
      <div
        id={bodyId}
        className={`fold-body ${bodyClassName}`.trim()}
        role="region"
        aria-labelledby={headId}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  )
}
