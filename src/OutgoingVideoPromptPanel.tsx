import { useMemo, useState, type ReactNode } from 'react'
import Fold from './Fold'
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

/** 面板上展示的「提交目标」：让用户确认正文到底发给哪个模型 */
export type VideoSubmitTarget = {
  modelLabel: string
  modelId?: string
  providerLabel?: string
  modeLabel: string
  seconds: number
  resolution?: string
  ratio?: string
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
  /** 正文是否已由人工编辑（`video_prompt` 在 `handEdited` 中）。 */
  handEdited: boolean
  /** 保存正文：写回本镜 `video_prompt` 并记入 `handEdited`。 */
  onSaveBody: (text: string) => void
  /** 清除人工编辑标记，让模型下次重写时可以接管正文。 */
  onClearHandEdit?: () => void
  videoMeta: VideoMeta | null
  hasVideoUrl: boolean
  advancedSlot?: ReactNode
  /** 出片 Inspector：附件与槽位默认展开 */
  defaultRefsOpen?: boolean
  /** 正文实际提交的视频模型与参数 */
  submitTarget?: VideoSubmitTarget
  /** 本轮由 Agent 写入的参考 token：命中的条目显示 Agent 标记 */
  agentTokens?: string[]
}

/** 参考来源标签：让用户一眼看出这张图是角色外观、素材卡还是手填地址 */
const REF_SOURCE_LABEL: Record<string, string> = {
  character: '角色',
  asset: '素材',
  extra: '手工 URL',
  adjacent: '相邻镜',
  expression: '表情',
  lexicon: '运镜',
}

export function refSourceLabel(source?: string): string {
  if (!source) return ''
  return REF_SOURCE_LABEL[source] ?? source
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
  handEdited,
  onSaveBody,
  onClearHandEdit,
  videoMeta,
  hasVideoUrl,
  advancedSlot,
  defaultRefsOpen = false,
  submitTarget,
  agentTokens = [],
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
    onSaveBody(text)
    setEditing(false)
  }

  /**
   * 正文只有三种状态：人工编辑过、镜头正文、升级前保存的旧版本正文。
   * 「语义层 / 脚本拼装 / 模板渲染」随运行时拼装层一起删除，不再有对应来源。
   */
  const legacySnapshot = effective.source === 'legacy-override'
  const badgeClass = legacySnapshot ? 'warn' : handEdited ? 'manual' : 'semantic'
  const badgeLabel = legacySnapshot ? '旧版本正文' : handEdited ? '已手改' : '正文'

  const needsAttention = blocking.length > 0

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

  // 附件与槽位默认收起：展开时正文优先，避免一屏被参考清单占满
  const [refsOpen, setRefsOpen] = useState(defaultRefsOpen)
  const agentSet = new Set(agentTokens)
  // 提示合并成一行入口，逐条内容按需展开
  const [warnsOpen, setWarnsOpen] = useState(false)

  const warnItems = useMemo(
    () => warnings.map((w) => ({ code: w.code, message: w.message })),
    [warnings],
  )

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
                legacySnapshot
                  ? '升级前保存的手改正文，仍逐字提交；在正文区保存一次即迁移到镜头正文'
                  : handEdited
                    ? '该正文已由人工编辑，模型重写提示词时不会覆盖'
                    : '正文来自该镜的 video_prompt'
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
              <p className="vp-disclosure-peek-warn">附件或阻断项需留意，展开查看</p>
            ) : null}
          </>
        }
      >
          <div className="vp-summary">{summary}</div>

          {submitTarget ? (
            <div className="vp-submit" data-vp-submit>
              <div className="vp-submit-line">
                <span className="vp-submit-label">提交给</span>
                <b>{submitTarget.modelLabel}</b>
                {submitTarget.modelId ? <code>{submitTarget.modelId}</code> : null}
              </div>
              <div className="vp-submit-line vp-submit-meta">
                {submitTarget.providerLabel ? <span>{submitTarget.providerLabel}</span> : null}
                <span>{submitTarget.modeLabel}</span>
                <span>{submitTarget.seconds}s</span>
                <span>{submitTarget.resolution || '默认分辨率'}</span>
                {submitTarget.ratio ? <span>{submitTarget.ratio}</span> : null}
              </div>
            </div>
          ) : null}

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
                <img className="vp-ref-thumb" src={r.url} alt="" loading="lazy" />
                <b>图{r.index}</b> {r.label}
                {refSourceLabel(r.source) ? (
                  <em className="vp-ref-src">{refSourceLabel(r.source)}</em>
                ) : null}
                {r.token && agentSet.has(r.token) ? <em className="vp-ref-agent">Agent</em> : null}
                <span>{r.purpose}</span>
              </li>
            ))}
            {video ? (
              <li>
                <b>视频1</b> {video.label}
                <em className="vp-ref-src">{refSourceLabel(video.source)}</em>
                {video.token && agentSet.has(video.token) ? <em className="vp-ref-agent">Agent</em> : null}
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

          {warnItems.length ? (
            <Fold
              className="vp-warns"
              idPrefix="vp-warns"
              title={`${warnItems.length} 条提示`}
              meta="展开逐条查看"
              open={warnsOpen}
              onToggle={() => setWarnsOpen((v) => !v)}
            >
              {warnItems.map((w) => (
                <div className="gen-warn vp-issue" key={w.code}>
                  {w.message}
                </div>
              ))}
            </Fold>
          ) : null}

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
                  保存正文
                </button>
                <button type="button" className="btn-mini" onClick={() => setEditing(false)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              {legacySnapshot ? (
                <p className="vp-legacy-note" data-vp-legacy-note>
                  这是升级前保存的旧版本正文，仍在逐字提交。在正文区保存一次即迁移到镜头正文。
                </p>
              ) : null}

              <pre className="vp-text" data-video-prompt-text>
                {effective.text}
              </pre>

              <p className="vp-verbatim" data-vp-verbatim>
                以上正文逐字提交给 {submitTarget?.modelLabel ?? '视频模型'}；附件按上方槽位提交，正文不会再被服务端改写。
              </p>

              <div className="vp-actions vp-actions--manual">
                <span className="vp-actions-label">正文</span>
                <div className="vp-actions-row">
                  <button type="button" className="btn-mini" onClick={startEdit}>
                    编辑正文
                  </button>
                  {handEdited && onClearHandEdit ? (
                    <button type="button" className="btn-mini" onClick={onClearHandEdit} title="保留正文，但允许模型下次重写时覆盖它">
                      交由模型重写
                    </button>
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
      {/* 阻断项常驻：折叠提示词也不隐藏，避免底栏按钮变灰却看不到原因 */}
      {blocking.length ? (
        <div className="vp-blocking" role="alert" data-vp-blocking>
          {blocking.map((b) => (
            <div className="gen-error vp-issue" key={b.code}>
              {b.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
