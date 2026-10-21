import { useEffect, useRef, useState } from 'react'

type Props = {
  /** 有 ARK key 才能批量出图 */
  canGen: boolean
  batch: { total: number; done: number } | null
  vidBatch: { total: number; done: number } | null
  vbatch: { total: number; done: number } | null
  charsOn: boolean
  diagOn: boolean
  onAddShot: () => void
  onGenAll: () => void
  onGenVideoAll: () => void
  onVoiceAll: () => void
  onFit: () => void
  onToggleChars: () => void
  onToggleDiag: () => void
  onClear: () => void
}

/**
 * 画布右上角操作收进一个下拉。
 * 批量任务在跑时，触发器上直接显示进度 —— 收进菜单也不能丢可见性。
 */
export default function BoardMenu({
  canGen,
  batch,
  vidBatch,
  vbatch,
  charsOn,
  diagOn,
  onAddShot,
  onGenAll,
  onGenVideoAll,
  onVoiceAll,
  onFit,
  onToggleChars,
  onToggleDiag,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const running = batch ?? vidBatch ?? vbatch
  const busy = Boolean(running)
  const progText = batch
    ? `生成中 ${batch.done}/${batch.total}`
    : vidBatch
      ? `出片中 ${vidBatch.done}/${vidBatch.total}`
      : vbatch
        ? `配音 ${vbatch.done}/${vbatch.total}`
        : ''

  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div className="tm bm" ref={boxRef}>
      <button
        className={`tm-btn ${busy ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="批量生成 / 出片 / 配音 / 视图 / 清理"
      >
        操作
        {busy ? <span className="bm-prog">{progText}</span> : <span className="tm-cur">批量 · 视图 · 清理</span>}
        <span className="bm-caret">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="tm-panel bm-panel">
          <div className="bm-sec">生成</div>
          <button
            className="bm-item"
            onClick={act(onGenAll)}
            disabled={busy || !canGen}
            title={canGen ? '按顺序逐镜生成画面（约 ¥0.22/张）' : '未配置 ARK_API_KEY'}
          >
            批量生成画面
            <span className="bm-hint">{batch ? `${batch.done}/${batch.total}` : '¥0.22/张'}</span>
          </button>
          <button
            className="bm-item"
            onClick={act(onGenVideoAll)}
            disabled={busy}
            title="给所有已有画面、还没视频的镜头批量出片"
          >
            批量出片
            <span className="bm-hint">{vidBatch ? `${vidBatch.done}/${vidBatch.total}` : 'Seedance'}</span>
          </button>
          <button
            className="bm-item"
            onClick={act(onVoiceAll)}
            disabled={busy}
            title="为所有带台词的镜头生成配音（macOS TTS）"
          >
            批量配音
            <span className="bm-hint">{vbatch ? `${vbatch.done}/${vbatch.total}` : 'TTS'}</span>
          </button>

          <div className="bm-sec">画布</div>
          <button className="bm-item" onClick={act(onAddShot)}>
            新建镜头卡<span className="bm-hint">+</span>
          </button>
          <button className="bm-item" onClick={act(onFit)}>
            适配视图<span className="bm-hint">Fit</span>
          </button>
          <button className={`bm-item ${charsOn ? 'on' : ''}`} onClick={act(onToggleChars)}>
            角色上画布
            <span className="bm-hint">{charsOn ? '开' : '关'}</span>
          </button>
          <button className={`bm-item ${diagOn ? 'on' : ''}`} onClick={act(onToggleDiag)}>
            连续性诊断
            <span className="bm-hint">{diagOn ? '开' : '关'}</span>
          </button>

          <div className="bm-sec">危险</div>
          <button className="bm-item danger" onClick={act(onClear)} title="清空画布（不动 project.json）">
            清空画布<span className="bm-hint">不可撤销</span>
          </button>
        </div>
      )}
    </div>
  )
}
