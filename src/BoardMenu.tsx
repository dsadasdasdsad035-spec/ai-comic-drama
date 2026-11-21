import { useEffect, useRef, useState } from 'react'

type Props = {
  /** 每张图单价（来自设置页计价，默认 0.22） */
  perImage?: string
  /** 有 ARK key 才能批量出图 */
  canGen: boolean
  batch: { total: number; done: number } | null
  charsOn: boolean
  diagOn: boolean
  onAddImageShot: () => void
  onAddVideoShot: () => void
  onGenAll: () => void
  onUnifyTransitions: () => void
  /** 导出本集字幕（按镜号顺序累加时间，输出一份完整 SRT） */
  onExportEpisodeSrt: () => void
  /** 本集可导出的字幕 cue 数；0 时按钮禁用 */
  episodeCaptionCount: number
  onFit: () => void
  /** 按分区与栅格重排画布（只改位置，可重复执行） */
  onTidy: () => void
  onToggleChars: () => void
  onToggleDiag: () => void
  /** 清空画布 = 删除当前集全部镜头（真删，需二次确认） */
  onClear: () => void
  /** 清空的范围提示；无项目或无镜头时给出原因 */
  clear: { available: boolean; episodeLabel: string; count: number; reason?: string }
}

/**
 * 画布右上角操作收进一个下拉。
 * 批量任务在跑时，触发器上直接显示进度 —— 收进菜单也不能丢可见性。
 */
export default function BoardMenu({
  perImage = '0.22',
  canGen,
  batch,
  charsOn,
  diagOn,
  onAddImageShot,
  onAddVideoShot,
  onGenAll,
  onUnifyTransitions,
  onExportEpisodeSrt,
  episodeCaptionCount,
  onFit,
  onTidy,
  onToggleChars,
  onToggleDiag,
  onClear,
  clear,
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

  const busy = Boolean(batch)
  const progText = batch ? `生成中 ${batch.done}/${batch.total}` : ''

  const act = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <div className="tm bm" ref={boxRef}>
      <button
        className={`tm-btn ${busy ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="批量生成画面 / 视图 / 清理"
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
            title={canGen ? `按顺序逐镜生成画面（约 ¥${perImage}/张）` : '未配置 ARK_API_KEY'}
          >
            批量生成画面
            <span className="bm-hint">{batch ? `${batch.done}/${batch.total}` : `¥${perImage}/张`}</span>
          </button>
          <button
            className="bm-item"
            onClick={act(onUnifyTransitions)}
            disabled={busy}
            title="只把效果模式的转场统一成叠化 0.5s；生成转场保持不变"
          >
            全片统一叠化
            <span className="bm-hint">0.5s · 跳过生成</span>
          </button>
          <button
            className="bm-item"
            onClick={act(onExportEpisodeSrt)}
            disabled={busy || episodeCaptionCount === 0}
            data-export-episode-srt
            title={
              episodeCaptionCount
                ? `按镜号顺序生成本集完整字幕，时间累加（${episodeCaptionCount} 条 cue）`
                : '本集还没有台词，没有可导出的字幕'
            }
          >
            导出本集字幕
            <span className="bm-hint">{episodeCaptionCount ? `${episodeCaptionCount} 条` : '无台词'}</span>
          </button>

          <div className="bm-sec">画布</div>
          <button className="bm-item" onClick={act(onAddImageShot)}>
            新建生图镜<span className="bm-hint">Seedream</span>
          </button>
          <button className="bm-item" onClick={act(onAddVideoShot)}>
            新建出片镜<span className="bm-hint">Seedance</span>
          </button>
          <button className="bm-item" onClick={act(onFit)}>
            适配视图<span className="bm-hint">Fit</span>
          </button>
          <button
            className="bm-item"
            onClick={act(onTidy)}
            title="按分区与栅格重排全部卡片：分镜按镜号、素材向上生长、角色单行；只改位置，可重复执行"
          >
            整理画布<span className="bm-hint">Tidy</span>
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
          <button
            className="bm-item danger"
            onClick={act(onClear)}
            disabled={!clear.available}
            title={
              clear.available
                ? `删除 ${clear.episodeLabel} 在项目里的全部 ${clear.count} 镜，不可撤销；需要手打集号确认`
                : clear.reason || '当前集在项目里没有镜头'
            }
          >
            清空画布
            <span className="bm-hint">
              {clear.available ? `删本集 ${clear.count} 镜` : '无镜头'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
