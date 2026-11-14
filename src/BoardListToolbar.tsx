import type { Dispatch, SetStateAction } from 'react'

type Props = {
  query: string
  onQueryChange: (q: string) => void
  placeholder: string
  ariaLabel?: string
  filteredCount: number
  totalCount: number
  page: number
  totalPages: number
  onPageChange: Dispatch<SetStateAction<number>>
  pageSize: number
}

/** 工作台设定列表：本地搜索 + 分页（角色 / 场景道具 / 视频库共用） */
export function BoardListToolbar({
  query,
  onQueryChange,
  placeholder,
  ariaLabel,
  filteredCount,
  totalCount,
  page,
  totalPages,
  onPageChange,
  pageSize,
}: Props) {
  const showPager = filteredCount > pageSize
  const label = ariaLabel || placeholder

  return (
    <div className="board-list-strip" data-board-list-strip>
      <div className="board-list-toolbar" data-board-list-toolbar>
        <input
          className="stock-search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
        />
        <span className="board-hint board-list-toolbar-meta">
          {query.trim() ? `匹配 ${filteredCount} / ${totalCount}` : `共 ${totalCount} 条`}
        </span>
      </div>
      {showPager ? (
        <div className="online-stock-pager" data-board-list-pager>
          <button
            type="button"
            className="btn-mini"
            disabled={page <= 1}
            onClick={() => onPageChange((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span>
            第 {page} / {totalPages} 页 · 本页最多 {pageSize} 条
          </span>
          <button
            type="button"
            className="btn-mini"
            disabled={page >= totalPages}
            onClick={() => onPageChange((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      ) : null}
    </div>
  )
}