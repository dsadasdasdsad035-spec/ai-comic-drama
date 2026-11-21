import { useMemo } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { listBoardEpisodes } from './episodeCover'
import { episodeScriptUi } from './episodeScriptUi'
import { BoardListToolbar } from '../BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, boardEpisodeMatch, useBoardListFilter } from '../boardListFilter'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  onOpenEpisode: (epNo: number) => void
  onImportScript: () => void
  onGoCreative: () => void
  projectTitle?: string
}

export default function ScriptEpisodeHub({
  projectReady,
  episodes,
  shots,
  onOpenEpisode,
  onImportScript,
  onGoCreative,
  projectTitle,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const list = useBoardListFilter(rows, boardEpisodeMatch)

  if (!projectReady) {
    return (
      <div className="script-hub-stage" data-script-hub data-script-phase="list">
        <p className="script-hub-empty">项目加载中…</p>
      </div>
    )
  }

  return (
    <div className="script-hub-stage" data-script-hub data-script-phase="list">
      <header className="script-hub-head">
        <div className="script-hub-head-copy">
          <h1>剧本</h1>
          <p>
            {projectTitle ? `${projectTitle} · ` : ''}
            分集大纲与场次；改稿走创意 Agent 或导入 Markdown。分镜在画布编辑。
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
          <p className="script-hub-zero-copy">粘贴 short-drama 场次标题的 Markdown，或在创意工作室让 Agent 提交分集。</p>
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
          <BoardListToolbar
            query={list.query}
            onQueryChange={list.setQuery}
            placeholder="搜索集号、标题、场数、镜数…"
            ariaLabel="搜索分集剧本"
            filteredCount={list.filteredCount}
            totalCount={list.totalCount}
            page={list.page}
            totalPages={list.totalPages}
            onPageChange={list.setPage}
            pageSize={BOARD_LIST_PAGE_SIZE}
          />
          <div className="script-hub-grid board-ep-grid" role="list">
            {list.filteredCount === 0 ? (
              <p className="script-hub-empty">没有匹配的分集，换个关键词试试。</p>
            ) : null}
            {list.slice.map((row) => {
              const script = episodeScriptUi(episodes, row.no)
              const displayTitle = row.title || script.title || '未命名'
              return (
                <article
                  key={row.no}
                  className="board-ep-card script-hub-card"
                  data-script-ep-card={row.no}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="board-ep-enter"
                    onClick={() => onOpenEpisode(row.no)}
                    aria-label={`${formatEpisodeLabel(row.no)} ${displayTitle}，查看剧本`}
                  >
                    <div className="board-ep-body">
                      <span className="script-hub-ep-no">{formatEpisodeLabel(row.no)}</span>
                      <h2 className="board-ep-title">{displayTitle}</h2>
                      <p className="board-ep-sub">
                        剧本 · {script.badge}
                        {row.shotCount > 0 ? ` · ${row.shotCount} 镜` : ''}
                        {row.targetSeconds ? ` · 目标 ${row.targetSeconds}s` : ''}
                      </p>
                    </div>
                  </button>
                  <footer className="board-ep-foot">
                    <button type="button" className="btn-mini primary" onClick={() => onOpenEpisode(row.no)}>
                      查看剧本
                    </button>
                  </footer>
                </article>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}