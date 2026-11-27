import { useState } from 'react'
import type { EffectiveVideoPrompt } from './videoPrompt'

export type OutgoingVideoPromptPanelProps = {
  effective: EffectiveVideoPrompt
  /** 正文是否已由人工编辑（`video_prompt` 在 `handEdited` 中）。 */
  handEdited: boolean
  /** 保存正文：写回本镜 `video_prompt` 并记入 `handEdited`。 */
  onSaveBody: (text: string) => void
  /** 清除人工编辑标记，让模型下次重写时可以接管正文。 */
  onClearHandEdit?: () => void
  /** 正文为空：槽位显示空态文案 */
  empty?: boolean
}

/**
 * 提示词槽位：出片镜四个参考槽位之一。
 *
 * 只剩正文本身与来源徽章。附件清单、提交目标、省略项、当前视频提示词历史
 * 都由槽位面板承担，正文逐字提交给模型。
 */
export default function OutgoingVideoPromptPanel({
  effective,
  handEdited,
  onSaveBody,
  onClearHandEdit,
  empty = false,
}: OutgoingVideoPromptPanelProps) {
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

  const legacySnapshot = effective.source === 'legacy-override'
  const badgeClass = legacySnapshot ? 'warn' : handEdited ? 'manual' : 'semantic'
  const badgeLabel = legacySnapshot ? '旧版本正文' : handEdited ? '已手改' : '正文'

  return (
    <div className="vp-panel" data-video-prompt-panel>
      <div className="vp-slot-head">
        <span className={`vp-badge ${badgeClass}`}>{badgeLabel}</span>
        <span className="vp-slot-chars">{effective.text.length} 字</span>
      </div>

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

          {empty ? (
            <p className="refx-empty" data-vp-empty>
              还没有正文。正文是出片唯一必填项，写一段镜头描述后再生成。
            </p>
          ) : (
            <pre className="vp-text" data-video-prompt-text>
              {effective.text}
            </pre>
          )}

          <div className="vp-actions vp-actions--manual">
            <span className="vp-actions-label">{empty ? '补写正文' : '正文'}</span>
            <div className="vp-actions-row">
              <button type="button" className="btn-mini" onClick={startEdit}>
                {empty ? '写正文' : '编辑正文'}
              </button>
              {handEdited && onClearHandEdit ? (
                <button
                  type="button"
                  className="btn-mini"
                  onClick={onClearHandEdit}
                  title="保留正文，但允许模型下次重写时覆盖它"
                >
                  交由模型重写
                </button>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
