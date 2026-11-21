import { useEffect, useRef } from 'react'

export type ScriptShelfFilter = 'all' | 'has' | 'missing'
export type ScriptShelfSort = 'episode' | 'scenes' | 'shots' | 'seconds'

export type ScriptShelfCounts = {
  all: number
  has: number
  missing: number
}

type Props = {
  query: string
  onQueryChange: (q: string) => void
  filter: ScriptShelfFilter
  onFilterChange: (f: ScriptShelfFilter) => void
  sort: ScriptShelfSort
  onSortChange: (s: ScriptShelfSort) => void
  counts: ScriptShelfCounts
  /** 当前过滤后的条数，用于「匹配 N / 共 M」 */
  filteredCount: number
}

const FILTERS: Array<{ id: ScriptShelfFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'has', label: '有剧本' },
  { id: 'missing', label: '缺剧本' },
]

const SORTS: Array<{ id: ScriptShelfSort; label: string }> = [
  { id: 'episode', label: '集号' },
  { id: 'scenes', label: '场数' },
  { id: 'shots', label: '镜数' },
  { id: 'seconds', label: '时长' },
]

/**
 * 书架检索条：搜索、状态筛选（带计数）、排序。
 * 与书架网格共用 `--shelf-max` 版心；不改共用 `BoardListToolbar`
 * （那是资产网格的 1320px + 顶部翻页口径）。
 */
export default function ScriptShelfBar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  sort,
  onSortChange,
  counts,
  filteredCount,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // `/` 聚焦搜索、Esc 清空：只在没有输入焦点时抢 `/`，避免打断正在打字的人
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable === true
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="script-shelf-bar" data-script-shelf-bar>
      <div className="script-shelf-search">
        <input
          ref={inputRef}
          className="stock-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onQueryChange('')
            }
          }}
          placeholder="搜索集号、标题、钩子、地点、角色…"
          aria-label="搜索分集剧本"
          data-script-search
        />
        <span className="script-shelf-count" data-script-shelf-count>
          {filteredCount === counts.all ? `共 ${counts.all} 集` : `匹配 ${filteredCount} / ${counts.all}`}
        </span>
      </div>

      <div className="script-shelf-seg" role="group" aria-label="剧本状态筛选">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`script-shelf-seg-btn${filter === f.id ? ' on' : ''}`}
            data-script-filter={f.id}
            aria-pressed={filter === f.id}
            onClick={() => onFilterChange(f.id)}
          >
            {f.label}
            <span className="script-shelf-seg-count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      <label className="script-shelf-sort">
        <span className="script-shelf-sort-label">排序</span>
        <select
          className="script-shelf-sort-select"
          value={sort}
          data-script-sort
          onChange={(e) => onSortChange(e.target.value as ScriptShelfSort)}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
