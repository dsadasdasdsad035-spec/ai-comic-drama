import { useEffect, useRef, useState } from 'react'
import { KIND_LABEL, clearFinished, totalCost, useTasks } from './tasks'

/** 顶栏任务台账：运行中 / 失败数 + 花费累计 + 可展开的队列 */
export default function TaskCenter() {
  const tasks = useTasks()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const running = tasks.filter((t) => t.state === 'running').length
  const failed = tasks.filter((t) => t.state === 'error').length
  const cost = totalCost(tasks)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (tasks.length === 0) return null

  return (
    <div className="tc" ref={boxRef}>
      <button
        className={`tc-btn ${failed > 0 ? 'bad' : running > 0 ? 'run' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="任务台账"
      >
        {running > 0 && <span className="tc-pill run">{running} 运行中</span>}
        {failed > 0 && <span className="tc-pill bad">{failed} 失败</span>}
        {running === 0 && failed === 0 && <span className="tc-pill">完成</span>}
        {cost > 0 && <span className="tc-cost">¥{cost.toFixed(2)}</span>}
      </button>

      {open && (
        <div className="tc-panel">
          <div className="tc-head">
            <span>{tasks.length} 条</span>
            <div className="spacer" />
            <button className="btn-mini" onClick={() => setOpen(false)}>
              收起
            </button>
            <button className="btn-mini" onClick={clearFinished} title="只保留还在跑的">
              清完成
            </button>
          </div>
          <div className="tc-list">
            {tasks.map((t) => {
              const dur = t.endedAt ? ((t.endedAt - t.startedAt) / 1000).toFixed(0) : null
              return (
                <div key={t.id} className={`tc-row ${t.state}`}>
                  <span className="tc-kind">{KIND_LABEL[t.kind]}</span>
                  <span className="tc-label" title={t.label}>
                    {t.label}
                  </span>
                  <span className="tc-meta">
                    {t.state === 'running' ? '…' : dur ? `${dur}s` : ''}
                  </span>
                  {t.state === 'error' && t.retry && (
                    <button className="btn-mini" onClick={() => t.retry?.()}>
                      重试
                    </button>
                  )}
                  {t.state === 'error' && t.error && (
                    <span className="tc-err" title={t.error}>
                      {t.error.slice(0, 18)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
