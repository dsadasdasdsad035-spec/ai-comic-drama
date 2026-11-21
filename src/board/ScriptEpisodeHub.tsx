import { useMemo, useState } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { listBoardEpisodes } from './episodeCover'
import { BOARD_LIST_PAGE_SIZE, scriptEpisodeMatch, useBoardListFilter } from '../boardListFilter'
import ScriptBookCard from './ScriptBookCard'
import ScriptShelfBar, {
  type ScriptShelfCounts,
  type ScriptShelfFilter,
  type ScriptShelfSort,
} from './ScriptShelfBar'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  onOpenEpisode: (epNo: number) => void
  onImportScript: () => void
  onGoCreative: () => void
  projectTitle?: string
  /** 上次打开的集（返回书架后的选中态） */
  lastEpNo?: number | null
  /** 上次读到的场次号；无则 null */
  lastSceneNo?: number | null
}

export default function ScriptEpisodeHub({
  projectReady,
  episodes,
  shots,
  onOpenEpisode,
  onImportScript,
  onGoCreative,
  projectTitle,
  lastEpNo,
  lastSceneNo,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const list = useBoardListFilter(rows, scriptEpisodeMatch)
  const [filter, setFilter] = useState<ScriptShelfFilter>('all')
  const [sort, setSort] = useState<ScriptShelfSort>('episode')

  const counts: ScriptShelfCounts = useMemo(
    () => ({
      all: rows.length,
      // spec：没有 episodes 记录或场次为空都算缺剧本；书架上以「有场次」为准
      has: rows.filter((r) => r.sceneCount > 0).length,
      missing: rows.filter((r) => r.sceneCount === 0).length,
    }),
    [rows],
  )

  // 筛选叠在搜索的结果之上：先按 query 过滤，再按状态过滤，最后排序
  const visible = useMemo(() => {
    const base =
      filter === 'all'
        ? list.filtered
        : list.filtered.filter((r) => (filter === 'has' ? r.sceneCount > 0 : r.sceneCount === 0))
    const sorted = base.slice()
    if (sort === 'scenes') sorted.sort((a, b) => b.sceneCount - a.sceneCount || a.no - b.no)
    else if (sort === 'shots') sorted.sort((a, b) => b.shotCount - a.shotCount || a.no - b.no)
    else if (sort === 'seconds') {
      sorted.sort((a, b) => (b.targetSeconds ?? 0) - (a.targetSeconds ?? 0) || a.no - b.no)
    } else sorted.sort((a, b) => a.no - b.no)
    return sorted
  }, [list.filtered, filter, sort])

  const totalPages = Math.max(1, Math.ceil(visible.length / BOARD_LIST_PAGE_SIZE))
  const [page, setPage] = useState(1)
  const pageSafe = Math.min(page, totalPages)
  const slice = visible.slice((pageSafe - 1) * BOARD_LIST_PAGE_SIZE, pageSafe * BOARD_LIST_PAGE_SIZE)

  const resetPage = () => setPage(1)

  if (!projectReady) {
    return (
      <div className="script-hub-stage" data-script-hub data-script-phase="list">
        <p className="script-hub-empty">项目加载中…</p>
      </div>
    )
  }

  return (
    <div className="script-hub-stage" data-script-hub data-script-phase="list">
      <div className="script-shelf">
        <header className="script-hub-head">
          <div className="script-hub-head-copy">
            <h1>剧本</h1>
            <p>
              {projectTitle ? `${projectTitle} · ` : ''}
              {rows.length} 集 · {counts.has} 集有剧本。改稿走创意 Agent 或导入 Markdown，分镜在画布编辑。
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
              粘贴 short-drama 场次标题的 Markdown，或在创意工作室让 Agent 提交分集。
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
              onQueryChange={(q) => {
                list.setQuery(q)
                resetPage()
              }}
              filter={filter}
              onFilterChange={(f) => {
                setFilter(f)
                resetPage()
              }}
              sort={sort}
              onSortChange={(s) => {
                setSort(s)
                resetPage()
              }}
              counts={counts}
              filteredCount={visible.length}
            />

            {visible.length === 0 ? (
              <div className="script-shelf-empty" data-script-shelf-empty>
                <p>没有匹配的分集。</p>
                <div className="script-shelf-empty-actions">
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={() => {
                      list.setQuery('')
                      setFilter('all')
                      resetPage()
                    }}
                  >
                    清除搜索与筛选
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="script-shelf-grid" role="list">
                  {slice.map((row) => (
                    <div key={row.no} role="listitem">
                      <ScriptBookCard
                        row={row}
                        selected={lastEpNo === row.no}
                        lastSceneNo={lastEpNo === row.no ? lastSceneNo : null}
                        onOpen={onOpenEpisode}
                      />
                    </div>
                  ))}
                </div>

                <footer className="script-shelf-foot" data-script-shelf-foot>
                  <span>
                    {formatEpisodeLabel(slice[0]?.no ?? 1)} – {formatEpisodeLabel(slice[slice.length - 1]?.no ?? 1)}
                    {' · '}
                    共 {visible.length} 集
                  </span>
                  {visible.length > BOARD_LIST_PAGE_SIZE ? (
                    <span className="script-shelf-pager">
                      <button
                        type="button"
                        className="btn-mini"
                        disabled={pageSafe <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        上一页
                      </button>
                      <span>
                        第 {pageSafe} / {totalPages} 页
                      </span>
                      <button
                        type="button"
                        className="btn-mini"
                        disabled={pageSafe >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        下一页
                      </button>
                    </span>
                  ) : null}
                </footer>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
