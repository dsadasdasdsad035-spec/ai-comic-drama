import type { ProjectEpisode } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { episodeScriptUi } from './episodeScriptUi'

type SceneRow = NonNullable<ProjectEpisode['scenes']>[number]

function sortScenes(scenes: SceneRow[] | undefined): SceneRow[] {
  if (!scenes?.length) return []
  return [...scenes].sort((a, b) => {
    const na = Number(a.no)
    const nb = Number(b.no)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    if (Number.isFinite(na)) return -1
    if (Number.isFinite(nb)) return 1
    return 0
  })
}

type Props = {
  epNo: number
  episode: ProjectEpisode | null
  shotCount: number
  episodes: ProjectEpisode[]
  onClose: () => void
  onImportScript?: () => void
  onEnterBoard?: () => void
  onDeleteEpisodeScript?: () => void
}

/**
 * 分集剧本只读面板：编辑式排版，与分镜导出解耦。
 */
export default function EpisodeScriptDetailDialog({
  epNo,
  episode,
  shotCount,
  episodes,
  onClose,
  onImportScript,
  onEnterBoard,
  onDeleteEpisodeScript,
}: Props) {
  const label = formatEpisodeLabel(epNo)
  const scenes = sortScenes(episode?.scenes)
  const title = String(episode?.title ?? '').trim()
  const hook = String(episode?.hook ?? '').trim()
  const target = episode?.targetSeconds
  const script = episodeScriptUi(episodes, epNo)

  return (
    <div className="mp-backdrop ep-script-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="mp-dialog ep-script-detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ep-script-detail-title"
        data-board-episode-script-detail={epNo}
      >
        <header className="ep-script-head">
          <div className="ep-script-head-main">
            <span className="ep-script-kicker">剧本大纲</span>
            <h2 id="ep-script-detail-title" className="ep-script-hero-title">
              {episode ? title || '未命名' : `${label} · 尚未登记`}
            </h2>
            <div className="ep-script-chips">
              <span className="ep-script-chip">{label}</span>
              <span className={`ep-script-chip${script.hasScript ? '' : ' warn'}`}>
                剧本 · {script.badge}
              </span>
              <span className="ep-script-chip">分镜 · {shotCount} 镜</span>
              {Number.isFinite(Number(target)) && Number(target) > 0 ? (
                <span className="ep-script-chip">目标 {Number(target)}s</span>
              ) : null}
            </div>
          </div>
          <button type="button" className="mp-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="ep-script-body">
          {!episode ? (
            <div className="ep-script-empty-state">
              <p className="ep-script-empty-lead">本集还没有剧本大纲</p>
              <p className="ep-script-empty-copy">
                分镜镜头可以单独存在；大纲写上后，导出 Markdown 才会有集标题与场次小节。可粘贴 JSON、导入文件，或让创意专家
                submit_episodes 写回。
              </p>
              {shotCount > 0 ? (
                <p className="ep-script-empty-note">当前已有 {shotCount} 镜分镜，不受导入影响。</p>
              ) : null}
            </div>
          ) : hook ? (
            <blockquote className="ep-script-hook">
              <span className="ep-script-hook-label">钩子</span>
              {hook}
            </blockquote>
          ) : null}

          {episode && scenes.length === 0 ? (
            <p className="ep-script-empty">已登记分集，但尚未填写场次（scenes）。</p>
          ) : null}

          {scenes.length > 0 ? (
            <ol className="ep-script-timeline">
              {scenes.map((sc, i) => {
                const no = Number(sc.no) || i + 1
                const placeTime = [sc.place, sc.time]
                  .map((x) => String(x ?? '').trim())
                  .filter(Boolean)
                  .join(' · ')
                const slug = String(sc.slug ?? '').trim()
                const cast = (sc.characters ?? [])
                  .map((c) => String(c ?? '').trim())
                  .filter(Boolean)
                const meta: string[] = []
                if (Number.isFinite(Number(sc.intensity))) meta.push(`冲突 ${sc.intensity}`)
                if (String(sc.tone ?? '').trim()) meta.push(String(sc.tone).trim())
                const beats = String(sc.beats ?? '').trim()
                return (
                  <li key={`${no}-${i}`} className="ep-script-timeline-item">
                    <div className="ep-script-timeline-marker" aria-hidden />
                    <div className="ep-script-scene">
                      <div className="ep-script-scene-head">
                        <span className="ep-script-scene-no">场 {no}</span>
                        {slug ? <span className="ep-script-scene-slug">{slug}</span> : null}
                      </div>
                      {placeTime ? <p className="ep-script-line">{placeTime}</p> : null}
                      {cast.length ? <p className="ep-script-line">出场 · {cast.join('、')}</p> : null}
                      {meta.length ? <p className="ep-script-line ep-script-muted">{meta.join(' · ')}</p> : null}
                      {beats ? <p className="ep-script-beats">{beats}</p> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </div>

        <footer className="ep-script-foot">
          <div className="ep-script-foot-start">
            {onEnterBoard ? (
              <button type="button" className="btn" onClick={onEnterBoard}>
                进分镜画布
              </button>
            ) : null}
            {onImportScript ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  onClose()
                  onImportScript()
                }}
              >
                导入大纲
              </button>
            ) : null}
          </div>
          <div className="ep-script-foot-end">
            {script.hasScript && onDeleteEpisodeScript ? (
              <button type="button" className="btn-ghost danger" onClick={onDeleteEpisodeScript}>
                删除剧本
              </button>
            ) : null}
            <button type="button" className="btn primary" onClick={onClose}>
              关闭
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}