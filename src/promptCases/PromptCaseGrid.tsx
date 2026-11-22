import { useEffect, useRef, useState } from 'react'
import type { PromptCase } from './api'

/**
 * 案例卡片。
 *
 * 封面是外链：加载失败显示占位，不隐藏卡片、不中断列表。案例的主体价值是
 * 提示词文本，封面只是识别辅助。
 */
function CaseCard({
  item,
  selected,
  onSelect,
}: {
  item: PromptCase
  selected: boolean
  onSelect: () => void
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [item.posterUrl])
  const sourceLabel =
    item.source === 'vflow' ? 'vflow' : item.source === 'reverse-own' ? '我的反推' : '手工'
  const shotCount = item.shots?.length || 0

  return (
    <button
      type="button"
      className={`pc-card ${selected ? 'on' : ''}`}
      data-prompt-case-card={item.id}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="pc-card-thumb">
        {item.posterUrl && !broken ? (
          <img src={item.posterUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <div className="pc-card-ph" aria-hidden>
            {shotCount ? `${shotCount} 镜` : '案例'}
          </div>
        )}
        <span className="pc-card-badge">{sourceLabel}</span>
        {item.favorite ? (
          <span className="pc-card-fav" aria-label="已收藏">
            ★
          </span>
        ) : null}
      </div>
      <div className="pc-card-body">
        <h3 className="pc-card-title" title={item.title}>
          {item.title || '(未命名案例)'}
        </h3>
        <div className="pc-card-meta">
          {item.model ? <span className="pc-tag">{item.model}</span> : null}
          {item.category ? <span className="pc-tag ghost">{item.category}</span> : null}
          {shotCount ? <span className="pc-tag ghost">{shotCount} 镜</span> : null}
        </div>
        {item.prompt ? <p className="pc-card-preview">{item.prompt.slice(0, 90)}</p> : null}
      </div>
    </button>
  )
}

export default function PromptCaseGrid({
  cases,
  selectedId,
  onSelect,
  onImport,
  onReverse,
}: {
  cases: PromptCase[]
  selectedId: string
  onSelect: (c: PromptCase) => void
  onImport: () => void
  onReverse: () => void
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  // 换页/换筛选时回到顶部：结果从整库缩到几条时不该停在原滚动位置的空白处
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 })
  }, [cases.length, selectedId])

  return (
    <div className="pc-grid-wrap">
      {cases.length === 0 ? (
        <div className="char-empty-board pc-empty" data-prompt-case-empty>
          <p>案例库还是空的。</p>
          <p className="board-hint">
            可以从外部站点导入公开案例，或把项目视频库里的片子反推成逐镜提示词。
          </p>
          <div className="pc-empty-actions">
            <button type="button" className="btn primary" onClick={onImport}>
              导入外部案例
            </button>
            <button type="button" className="btn" onClick={onReverse}>
              反推我的片子
            </button>
          </div>
        </div>
      ) : (
        <div className="pc-grid" ref={gridRef} data-prompt-case-grid>
          {cases.map((c) => (
            <CaseCard key={c.id} item={c} selected={c.id === selectedId} onSelect={() => onSelect(c)} />
          ))}
        </div>
      )}
    </div>
  )
}
