import { useMemo } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { useVideoFirstFrame } from '../videoFirstFrame'
import { listBoardEpisodes } from './episodeCover'
import { episodeScriptUi } from './episodeScriptUi'
import { BoardListToolbar } from '../BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, boardEpisodeMatch, useBoardListFilter } from '../boardListFilter'
import { downloadStoryboardZip, type RefIndex } from '../storyboardMarkdown'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  onPick: (epNo: number) => void
  onAddEpisode: () => void
  onOpenScript: (epNo: number) => void
  onOpenScriptHub?: () => void
  addBusy?: boolean
  projectTitle?: string
  onNotice?: (msg: string) => void
  refIndex?: RefIndex
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

function EpisodeDirToolbar({
  onAddEpisode,
  onOpenScriptHub,
  addBusy,
  canExport,
  exportTitle,
  onExportAll,
}: Pick<Props, 'onAddEpisode' | 'onOpenScriptHub' | 'addBusy'> & {
  canExport: boolean
  exportTitle: string
  onExportAll: () => void
}) {
  return (
    <div className="board-ep-toolbar">
      <div className="board-ep-toolgroup">
        <span className="board-ep-toollabel">分集</span>
        <button type="button" className="btn primary" data-board-add-ep disabled={addBusy} onClick={onAddEpisode}>
          {addBusy ? '添加中…' : '新建分集'}
        </button>
      </div>
      {onOpenScriptHub ? (
        <div className="board-ep-toolgroup" aria-label="剧本">
          <span className="board-ep-toollabel">剧本</span>
          <button type="button" className="btn btn-ghost" data-board-goto-script onClick={onOpenScriptHub}>
            去剧本中心
          </button>
        </div>
      ) : null}
      <div className="board-ep-toolgroup" aria-label="分镜">
        <span className="board-ep-toollabel">分镜</span>
        <button
          type="button"
          className="btn"
          data-board-export-all
          disabled={!canExport}
          title={exportTitle}
          onClick={onExportAll}
        >
          导出全部
        </button>
      </div>
    </div>
  )
}

type CardProps = {
  row: ReturnType<typeof listBoardEpisodes>[number]
  episodes: ProjectEpisode[]
  onPick: (epNo: number) => void
  onOpenScript: (epNo: number) => void
}

function BoardEpisodeCard({ row, episodes, onPick, onOpenScript }: CardProps) {
  const script = episodeScriptUi(episodes, row.no)
  const displayTitle = row.title || script.title || '未命名'

  return (
    <article className="board-ep-card" data-board-ep-card={row.no}>
      <button
        type="button"
        className="board-ep-enter"
        data-board-ep={row.no}
        onClick={() => onPick(row.no)}
        aria-label={`${formatEpisodeLabel(row.no)} ${displayTitle}，进入分镜画布`}
      >
        <div className="board-ep-cover-wrap">
          <EpisodeCardCover kind={row.cover.kind} src={row.cover.src} />
          <span className="board-ep-cover-badge">{formatEpisodeLabel(row.no)}</span>
        </div>
        <div className="board-ep-body">
          <h2 className="board-ep-title">{displayTitle}</h2>
          <p className="board-ep-sub">
            {row.shotCount > 0 ? `${row.shotCount} 镜` : '尚无分镜'}
            {row.targetSeconds ? ` · 目标 ${row.targetSeconds}s` : ''}
          </p>
        </div>
      </button>

      <footer className="board-ep-foot">
        <div className="board-ep-layers" aria-hidden>
          <span className={`board-ep-pill board-ep-pill-script${script.hasScript ? ' ok' : ' miss'}`}>
            剧本 · {script.badge}
          </span>
          <span className="board-ep-pill board-ep-pill-shots">{row.shotCount} 镜</span>
        </div>
        <div className="board-ep-foot-actions">
          <button
            type="button"
            className="btn-mini board-ep-btn-script"
            data-board-view-script={row.no}
            onClick={() => onOpenScript(row.no)}
          >
            看剧本
          </button>
          <button type="button" className="btn-mini primary board-ep-btn-board" onClick={() => onPick(row.no)}>
            进分镜
          </button>
        </div>
      </footer>
    </article>
  )
}

/**
 * 画布集目录：剧本大纲与分镜画布分层入口。
 */
export default function BoardEpisodeGrid({
  projectReady,
  episodes,
  shots,
  onPick,
  onAddEpisode,
  onOpenScript,
  onOpenScriptHub,
  addBusy,
  projectTitle,
  onNotice,
  refIndex,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const list = useBoardListFilter(rows, boardEpisodeMatch)

  const canExport = projectReady && rows.length > 0
  const exportTitle = !projectReady
    ? '项目加载中'
    : rows.length === 0
      ? '还没有分集，没有可分镜表可导出'
      : `把 ${rows.length} 集各导出一份 Markdown，打包成 zip 下载`

  const handleExportAll = () => {
    const zip = downloadStoryboardZip({ projectName: projectTitle, episodes, shots, refIndex })
    onNotice?.(`已导出 ${zip.entries.length} 集：${zip.fileName}`)
  }

  const headCopy =
    rows.length === 0
      ? '分镜在画布里拆镜；剧本大纲在左侧「剧本」视图编辑或导入。'
      : '封面取自本集第一条有画面的镜头；剧本详情在「剧本」视图查看。'

  if (!projectReady) {
    return (
      <div className="board-ep-stage" data-board-phase="episodes">
        <p className="board-ep-empty">项目加载中…</p>
      </div>
    )
  }

  return (
    <div className="board-ep-stage" data-board-phase="episodes">
      <header className="board-ep-head">
        <div className="board-ep-head-row">
          <div className="board-ep-head-copy">
            <h1>分集工作台</h1>
            <p>{headCopy}</p>
          </div>
          <EpisodeDirToolbar
            onAddEpisode={onAddEpisode}
            onOpenScriptHub={onOpenScriptHub}
            addBusy={addBusy}
            canExport={canExport}
            exportTitle={exportTitle}
            onExportAll={handleExportAll}
          />
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="board-ep-zero">
          <p className="board-ep-zero-lead">还没有任何一集</p>
          <div className="board-ep-zero-actions">
            <button type="button" className="btn primary" disabled={addBusy} onClick={onAddEpisode}>
              新建第一集
            </button>
            {onOpenScriptHub ? (
              <button type="button" className="btn" onClick={onOpenScriptHub}>
                去剧本中心
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
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
              <BoardEpisodeCard
                key={row.no}
                row={row}
                episodes={episodes}
                onPick={onPick}
                onOpenScript={onOpenScript}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}