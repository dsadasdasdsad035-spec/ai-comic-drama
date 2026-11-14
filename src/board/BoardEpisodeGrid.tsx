import { useMemo } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { useVideoFirstFrame } from '../videoFirstFrame'
import { listBoardEpisodes } from './episodeCover'
import { BoardListToolbar } from '../BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, boardEpisodeMatch, useBoardListFilter } from '../boardListFilter'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  onPick: (epNo: number) => void
  onAddEpisode: () => void
  onImportScript: () => void
  addBusy?: boolean
}

function EpisodeCardCover({ kind, src }: { kind: 'keyframe' | 'clip' | 'none'; src: string | null }) {
  const videoFrame = useVideoFirstFrame(kind === 'clip' ? src ?? undefined : undefined)
  if (kind === 'keyframe' && src) {
    return <img className="board-ep-cover-img" src={src} alt="" loading="lazy" decoding="async" />
  }
  if (kind === 'clip' && videoFrame) {
    return <img className="board-ep-cover-img" src={videoFrame} alt="" loading="lazy" decoding="async" />
  }
  if (kind === 'clip' && src) {
    return <video className="board-ep-cover-vid" src={src} preload="metadata" muted playsInline aria-hidden />
  }
  return (
    <div className="board-ep-cover-placeholder" aria-hidden>
      <span>缺首帧</span>
    </div>
  )
}

/**
 * 画布集目录：选集后再进入单集 Flow。
 */
function EpisodeDirToolbar({
  onAddEpisode,
  onImportScript,
  addBusy,
}: Pick<Props, 'onAddEpisode' | 'onImportScript' | 'addBusy'>) {
  return (
    <div className="board-ep-actions">
      <button type="button" className="btn" data-board-add-ep disabled={addBusy} onClick={onAddEpisode}>
        {addBusy ? '添加中…' : '新增分集'}
      </button>
      <button type="button" className="btn" data-board-import-script onClick={onImportScript}>
        导入分集剧本
      </button>
    </div>
  )
}

export default function BoardEpisodeGrid({
  projectReady,
  episodes,
  shots,
  onPick,
  onAddEpisode,
  onImportScript,
  addBusy,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const list = useBoardListFilter(rows, boardEpisodeMatch)

  if (!projectReady) {
    return (
      <div className="board-ep-stage" data-board-phase="episodes">
        <p className="board-ep-empty">项目加载中…</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="board-ep-stage" data-board-phase="episodes">
        <header className="board-ep-head">
          <div className="board-ep-head-row">
            <div>
              <h1>分集目录</h1>
              <p>先新建分集或导入剧本，再进入单集分镜画布。</p>
            </div>
            <EpisodeDirToolbar
              onAddEpisode={onAddEpisode}
              onImportScript={onImportScript}
              addBusy={addBusy}
            />
          </div>
        </header>
      </div>
    )
  }

  return (
    <div className="board-ep-stage" data-board-phase="episodes">
      <header className="board-ep-head">
        <div className="board-ep-head-row">
          <div>
            <h1>分集目录</h1>
            <p>选一集进入分镜画布。封面取自该集按镜号排序后的第一条镜头。</p>
          </div>
          <EpisodeDirToolbar onAddEpisode={onAddEpisode} onImportScript={onImportScript} addBusy={addBusy} />
        </div>
      </header>
      <BoardListToolbar
        query={list.query}
        onQueryChange={list.setQuery}
        placeholder="搜索集号、标题、镜数、目标时长…"
        ariaLabel="搜索分集"
        filteredCount={list.filteredCount}
        totalCount={list.totalCount}
        page={list.page}
        totalPages={list.totalPages}
        onPageChange={list.setPage}
        pageSize={BOARD_LIST_PAGE_SIZE}
      />
      <div className="board-ep-grid" role="list">
        {list.filteredCount === 0 ? (
          <p className="board-ep-empty">没有匹配的分集，换个关键词试试。</p>
        ) : null}
        {list.slice.map((row) => (
          <button
            type="button"
            key={row.no}
            role="listitem"
            className="board-ep-card"
            data-board-ep={row.no}
            onClick={() => onPick(row.no)}
          >
            <div className="board-ep-cover-wrap">
              <EpisodeCardCover kind={row.cover.kind} src={row.cover.src} />
            </div>
            <span className="board-ep-no">{formatEpisodeLabel(row.no)}</span>
            <span className="board-ep-title">{row.title || '未命名'}</span>
            <span className="board-ep-meta">
              {row.shotCount} 镜
              {row.targetSeconds ? ` · 目标 ${row.targetSeconds}s` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
