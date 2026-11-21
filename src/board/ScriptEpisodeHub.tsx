import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { listBoardEpisodes } from './episodeCover'
import ScriptShelfBar, { type ScriptShelfFilter, type ScriptShelfSort } from './ScriptShelfBar'
import ScriptBookCard from './ScriptBookCard'
import { BOARD_LIST_PAGE_SIZE, scriptEpisodeMatch, useBoardListFilter } from '../boardListFilter'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  selectedEpNo?: number | null
  onOpenEpisode: (epNo: number) => void
  onImportScript: () => void
  onGoCreative: () => void
  projectTitle?: string
}

function sortRows(
  items: ReturnType<typeof listBoardEpisodes>,
  sort: ScriptShelfSort,
): ReturnType<typeof listBoardEpisodes> {
  const copy = [...items]
  copy.sort((a, b) => {
    if (sort === 'episode') return a.no - b.no
    if (sort === 'scenes') return b.sceneCount - a.sceneCount || a.no - b.no
    if (sort === 'shots') return b.shotCount - a.shotCount || a.no - b.no
    return (b.targetSeconds ?? 0) - (a.targetSeconds ?? 0) || a.no - b.no
  })
  return copy
}

function ShelfPager({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: Dispatch<SetStateAction<number>>
}) {
  if (totalPages <= 1) return null
  return (
    <div className="script-shelf-pager" data-script-shelf-pager>
      <button
        type="button"
        className="btn-mini"
        disabled={page <= 1}
        onClick={() => onPageChange((p) => Math.max(1, p - 1))}
      >
        上一页
      </button>
      <span>
        第 {page} / {totalPages} 页 · 本页最多 {BOARD_LIST_PAGE_SIZE} 本
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
  )
}

export default function ScriptEpisodeHub({
  projectReady,
  episodes,
  shots,
  selectedEpNo,
  onOpenEpisode,
  onImportScript,
  onGoCreative,
  projectTitle,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const [filter, setFilter] = useState<ScriptShelfFilter>('all')
  const [sort, setSort] = useState<ScriptShelfSort>('episode')

  const counts = useMemo(
    () => ({
      all: rows.length,
      has: rows.filter((r) => r.hasScript).length,
      missing: rows.filter((r) => !r.hasScript).length,
    }),
    [rows],
  )

  const statusFiltered = useMemo(() => {
    if (filter === 'has') return rows.filter((r) => r.hasScript)
    if (filter === 'missing') return rows.filter((r) => !r.hasScript)
    return rows
  }, [rows, filter])

  const sorted = useMemo(() => sortRows(statusFiltered, sort), [statusFiltered, sort])
  const list = useBoardListFilter(sorted, scriptEpisodeMatch)

  if (!projectReady) {
    return (
      <div className="script-hub-stage" data-script-hub data-script-phase="list">
        <p className="script-hub-empty">项目加载中…</p>
      </div>
    )
  }

  return (
    <div className="script-hub-stage" data-script-hub data-script-phase="list">
      <div className="script-shelf-canon">
        <header className="script-hub-head">
          <div className="script-hub-head-copy">
            <h1>剧本</h1>
            <p>
              {projectTitle ? `${projectTitle} · ` : ''}
              分集大纲与场次；可先导入任意文本，再用创意 Agent 改稿。分镜在画布编辑。
            </p>
          </div>
          <div className="script-hub-toolbar">
            <button type="button" className="btn primary" data-script-import onClick={onImportScript}>
              导入剧本大纲
            </button>
            <button type="button" className="btn-ghost" onClick={onGoCreative}>
              去创意生成分集
            </button>
          </div>
        </header>

        {rows.length === 0 ? (
          <div className="script-hub-zero">
            <p className="script-hub-zero-lead">还没有分集剧本</p>
            <p className="script-hub-zero-copy">
              导入大纲文本或到创意工作室生成分集；场次格式可在 Agent 改稿后对齐 short-drama。
            </p>
            <div className="script-hub-zero-actions">
              <button type="button" className="btn primary" onClick={onImportScript}>
                导入剧本大纲
              </button>
              <button type="button" className="btn" onClick={onGoCreative}>
                打开创意
              </button>
            </div>
          </div>
        ) : (
          <>
            <ScriptShelfBar
              query={list.query}
              onQueryChange={list.setQuery}
              filter={filter}
              onFilterChange={setFilter}
              sort={sort}
              onSortChange={setSort}
              counts={counts}
              filteredCount={list.filteredCount}
            />
            {list.filteredCount === 0 ? (
              <p className="script-hub-empty script-shelf-empty">没有匹配的分集，换个关键词试试。</p>
            ) : (
              <div className="script-shelf-grid" role="list" data-script-shelf-grid>
                {list.slice.map((row) => (
                  <ScriptBookCard
                    key={row.no}
                    row={row}
                    selected={selectedEpNo === row.no}
                    onOpen={onOpenEpisode}
                  />
                ))}
              </div>
            )}
            <ShelfPager page={list.page} totalPages={list.totalPages} onPageChange={list.setPage} />
          </>
        )}
      </div>
    </div>
  )
}