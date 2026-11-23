import { useEffect, useRef, useState } from 'react'
import type { PromptCase } from './api'
import { cardFacets, facetValueLabel } from './taxonomy'

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
  const allFacets = Array.isArray(item.facets) ? item.facets : []
  const badges = cardFacets(allFacets)

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
        {badges.length ? (
          <div className="pc-card-facets" data-prompt-case-badges>
            {badges.map((f) => (
              <span
                key={`${f.axis}:${f.value}`}
                className={`pc-facet-tag src-${f.source}`}
                title={`${f.axis} · ${f.source}`}
              >
                {facetValueLabel(f.axis, f.value)}
              </span>
            ))}
            {allFacets.length > badges.length ? (
              <span className="pc-facet-tag more" data-facet-more>+{allFacets.length - badges.length}</span>
            ) : null}
          </div>
        ) : null}
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
  filteredZero = false,
  filteredHint = [],
  onClearFilters,
  scrollKey = '',
}: {
  cases: PromptCase[]
  selectedId: string
  onSelect: (c: PromptCase) => void
  onImport: () => void
  onReverse: () => void
  /** 列表为空是因为筛选条件互斥，而不是案例库本身空 */
  filteredZero?: boolean
  /** 各条件单独命中数，帮助用户看出是哪一条把结果掐断的 */
  filteredHint?: Array<{ label: string; count: number }>
  onClearFilters?: () => void
  /** 换页/换筛选时改变：用它复位滚动，而不是靠结果条数（两页都满 12 条时条数不变） */
  scrollKey?: string
}) {
  const gridRef = useRef<HTMLDivElement>(null)
  /**
   * 换页/换筛选回到顶部。
   *
   * `.pc-grid` 本身不是滚动容器（没设 overflow），在它上面 scrollTo 是空操作；
   * 真正的滚动体是外层 `.board`，所以往上找第一个确实能滚的祖先。
   */
  useEffect(() => {
    const start = gridRef.current
    if (!start) return
    let el: HTMLElement | null = start.parentElement
    while (el) {
      const style = window.getComputedStyle(el)
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 4) break
      el = el.parentElement
    }
    const target = el || (document.scrollingElement as HTMLElement | null)
    target?.scrollTo({ top: 0 })
  }, [scrollKey])

  return (
    <div className="pc-grid-wrap">
      {cases.length === 0 ? (
        filteredZero ? (
          <div className="char-empty-board pc-empty" data-prompt-case-empty="filtered">
            {filteredHint.length ? (
              <>
                <p>没有同时满足这些条件的案例。</p>
                <ul className="pc-empty-conditions">
                  {filteredHint.map((h) => (
                    <li key={h.label}>
                      <span>{h.label}</span>
                      <span className="n">{h.count} 条</span>
                    </li>
                  ))}
                </ul>
                <p className="board-hint">单项都可能命中，组合起来才是空集。可以去掉一条再试。</p>
              </>
            ) : (
              <>
                <p>没有匹配的案例。</p>
                <p className="board-hint">换个关键词，或去掉一条筛选再试。</p>
              </>
            )}
            <div className="pc-empty-actions">
              {onClearFilters ? (
                <button type="button" className="btn primary" onClick={onClearFilters} data-clear-filters>
                  清空筛选
                </button>
              ) : null}
            </div>
          </div>
        ) : (
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
        )
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
