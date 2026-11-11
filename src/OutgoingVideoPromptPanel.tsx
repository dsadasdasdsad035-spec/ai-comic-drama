import { useMemo, useState, type ReactNode } from 'react'
import Fold from './Fold'
import type { AppSettings, Stage } from './api'
import {
  StageModelSelect,
  stageDefaultLabel,
  stageModelKey,
  type StagePick,
} from './ModelSelect'
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
  renderStaleMessage?: string
  templateStaleMessage?: string
  onSaveOverride: (text: string) => void
  onClearOverride: () => void
  onRebuildOverride?: () => void
  onTemplateRender?: () => void | Promise<void>
  onClearTemplateRender?: () => void
  onPromptRefine?: () => void
  templateRendering?: boolean
  /** 模板渲染 / 改稿用的文本模型（prompt 环节） */
  settings?: AppSettings | null
  stagePick?: StagePick
  onPickPromptModel?: (stage: Stage, key: string) => void
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
  renderStaleMessage = '模板渲染与当前输入不一致，请点「模板渲染」更新。',
  templateStaleMessage = '内置模板已升级，建议重新模板渲染。',
  onSaveOverride,
  onClearOverride,
  onRebuildOverride,
  onTemplateRender,
  onClearTemplateRender,
  onPromptRefine,
  templateRendering = false,
  settings = null,
  stagePick,
  onPickPromptModel,
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

  const showCompose = Boolean(onPickPromptModel || onTemplateRender || onPromptRefine)
  const promptModelReady = Boolean(stageModelKey(settings, 'prompt', stagePick))
  const promptModelLabel = stageDefaultLabel(settings, 'prompt', stagePick)

  const badgeClass =
    effective.source === 'override'
      ? effective.stale
        ? 'warn'
        : 'manual'
      : effective.autoKind === 'template'
        ? 'template'
        : 'semantic'

  const badgeLabel =
    effective.source === 'override'
      ? effective.stale
        ? '旧快照'
        : '已手改'
      : effective.autoKind === 'template'
        ? '模板渲染'
        : '语义层'

  const needsAttention =
    Boolean(effective.stale || effective.renderStale || effective.templateStale) || blocking.length > 0

  const textChars = effective.text.length
  const peekLine = useMemo(() => {
    const line = effective.text.split(/\n/).map((s) => s.trim()).find(Boolean) || '（暂无正文）'
    return line.length > 72 ? `${line.slice(0, 72)}…` : line
  }, [effective.text])

  const refCount =
    refPrefix.length +
    refs.length +
    (video ? 1 : 0) +
    (audio ? 1 : 0) +
    omitted.length +
    omittedVideos.length

  const [refsOpen, setRefsOpen] = useState(() => refCount <= 4)

  return (
    <div className="vp-panel" data-video-prompt-panel data-open={open ? 'true' : 'false'}>
      <Fold
        open={open}
        onToggle={() => setOpen((v) => !v)}
        title="本次出片提示词"
        idPrefix="vp-disclosure"
        className="vp-fold"
        bodyClassName="vp-disclosure-body"
        meta={
          <>
            {!open ? <span className="vp-disclosure-chars">{textChars} 字</span> : null}
            {needsAttention ? (
              <span className="vp-disclosure-attn" title="正文或附件需更新" />
            ) : null}
            <span
              className={`vp-badge ${badgeClass}`}
              title={
                effective.source === 'override'
                  ? '手改全文优先于模板与语义层'
                  : effective.autoKind === 'template'
                    ? '当前正文来自九段模板渲染'
                    : '当前正文来自镜表语义层（较短）'
              }
            >
              {badgeLabel}
            </span>
          </>
        }
        peek={
          <>
            <p className="vp-disclosure-peek-text" title={effective.text}>
              {peekLine}
            </p>
            {needsAttention ? (
              <p className="vp-disclosure-peek-warn">附件或模板已过期，展开后请更新</p>
            ) : null}
          </>
        }
      >
          <div className="vp-summary">{summary}</div>

          {refCount > 0 ? (
            <Fold
              className="vp-refs-disclosure"
              idPrefix="vp-refs"
              title="附件与槽位"
              meta={`${refCount} 项`}
              open={refsOpen}
              onToggle={() => setRefsOpen((v) => !v)}
            >
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
            </Fold>
          ) : null}

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
          {effective.renderStale ? <div className="gen-warn vp-issue">{renderStaleMessage}</div> : null}
          {effective.templateStale ? <div className="gen-warn vp-issue">{templateStaleMessage}</div> : null}

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

              {showCompose ? (
                <section className="vp-compose" aria-label="AI 扩写出片提示词">
                  <div className="vp-compose-head">
                    <span className="vp-compose-title">AI 扩写</span>
                    <span className="vp-compose-hint">用文本模型生成九段正文，不调用出片 API</span>
                  </div>
                  {onPickPromptModel ? (
                    <div className="vp-compose-model">
                      <StageModelSelect
                        stage="prompt"
                        label="文本模型"
                        settings={settings}
                        pick={stagePick}
                        onChange={onPickPromptModel}
                        compact
                        className="wb-field vp-stage-model"
                        disabled={templateRendering}
                      />
                      <p
                        className={`vp-compose-model-hint ${promptModelReady ? '' : 'is-error'}`}
                        title={promptModelLabel}
                      >
                        {promptModelReady
                          ? `将使用：${promptModelLabel}`
                          : '未配置文本模型，请到设置页绑定「提示词」环节'}
                      </p>
                    </div>
                  ) : null}
                  <div className="vp-compose-actions">
                    {onTemplateRender ? (
                      <button
                        type="button"
                        className="btn-mini vp-btn-primary"
                        disabled={templateRendering || !promptModelReady}
                        title={
                          promptModelReady ? '按设置页技能模板一次性渲染' : '请先配置文本模型'
                        }
                        onClick={() => void onTemplateRender()}
                      >
                        {templateRendering ? '渲染中…' : '一键模板渲染'}
                      </button>
                    ) : null}
                    {onPromptRefine ? (
                      <button
                        type="button"
                        className="btn-mini vp-btn-accent"
                        disabled={!promptModelReady}
                        title={promptModelReady ? '打开聊天多轮改稿' : '请先配置文本模型'}
                        onClick={onPromptRefine}
                      >
                        与模型改稿…
                      </button>
                    ) : null}
                    {onClearTemplateRender ? (
                      <button
                        type="button"
                        className="btn-mini vp-btn-ghost"
                        onClick={onClearTemplateRender}
                      >
                        清除模板层
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <div className="vp-actions vp-actions--manual">
                <span className="vp-actions-label">正文</span>
                <div className="vp-actions-row">
                  <button type="button" className="btn-mini" onClick={startEdit}>
                    手改编辑
                  </button>
                  {effective.source === 'override' ? (
                    <>
                      <button type="button" className="btn-mini" onClick={restore}>
                        {effective.stale ? '重新拼装' : '恢复自动'}
                      </button>
                      {onRebuildOverride ? (
                        <button type="button" className="btn-mini" onClick={onRebuildOverride}>
                          用字段重填
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
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
      </Fold>
    </div>
  )
}
