import { useMemo, useState } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { ChatText } from '../chat-ui/ChatText'
import { buildScriptEpisodeMarkdown } from '../intake/scriptExportMarkdown'
import { episodeMarkdown, type RefIndex } from '../storyboardMarkdown'
import { episodeScriptUi } from './episodeScriptUi'
import { findEpisode } from './episodeOps'

type Tab = 'script' | 'shots'

type Props = {
  epNo: number
  episodes: ProjectEpisode[]
  shots: ProjectShot[]
  projectName: string
  projectStyle?: string
  projectAspect?: string
  logline?: string
  refIndex?: RefIndex
  onBack: () => void
  onEnterBoard: () => void
  onImportScript: () => void
  onDeleteEpisodeScript: () => void
}

export default function ScriptEpisodeDetail({
  epNo,
  episodes,
  shots,
  projectName,
  projectStyle,
  projectAspect,
  logline,
  refIndex,
  onBack,
  onEnterBoard,
  onImportScript,
  onDeleteEpisodeScript,
}: Props) {
  const [tab, setTab] = useState<Tab>('script')
  const episode = findEpisode(episodes, epNo)
  const script = episodeScriptUi(episodes, epNo)
  const shotCount = shots.filter((s) => (Number(s.episode) || 1) === epNo).length

  const scriptMd = useMemo(() => buildScriptEpisodeMarkdown(episode, epNo), [episode, epNo])
  const shotsMd = useMemo(
    () =>
      episodeMarkdown(
        {
          projectName,
          style: projectStyle,
          aspect: projectAspect,
          logline,
          episodes,
          shots,
          refIndex,
        },
        epNo,
      ).text,
    [projectName, projectStyle, projectAspect, logline, episodes, shots, epNo, refIndex],
  )

  const copyMd = async () => {
    const text = tab === 'script' ? scriptMd : shotsMd
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 无剪贴板权限时忽略 */
    }
  }

  return (
    <div className="script-hub-stage script-hub-detail" data-script-hub data-script-phase="detail" data-script-ep={epNo}>
      <header className="script-hub-detail-head">
        <button type="button" className="btn-ghost script-hub-back" onClick={onBack}>
          ← 分集列表
        </button>
        <div className="script-hub-detail-title">
          <h1>{episode?.title?.trim() || '未命名'}</h1>
          <div className="script-hub-chips">
            <span className="script-hub-chip">{formatEpisodeLabel(epNo)}</span>
            <span className={`script-hub-chip${script.hasScript ? '' : ' warn'}`}>剧本 · {script.badge}</span>
            <span className="script-hub-chip">分镜 · {shotCount} 镜</span>
          </div>
        </div>
        <div className="script-hub-detail-actions">
          <button type="button" className="btn" onClick={() => void copyMd()}>
            复制 Markdown
          </button>
          <button type="button" className="btn" onClick={onImportScript}>
            导入大纲
          </button>
          <button type="button" className="btn primary" onClick={onEnterBoard}>
            进画布
          </button>
        </div>
      </header>

      <div className="script-hub-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`script-hub-tab${tab === 'script' ? ' on' : ''}`}
          aria-selected={tab === 'script'}
          data-script-preview-tab="script"
          onClick={() => setTab('script')}
        >
          剧本
        </button>
        <button
          type="button"
          role="tab"
          className={`script-hub-tab${tab === 'shots' ? ' on' : ''}`}
          aria-selected={tab === 'shots'}
          data-script-preview-tab="shots"
          onClick={() => setTab('shots')}
        >
          分镜
        </button>
      </div>

      <h2 className="sr-only">Markdown 预览</h2>
      <div className="script-md-preview" data-script-md-preview={tab}>
        <ChatText text={tab === 'script' ? scriptMd : shotsMd} />
      </div>

      <footer className="script-hub-detail-foot">
        {script.hasScript ? (
          <button type="button" className="btn-ghost danger" onClick={onDeleteEpisodeScript}>
            删除本分集剧本
          </button>
        ) : null}
      </footer>
    </div>
  )
}