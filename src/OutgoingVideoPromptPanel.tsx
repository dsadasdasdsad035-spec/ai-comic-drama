import { useState, type ReactNode } from 'react'
import type { VideoMeta } from './types'
import {
  type EffectiveVideoPrompt,
  type VideoAttachment,
  type VideoRequestIssue,
} from './videoPrompt'

export type OutgoingVideoPromptRefPrefix = {
  key: string
  bold: string
  label: string
  purpose: string
}

export type OutgoingVideoPromptPanelProps = {
  summary: ReactNode
  refs: VideoAttachment[]
  refPrefix?: OutgoingVideoPromptRefPrefix[]
  video: VideoAttachment | null
  audio?: VideoAttachment | null
  omitted: { label: string; reason: string }[]
  omittedVideos: { label: string; reason: string }[]
  blocking: VideoRequestIssue[]
  warnings: VideoRequestIssue[]
  effective: EffectiveVideoPrompt
  staleMessage?: string
  onSaveOverride: (text: string) => void
  onClearOverride: () => void
  onRebuildOverride?: () => void
  videoMeta: VideoMeta | null
  hasVideoUrl: boolean
  advancedSlot?: ReactNode
}

/**
 * 分镜视频 Tab 与转场生成共用的「本次出片提示词」面板。
 */
export default function OutgoingVideoPromptPanel({
  summary,
  refs,
  refPrefix = [],
  video,
  audio,
  omitted,
  omittedVideos,
  blocking,
  warnings,
  effective,
  staleMessage = '参考、台词或模式已变化，当前正文是保存时的旧快照。',
  onSaveOverride,
  onClearOverride,
  onRebuildOverride,
  videoMeta,
  hasVideoUrl,
  advancedSlot,
}: OutgoingVideoPromptPanelProps) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(effective.text)
    setEditing(true)
  }
  const save = () => {
    const text = draft.trim()
    if (!text) return
    onSaveOverride(text)
    setEditing(false)
  }
  const restore = () => {
    onClearOverride()
    setEditing(false)
  }

  return (
    <div className="vp-panel" data-video-prompt-panel>
      <div className="vp-head">
        <button type="button" className="vp-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} 本次出片提示词
        </button>
        <span
          className={`vp-badge ${
            effective.source === 'override' ? (effective.stale ? 'warn' : 'manual') : 'auto'
          }`}
        >
          {effective.source === 'override' ? (effective.stale ? '旧快照' : '已手改') : '自动拼装'}
        </span>
      </div>

      {open ? (
        <>
          <div className="vp-summary">{summary}</div>

          <ul className="vp-refs">
            {refPrefix.map((a) => (
              <li key={a.key}>
                <b>{a.bold}</b> {a.label}
                <span>{a.purpose}</span>
              </li>
            ))}
            {refs.map((r) => (
              <li key={`${r.slot}-${r.index}-${r.url}`}>
                <b>图{r.index}</b> {r.label}
                <span>{r.purpose}</span>
              </li>
            ))}
            {video ? (
              <li>
                <b>视频1</b> {video.label}
                <span>{video.purpose}</span>
              </li>
            ) : null}
            {audio ? (
              <li>
                <b>音频1</b> {audio.label}
                <span>{audio.purpose}</span>
              </li>
            ) : null}
            {omitted.map((o, i) => (
              <li className="omitted" key={`omitted-${i}-${o.label}`}>
                <b>省略</b> {o.label}
                <span>{o.reason}</span>
              </li>
            ))}
            {omittedVideos.map((o, i) => (
              <li className="omitted" key={`omitted-video-${i}-${o.label}`}>
                <b>忽略</b> {o.label}
                <span>{o.reason}</span>
              </li>
            ))}
          </ul>

          {advancedSlot}

          {blocking.map((b) => (
            <div className="gen-error vp-issue" key={b.code}>
              {b.message}
            </div>
          ))}
          {warnings.map((w) => (
            <div className="gen-warn vp-issue" key={w.code}>
              {w.message}
            </div>
          ))}
          {effective.stale ? <div className="gen-warn vp-issue">{staleMessage}</div> : null}

          {editing ? (
            <>
              <textarea
                className="vp-text vp-textarea"
                rows={9}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="vp-actions">
                <button type="button" className="btn-mini" disabled={!draft.trim()} onClick={save}>
                  保存手改
                </button>
                <button type="button" className="btn-mini" onClick={() => setEditing(false)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <pre className="vp-text" data-video-prompt-text>
                {effective.text}
              </pre>
              <div className="vp-actions">
                <button type="button" className="btn-mini" onClick={startEdit}>
                  编辑
                </button>
                {effective.source === 'override' ? (
                  <>
                    <button type="button" className="btn-mini" onClick={restore}>
                      {effective.stale ? '重新拼装' : '恢复自动拼装'}
                    </button>
                    {onRebuildOverride ? (
                      <button type="button" className="btn-mini" onClick={onRebuildOverride}>
                        用当前字段重填
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </>
          )}

          {videoMeta ? (
            <details className="vp-meta">
              <summary>
                当前视频的提示词 · {new Date(videoMeta.createdAt).toLocaleString()}
                {videoMeta.modelKey ? ` · ${videoMeta.modelKey}` : ''}
              </summary>
              <pre>{videoMeta.prompt}</pre>
            </details>
          ) : hasVideoUrl ? (
            <div className="vp-meta-note">当前视频未记录提示词来源</div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
