import { useVideoFirstFrame } from '../videoFirstFrame'
import { formatEpisodeLabel } from '../shotRows'
import type { BoardEpisodeRow } from './episodeCover'

export type ScriptBookCardProps = {
  row: BoardEpisodeRow
  /** 当前选中的集（上次打开的集），用于常驻选中态 */
  selected: boolean
  /** 上次读到的场次号；无则 null */
  lastSceneNo?: number | null
  onOpen: (epNo: number) => void
}

function BookCover({ row }: { row: BoardEpisodeRow }) {
  const clipSrc = row.cover.kind === 'clip' ? row.cover.src ?? undefined : undefined
  const videoFrame = useVideoFirstFrame(clipSrc)
  const imgSrc =
    row.cover.kind === 'keyframe' ? row.cover.src : row.cover.kind === 'clip' ? videoFrame : null
  const title = row.title || '未命名'

  if (imgSrc) {
    return (
      <div className="script-book-visual" data-script-book-cover={row.cover.kind}>
        <img className="script-book-visual-img" src={imgSrc} alt="" loading="lazy" decoding="async" />
        <span className="script-book-visual-band">{title}</span>
      </div>
    )
  }
  if (row.cover.kind === 'clip' && row.cover.src) {
    return (
      <div className="script-book-visual" data-script-book-cover="clip">
        <video
          className="script-book-visual-img"
          src={row.cover.src}
          preload="metadata"
          muted
          playsInline
          aria-hidden
        />
        <span className="script-book-visual-band">{title}</span>
      </div>
    )
  }
  return (
    <div className="script-book-visual is-text" data-script-book-cover="text">
      <span className="script-book-visual-no">{formatEpisodeLabel(row.no)}</span>
      <span className="script-book-visual-rule" aria-hidden />
      <span className="script-book-visual-title">{title}</span>
    </div>
  )
}

/**
 * 书架上的「一本书」：书脊 + 书封 + 书架标签。
 *
 * 书名只出现在封面上（文字封面或图带底栏），封面下方是 hook 简介；
 * 点击即进入详情（只此一种含义）；选中态由路由派生，返回书架后常驻。
 * data 属性供验收脚本定位：`data-script-book` / `data-script-ep-card`。
 */
export default function ScriptBookCard({
  row,
  selected,
  lastSceneNo,
  onOpen,
}: ScriptBookCardProps) {
  const label = formatEpisodeLabel(row.no)
  const missing = row.sceneCount === 0
  const meta = [
    missing ? '无场次' : `${row.sceneCount} 场`,
    row.shotCount > 0 ? `${row.shotCount} 镜` : '',
    row.targetSeconds ? `${row.targetSeconds}s` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={`script-book${selected ? ' is-selected' : ''}${missing ? ' is-missing' : ''}`}
      data-script-book={row.no}
      data-script-ep-card={row.no}
      data-selected={selected ? 'true' : 'false'}
      aria-current={selected ? 'true' : undefined}
    >
      <button
        type="button"
        className="script-book-enter"
        onClick={() => onOpen(row.no)}
        aria-label={`${label} ${row.title || '未命名'}${missing ? '（缺剧本）' : ''}，查看剧本`}
      >
        <span className="script-book-spine" aria-hidden>
          <span className="script-book-spine-no">{label}</span>
        </span>
        <span className="script-book-leaf">
          <BookCover row={row} />
          <span className="script-book-copy">
            <span className="script-book-hook">
              {row.hook || (missing ? '尚未登记剧本' : '尚未填写钩子')}
            </span>
          </span>
          <span
            className={`script-book-ribbon${missing ? ' miss' : ' ok'}`}
            aria-hidden
            title={missing ? '缺剧本' : `剧本 · ${row.sceneCount} 场`}
          />
        </span>
      </button>
      <footer className="script-book-shelf">
        <span className="script-book-meta">{meta}</span>
        {selected && lastSceneNo ? (
          <span className="script-book-last">上次读到 第 {lastSceneNo} 场</span>
        ) : missing ? (
          <span className="script-book-state">缺剧本</span>
        ) : null}
      </footer>
    </article>
  )
}
