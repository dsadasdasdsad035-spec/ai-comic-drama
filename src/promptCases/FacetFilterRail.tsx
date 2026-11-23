/**
 * 分面筛选栏（桌面侧栏 / 移动端抽屉共用）。
 *
 * 只渲染词表里存在的轴与值；计数来自当前筛选下的 `/api/prompt-cases`，
 * 因此「0」表示「在当前条件下没有案例」，不是「词表没有这个值」。
 *
 * 默认只展开有条数的轴：18 轴全铺开会让筛选栏比结果列表还长，反而更难用。
 */
import { useMemo, useState } from 'react'
import type { FacetCount } from './api'
import { FACET_AXES, facetKey } from './taxonomy'

const TOP_VALUES = 6

export default function FacetFilterRail({
  counts,
  selected,
  onToggle,
  onClear,
  className = '',
}: {
  counts: FacetCount[]
  /** 已选分面，`axis:value` 形式 */
  selected: string[]
  onToggle: (axis: string, value: string) => void
  onClear?: () => void
  className?: string
}) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of counts) map.set(facetKey(c.axis, c.value), c.count)
    return map
  }, [counts])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  const axes = useMemo(
    () =>
      FACET_AXES.map((axis) => {
        const values = axis.values.map((v) => {
          const key = facetKey(axis.id, v.id)
          return { ...v, key, count: countMap.get(key) || 0, active: selectedSet.has(key) }
        })
        const hasData = values.some((v) => v.count > 0 || v.active)
        return { axis, values, hasData }
      }),
    [countMap, selectedSet],
  )

  const openCount = axes.filter((a) => overrides[a.axis.id] ?? a.hasData).length

  return (
    <aside className={`pc-facet-rail ${className}`} data-facet-rail aria-label="分类筛选">
      <div className="pc-facet-head">
        <strong>分类筛选</strong>
        <span className="pc-facet-count">
          {openCount} / {FACET_AXES.length} 轴有数据
        </span>
        {selected.length ? (
          <button type="button" className="btn-mini ghost" onClick={onClear} data-facet-clear>
            清空分面
          </button>
        ) : null}
      </div>

      {/* 词表本身永远可看：库空时也要能确认「有哪 18 轴、每轴有哪些值」，
          只是计数全为 0、值置灰。以前这里整块吞掉，等于空库看不到分类体系。 */}
      {!counts.length ? (
        <p className="pc-facet-empty">案例库里还没有分面数据。下面是 18 轴词表，导入或回填后各值会显示条数。</p>
      ) : null}

      {axes.map(({ axis, values, hasData }) => {
        const open = overrides[axis.id] ?? hasData
        const all = showAll[axis.id]
        // 已选值即使排在 Top 6 之外也必须显示，否则用户看不到怎么取消
        const visible = all
          ? values
          : [...values.slice(0, TOP_VALUES), ...values.slice(TOP_VALUES).filter((v) => v.active)]
        const more = values.length > visible.length
        return (
          <section key={axis.id} className={`pc-facet-axis ${open ? 'open' : ''}`} data-facet-axis={axis.id}>
            <button
              type="button"
              className="pc-facet-axis-head"
              aria-expanded={open}
              onClick={() => setOverrides((cur) => ({ ...cur, [axis.id]: !open }))}
            >
              <span>{axis.cn}</span>
              <span className="pc-facet-axis-meta">
                {hasData ? `${values.filter((v) => v.count > 0).length} 个值` : '暂无'}
              </span>
            </button>
            {open ? (
              <div className="pc-facet-values">
                {visible.map((v) => {
                  const disabled = !v.active && v.count === 0
                  return (
                    <button
                      key={v.id}
                      type="button"
                      className={`pc-facet-value ${v.active ? 'on' : ''} ${disabled ? 'off' : ''}`}
                      aria-pressed={v.active}
                      disabled={disabled}
                      title={`${v.cn} · ${v.count} 条`}
                      data-facet-value={`${axis.id}:${v.id}`}
                      onClick={() => onToggle(axis.id, v.id)}
                    >
                      <span>{v.cn}</span>
                      <span className="n">{v.count}</span>
                    </button>
                  )
                })}
                {more ? (
                  <button
                    type="button"
                    className="pc-facet-more"
                    onClick={() => setShowAll((cur) => ({ ...cur, [axis.id]: !cur[axis.id] }))}
                  >
                    {showAll[axis.id] ? '收起' : `更多 ${values.length - visible.length}`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        )
      })}
    </aside>
  )
}
