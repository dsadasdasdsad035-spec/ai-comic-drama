import { useEffect, useRef, useState } from 'react'
import type { PromptCase } from './api'
import { cardFacets, facetValueLabel } from './taxonomy'

/**
 * 案例卡片。
 *
 * 结构照 `hub-card`（`src/theme.css` 的 `.hub-card` / `.hub-card-hit`）：
 * 外层 `<article>` 承载视觉，内层按钮承担点击与键盘语义。
 * 之前根节点直接是 `<button>` 却内含 `<h3>`/`<div>`——button 只允许 phrasing content，
 * 读屏与回车行为都不可靠，也无法再放次级操作。
 *
 * 封面是外链：加载失败显示占位，不隐藏卡片、不中断列表。卡片只显示封面，
 * 不自动播放视频：案例的本质是视频参考，但滚动列表时连续起播的带宽与干扰都不划算，
 * 视频在详情抽屉里播。封面上的 ▶ 角标用来表达「这条有原片」。
 *
 * 正文预览已移除：它是「像文本列表」的主因，而正文在详情里完整可读。
 * 列表只需要让人判断「要不要点开」——标题、模型、分面已经足够。
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
    item.source === 'vflow'
      ? 'vflow'
      : item.source === 'apiko'
        ? 'apiko'
        : item.source === 'higgsfield'
          ? 'higgsfield'
          : item.source === 'reverse-own'
          ? '我的反推'
          : '手工'
  const shotCount = item.shots?.length || 0
  const allFacets = Array.isArray(item.facets) ? item.facets : []
  const badges = cardFacets(allFacets)
  const hasVideo = Boolean(item.videoUrl)

  return (
    <article className={`pc-card ${selected ? 'on' : ''}`} data-prompt-case-card={item.id}>
      <button
        type="button"
        className="pc-card-hit"
        aria-pressed={selected}
        onClick={onSelect}
        aria-label={`打开案例 ${item.title || item.id}`}
      >
        <div className={`pc-card-thumb ${hasVideo ? 'has-video' : ''}`}>
          {item.posterUrl && !broken ? (
            <img src={item.posterUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
          ) : (
            /* 无封面时的占位：给一个可识别的视觉锚点，而不是一大块纯色空白 */
            <div className="pc-card-ph" aria-hidden>
              <span className="pc-card-ph-mark">▶</span>
              <span className="pc-card-ph-text">{shotCount ? `${shotCount} 镜` : '案例'}</span>
            </div>
          )}
          <span className="pc-card-badge">{sourceLabel}</span>
          {hasVideo ? (
            <span className="pc-card-play" aria-hidden>
              ▶
            </span>
          ) : null}
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
                <span className="pc-facet-tag more" data-facet-more>
                  +{allFacets.length - badges.length}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>
    </article>
  )
}

export default function PromptCaseGrid({
  cases,
  selectedId,
  onSelect,
  onImport,
  onReverse,
  loading = false,
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
  /** 首次/换筛选的取数进行中：此时不能说「案例库还是空的」 */
  loading?: boolean
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

  /**
   * 加载态优先于空态。
   *
   * 之前两种状态在同一渲染里同时出现：Tab 渲染「正在读取案例库…」，
   * 而 grid 因为 `cases` 还是空数组又渲染「案例库还是空的」，自相矛盾。
   */
  if (loading && cases.length === 0) {
    return (
      <div className="pc-grid-wrap">
        <div className="pc-loading" data-prompt-case-loading aria-busy="true" aria-live="polite">
          <span className="pc-spinner" aria-hidden />
          正在读取案例库…
        </div>
      </div>
    )
  }

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
            <span className="pc-empty-art" aria-hidden>
              ◆
            </span>
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
