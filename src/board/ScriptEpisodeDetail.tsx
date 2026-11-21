import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectEpisode, ProjectShot } from '../api'
import { formatEpisodeLabel } from '../shotRows'
import { buildScriptEpisodeMarkdown } from '../intake/scriptExportMarkdown'
import { episodeMarkdown, type RefIndex } from '../storyboardMarkdown'
import { episodeScriptUi } from './episodeScriptUi'
import { findEpisode } from './episodeOps'
import MarkdownDocumentPane, { type MarkdownPaneLayout, type MarkdownRenderer } from './MarkdownDocumentPane'
import ScriptBookReader, { readerScenesOf } from './ScriptBookReader'

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
  onApplyScriptMarkdown?: (markdown: string) => void | Promise<void>
  /** 阅读位置回传到书架（返回时显示「上次读到」） */
  onReadProgress?: (sceneNo: number) => void
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
  onApplyScriptMarkdown,
  onReadProgress,
}: Props) {
  const [tab, setTab] = useState<Tab>('script')
  const [layout, setLayout] = useState<MarkdownPaneLayout>('preview')
  const [renderer, setRenderer] = useState<MarkdownRenderer>('remark')
  const [applyBusy, setApplyBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const episode = findEpisode(episodes, epNo)
  const script = episodeScriptUi(episodes, epNo)
  const shotCount = shots.filter((s) => (Number(s.episode) || 1) === epNo).length

  const scriptMd = useMemo(() => buildScriptEpisodeMarkdown(episode, epNo), [episode, epNo])
  const [scriptDraft, setScriptDraft] = useState(scriptMd)
  const [shotsDraft, setShotsDraft] = useState('')
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

  useEffect(() => {
    setScriptDraft(scriptMd)
  }, [scriptMd])

  useEffect(() => {
    setShotsDraft(shotsMd)
  }, [shotsMd])

  // 切集或切 tab 时回到阅读态：不把上一集的源码态带过来
  useEffect(() => {
    setLayout('preview')
    setMoreOpen(false)
  }, [epNo, tab])

  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const scriptDirty = scriptDraft !== scriptMd
  const paneValue = tab === 'script' ? scriptDraft : shotsDraft
  const reading = layout === 'preview'
  const scenes = useMemo(() => readerScenesOf(episode), [episode])

  const copyMd = async () => {
    const text = tab === 'script' ? scriptDraft : shotsDraft
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 无剪贴板权限时忽略 */
    }
  }

  const applyScript = async () => {
    if (!onApplyScriptMarkdown || applyBusy || !scriptDirty) return
    setApplyBusy(true)
    try {
      await onApplyScriptMarkdown(scriptDraft)
    } finally {
      setApplyBusy(false)
    }
  }

  return (
    <div
      className="script-hub-stage script-hub-detail"
      data-script-hub
      data-script-phase="detail"
      data-script-ep={epNo}
      data-script-detail-layout={layout}
    >
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
          <button type="button" className="btn primary" onClick={onEnterBoard}>
            进画布
          </button>
          <div className="script-detail-more" ref={moreRef}>
            <button
              type="button"
              className={`btn${moreOpen ? ' on' : ''}`}
              data-script-more-toggle
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              title="更多"
              onClick={() => setMoreOpen((v) => !v)}
            >
              ⋯
            </button>
            {moreOpen ? (
              <div className="script-detail-menu" role="menu" data-script-more-menu>
                <button type="button" role="menuitem" onClick={() => void copyMd()}>
                  复制 Markdown
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLayout('source')
                    setMoreOpen(false)
                  }}
                >
                  源码编辑
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setLayout('split')
                    setMoreOpen(false)
                  }}
                >
                  分栏对照
                </button>
                <div className="script-detail-menu-seg" role="group" aria-label="渲染引擎">
                  <span>渲染</span>
                  <button
                    type="button"
                    role="menuitem"
                    className={renderer === 'remark' ? 'on' : ''}
                    data-script-menu-renderer="remark"
                    onClick={() => setRenderer('remark')}
                  >
                    Markdown
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={renderer === 'marked-html' ? 'on' : ''}
                    data-script-menu-renderer="marked-html"
                    onClick={() => setRenderer('marked-html')}
                  >
                    HTML
                  </button>
                </div>
                <button type="button" role="menuitem" onClick={onImportScript}>
                  导入大纲
                </button>
                {script.hasScript ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMoreOpen(false)
                      onDeleteEpisodeScript()
                    }}
                  >
                    删除本分集剧本
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
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

      <h2 className="sr-only">Markdown 文档</h2>

      {reading ? (
        <ScriptBookReader
          epNo={epNo}
          title={episode?.title?.trim() || '未命名'}
          scenes={tab === 'script' ? scenes : []}
          markdown={paneValue}
          previewAttr={tab}
          onProgressChange={
            tab === 'script' && onReadProgress ? (sceneNo) => onReadProgress(sceneNo) : undefined
          }
        />
      ) : (
        <MarkdownDocumentPane
          value={paneValue}
          onChange={(next) => {
            if (tab === 'script') setScriptDraft(next)
            else setShotsDraft(next)
          }}
          readOnly={false}
          layout={layout}
          onLayoutChange={setLayout}
          renderer={renderer}
          onRendererChange={setRenderer}
          previewDataAttr={tab}
          editorHint={tab === 'shots' ? '分镜 Markdown 仅本地编辑；回写请用画布「导入」' : undefined}
        />
      )}

      <footer className="script-hub-detail-foot">
        {!reading ? (
          <button type="button" className="btn" data-script-back-to-reading onClick={() => setLayout('preview')}>
            回到阅读
          </button>
        ) : null}
        {tab === 'script' && onApplyScriptMarkdown ? (
          <button
            type="button"
            className="btn primary"
            data-script-apply-md
            disabled={!scriptDirty || applyBusy}
            onClick={() => void applyScript()}
          >
            {applyBusy ? '写入中…' : '应用剧本 Markdown'}
          </button>
        ) : null}
      </footer>
    </div>
  )
}
