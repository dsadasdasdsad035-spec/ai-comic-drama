import { useMemo } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { useVideoFirstFrame } from '../videoFirstFrame'
import { listBoardEpisodes } from './episodeCover'
import { BoardListToolbar } from '../BoardListToolbar'
import { BOARD_LIST_PAGE_SIZE, boardEpisodeMatch, useBoardListFilter } from '../boardListFilter'
import { downloadStoryboardZip, type RefIndex } from '../storyboardMarkdown'

type Props = {
  projectReady: boolean
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  onPick: (epNo: number) => void
  onAddEpisode: () => void
  onImportScript: () => void
  addBusy?: boolean
  /** 项目标题：用于「导出全部」的 zip 文件名 */
  projectTitle?: string
  /** 轻提示：下载本身没有界面反馈，重复点击需要一句话说明 */
  onNotice?: (msg: string) => void
  /** 参考名字索引：素材标题只在画布节点上，导出侧只做查表 */
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

/**
 * 画布集目录：选集后再进入单集 Flow。
 */
function EpisodeDirToolbar({
  onAddEpisode,
  onImportScript,
  addBusy,
  canExport,
  exportTitle,
  onExportAll,
}: Pick<Props, 'onAddEpisode' | 'onImportScript' | 'addBusy'> & {
  canExport: boolean
  exportTitle: string
  onExportAll: () => void
}) {
  return (
    <div className="board-ep-actions">
      <button type="button" className="btn" data-board-add-ep disabled={addBusy} onClick={onAddEpisode}>
        {addBusy ? '添加中…' : '新增分集'}
      </button>
      <button type="button" className="btn" data-board-import-script onClick={onImportScript}>
        导入分集剧本
      </button>
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
  projectTitle,
  onNotice,
  refIndex,
}: Props) {
  const rows = useMemo(() => listBoardEpisodes(episodes, shots), [episodes, shots])
  const list = useBoardListFilter(rows, boardEpisodeMatch)

  // 有镜头但没登记分集时也算有内容：导出按镜头的集号补齐，缺集不发空文件
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
              canExport={canExport}
              exportTitle={exportTitle}
              onExportAll={handleExportAll}
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
          <EpisodeDirToolbar
            onAddEpisode={onAddEpisode}
            onImportScript={onImportScript}
            addBusy={addBusy}
            canExport={canExport}
            exportTitle={exportTitle}
            onExportAll={handleExportAll}
          />
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
