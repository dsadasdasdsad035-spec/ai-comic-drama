import { useMemo, useState } from 'react'
import type { PromptCase, PromptCaseFacet, PromptCaseShot } from './api'
import {
  FACET_AXES,
  FACET_SOURCE_LABEL,
  facetKey,
  facetValueLabel,
  getFacetAxis,
  groupFacetsByAxis,
} from './taxonomy'
import { useOverlayChrome } from './useOverlayChrome'

/** 复制到剪贴板：navigator.clipboard 在非安全上下文不可用，退回隐藏 textarea */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Number(sec) || 0)
  const m = Math.floor(s / 60)
  const rest = (s % 60).toFixed(1)
  return m ? `${m}:${rest.padStart(4, '0')}` : `${rest}s`
}

const KIND_TONE: Record<string, string> = {
  live_action: 'live',
  ai_video: 'ai',
  cg_3d: 'cg',
  anim_2d: 'cg',
  stop_motion: 'cg',
  code_render: 'code',
  screen_capture: 'code',
  still_motion: 'still',
  static_hold: 'still',
  film_footage: 'live',
  avatar: 'ai',
}

/**
 * 分面编辑区。
 *
 * 来源标注不是装饰：用户需要知道哪些值是导入/推导出来的、哪些是自己改的。
 * 删掉的自动值不会消失，而是进入「已隐藏」，可一键恢复。
 */
function FacetSection({
  item,
  suppressed,
  onChange,
}: {
  item: PromptCase
  suppressed: PromptCaseFacet[]
  onChange?: (patch: { add?: string[]; remove?: string[]; restore?: string[] }) => void
}) {
  const groups = useMemo(() => groupFacetsByAxis(item.facets), [item.facets])
  const [axisId, setAxisId] = useState(FACET_AXES[0]?.id || '')
  const [valueId, setValueId] = useState('')
  const axis = getFacetAxis(axisId)
  const existing = useMemo(
    () => new Set((item.facets || []).filter((f) => f.axis === axisId).map((f) => f.value)),
    [item.facets, axisId],
  )
  const candidates = (axis?.values || []).filter((v) => !existing.has(v.id))

  return (
    <div className="pc-facets" data-prompt-case-facets>
      <div className="pc-shots-head">
        <b>分类分面</b>
        <span className="board-hint">导入与自动推导的值可以改；人工修正优先</span>
      </div>

      {groups.length ? (
        <div className="pc-facet-groups">
          {groups.map(({ axis: groupAxis, facets }) => (
            <div key={groupAxis.id} className="pc-facet-group" data-facet-axis={groupAxis.id}>
              <span className="pc-facet-group-name">{groupAxis.cn}</span>
              <div className="pc-facet-chips">
                {facets.map((f) => {
                  const key = facetKey(f.axis, f.value)
                  const label = facetValueLabel(f.axis, f.value)
                  return (
                    <span
                      key={key}
                      className={`pc-facet-chip src-${f.source} ${f.unmapped ? 'unmapped' : ''}`}
                      data-facet-source={f.source}
                      data-facet={key}
                      title={f.unmapped ? '来源分类在词表里没有对应值，按原文保留' : undefined}
                    >
                      <span>{label}</span>
                      <em>{FACET_SOURCE_LABEL[f.source] || f.source}</em>
                      {onChange ? (
                        <button
                          type="button"
                          aria-label={`删除分面 ${label}`}
                          onClick={() => onChange({ remove: [key] })}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="board-hint">还没有分面。导入时会自动映射，也可以手动添加。</p>
      )}

      {onChange ? (
        <div className="pc-facet-add">
          <select
            aria-label="分面轴"
            value={axisId}
            onChange={(e) => {
              setAxisId(e.target.value)
              setValueId('')
            }}
          >
            {FACET_AXES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.cn}
              </option>
            ))}
          </select>
          <select aria-label="分面值" value={valueId} onChange={(e) => setValueId(e.target.value)}>
            <option value="">选择值…</option>
            {candidates.map((v) => (
              <option key={v.id} value={v.id}>
                {v.cn}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-mini primary"
            disabled={!valueId}
            onClick={() => {
              if (!valueId) return
              onChange({ add: [facetKey(axisId, valueId)] })
              setValueId('')
            }}
          >
            添加
          </button>
        </div>
      ) : null}

      {suppressed.length ? (
        <div className="pc-facet-hidden" data-facet-hidden>
          <b>已隐藏</b>
          <span className="board-hint">这些自动值被你删过，不会再被推导写回。</span>
          <div className="pc-facet-chips">
            {suppressed.map((f) => {
              const key = facetKey(f.axis, f.value)
              return (
                <button
                  key={key}
                  type="button"
                  className="pc-facet-chip ghost"
                  data-facet-hidden-key={key}
                  onClick={() => onChange?.({ restore: [key] })}
                >
                  {facetValueLabel(f.axis, f.value)}
                  <em>恢复</em>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ShotRow({ shot }: { shot: PromptCaseShot }) {
  const [open, setOpen] = useState(false)
  const tone = shot.unknownKind ? 'unknown' : KIND_TONE[shot.kind] || 'unknown'
  return (
    <li className="pc-shot" data-prompt-case-shot={shot.index}>
      <button type="button" className="pc-shot-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="pc-shot-no">#{shot.index}</span>
        <span className="pc-shot-time">
          {fmtTime(shot.start)} – {fmtTime(shot.end)}
        </span>
        <span className={`pc-kind ${tone}`}>{shot.kindLabel || '未判定'}</span>
        {shot.confidence != null ? (
          <span className="pc-shot-conf">{Math.round(shot.confidence * 100)}%</span>
        ) : (
          <span className="pc-shot-conf unconfirmed">待确认</span>
        )}
        <span className="pc-shot-toggle">{open ? '收起' : '展开'}</span>
      </button>

      {open ? (
        <div className="pc-shot-body">
          {shot.evidence.length ? (
            <div className="pc-shot-block">
              <b>判定依据</b>
              <ul>
                {shot.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="board-hint">这镜没有可用的判定依据，结论标为待确认。</p>
          )}

          {shot.evidenceFrames.length ? (
            <div className="pc-shot-frames">
              {shot.evidenceFrames.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img src={url} alt="" loading="lazy" />
                </a>
              ))}
            </div>
          ) : (
            <p className="board-hint">证据帧缺失（复制失败或产物未产出）。</p>
          )}

          {shot.remakeRoute?.length || shot.remakeNote ? (
            <div className="pc-shot-block">
              <b>复刻路线</b>
              <p className="pc-shot-route">
                {(shot.remakeRoute || []).join(' → ') || shot.remakeExecutor || '未给出'}
                {shot.remakeRule ? ` · ${shot.remakeRule}` : ''}
              </p>
              {shot.remakeNote ? <p className="pc-shot-note">{shot.remakeNote}</p> : null}
            </div>
          ) : null}

          {shot.promptMissing ? (
            <p className="pc-shot-missing">
              这镜没有两段提示词：拆解时未开视觉复核、也没有人工补写。复刻路线仍可用。
            </p>
          ) : (
            <>
              <div className="pc-shot-block">
                <b>画面提示词</b>
                <pre>{shot.keyframePrompt || '(空)'}</pre>
              </div>
              <div className="pc-shot-block">
                <b>出片正文</b>
                <pre>{shot.videoPrompt || '(空)'}</pre>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  )
}

export default function PromptCaseDetail({
  item,
  canApply,
  applyHint,
  busy,
  onCopy,
  onApply,
  onToggleFavorite,
  onSaveNote,
  onDelete,
  onClose,
  suppressedFacets = [],
  onFacetChange,
}: {
  item: PromptCase
  canApply: boolean
  applyHint: string
  busy?: boolean
  onCopy: (text: string, label: string) => void
  onApply: (slot: 'prompt' | 'videoPrompt') => void
  onToggleFavorite: () => void
  onSaveNote: (note: string) => void
  onDelete: () => void
  /** 关闭抽屉：Esc / 点遮罩 / 点关闭按钮共用 */
  onClose: () => void
  suppressedFacets?: PromptCaseFacet[]
  onFacetChange?: (patch: { add?: string[]; remove?: string[]; restore?: string[] }) => void
}) {
  const [note, setNote] = useState(item.note)
  const [editingNote, setEditingNote] = useState(false)
  const { containerRef } = useOverlayChrome({ open: true, onClose })

  const sourceLabel =
    item.source === 'vflow' ? 'vflow（外部导入）' : item.source === 'reverse-own' ? '我的片子反推' : '手工录入'
  const licenseLabel = item.license === 'own' ? '自有' : '仅参考'

  const excerptPrompt = () => {
    if (item.prompt) return item.prompt
    const first = item.shots?.[0]
    return first?.keyframePrompt || ''
  }

  /**
   * 覆盖式抽屉，而不是列表里的一列。
   *
   * 详情列曾固定占 460px，点一张卡就会把画廊从 3 列压成 1 列；且在 1100–1179px
   * 区间三列规则不生效，详情被塞进 236px 的侧栏列变成窄条。改成固定定位后，
   * 列表列数在打开/关闭详情时完全不变——这是本组件的核心约束。
   */
  return (
    <div className="pc-detail-layer" data-prompt-case-detail-layer>
      <button
        type="button"
        className="pc-detail-scrim"
        aria-label="关闭案例详情"
        onClick={onClose}
      />
      <section
        className="pc-detail"
        ref={containerRef}
        data-prompt-case-detail={item.id}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pc-detail-title"
      >
        <header className="pc-detail-head">
          <div className="pc-detail-title">
            <h2 id="pc-detail-title">{item.title || '(未命名案例)'}</h2>
            <div className="pc-detail-meta">
              <span className="pc-tag">{sourceLabel}</span>
              {item.model ? <span className="pc-tag ghost">{item.model}</span> : null}
              {item.category ? <span className="pc-tag ghost">{item.category}</span> : null}
              <span className={`pc-tag ${item.license === 'own' ? 'ok' : 'warn'}`} title="外部案例仅作参考，不得当作自有内容发布">
                {licenseLabel}
              </span>
            </div>
          </div>
          <div className="pc-detail-actions">
            <button
              type="button"
              className={item.favorite ? 'btn-mini primary' : 'btn-mini'}
              onClick={onToggleFavorite}
              title="收藏这条案例"
            >
              {item.favorite ? '★ 已收藏' : '☆ 收藏'}
            </button>
            <button type="button" className="btn-mini danger" onClick={onDelete} title="从案例库删除">
              删除
            </button>
            <button
              type="button"
              className="pc-detail-close"
              onClick={onClose}
              aria-label="关闭详情"
              title="关闭（Esc）"
            >
              ×
            </button>
          </div>
        </header>

        <div className="pc-detail-scroll">
          <div className="pc-detail-media">
            {item.videoUrl ? (
              <video src={item.videoUrl} poster={item.posterUrl || undefined} controls preload="metadata" />
            ) : item.posterUrl ? (
              <img src={item.posterUrl} alt="" />
            ) : (
              <div className="pc-detail-ph">
                <span className="pc-detail-ph-mark" aria-hidden>
                  ▶
                </span>
                <span>这条案例没有封面或原片</span>
              </div>
            )}
          </div>

          <div className="pc-detail-links">
            {item.sourceUrl ? (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="btn-mini ghost">
                查看原文 ↗
              </a>
            ) : null}
            {item.author ? <span className="board-hint">作者 {item.author}</span> : null}
            {item.videoUrl ? (
              <a href={item.videoUrl} target="_blank" rel="noreferrer" className="btn-mini ghost">
                原始视频 ↗
              </a>
            ) : null}
          </div>

          {item.prompt ? (
            <div className="pc-block pc-prompt-block">
              <div className="pc-prompt-head">
                <b>提示词全文</b>
                <span className="spacer" />
                <button type="button" className="btn-mini ghost" onClick={() => onCopy(item.prompt, '提示词')}>
                  复制
                </button>
              </div>
              <pre className="pc-prompt-text">{item.prompt}</pre>
            </div>
          ) : null}

          <div className="pc-block">
            <FacetSection item={item} suppressed={suppressedFacets} onChange={onFacetChange} />
          </div>

          {item.shots?.length ? (
            <div className="pc-block pc-shots">
              <div className="pc-shots-head">
                <b>逐镜拆解</b>
                <span className="board-hint">{item.shots.length} 镜 · 点开看依据与两段提示词</span>
              </div>
              <ol className="pc-shot-list">
                {item.shots.map((s) => (
                  <ShotRow key={s.index} shot={s} />
                ))}
              </ol>
            </div>
          ) : null}

          <div className="pc-block pc-note">
            <div className="pc-prompt-head">
              <b>我的备注</b>
              <span className="spacer" />
              {editingNote ? (
                <>
                  <button
                    type="button"
                    className="btn-mini primary"
                    onClick={() => {
                      onSaveNote(note)
                      setEditingNote(false)
                    }}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    className="btn-mini ghost"
                    onClick={() => {
                      setNote(item.note)
                      setEditingNote(false)
                    }}
                  >
                    取消
                  </button>
                </>
              ) : (
                <button type="button" className="btn-mini ghost" onClick={() => setEditingNote(true)}>
                  编辑
                </button>
              )}
            </div>
            {editingNote ? (
              <textarea
                className="pc-note-input"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="这条写法好在哪里、准备套到哪一镜"
              />
            ) : (
              <p className={item.note ? 'pc-note-text' : 'board-hint'}>{item.note || '还没有备注'}</p>
            )}
          </div>
        </div>

        {/* 吸底：应用动作是详情里唯一「改别人数据」的操作，必须随时可达 */}
        <footer className="pc-apply">
          <div className="pc-apply-head">
            <b>应用到当前镜头</b>
            {!canApply ? <span className="board-hint">{applyHint}</span> : null}
          </div>
          <div className="pc-apply-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!canApply || busy || !excerptPrompt()}
              onClick={() => onApply('prompt')}
              title="写入选中镜头的画面提示词"
            >
              画面提示词
            </button>
            <button
              type="button"
              className="btn"
              disabled={!canApply || busy || !excerptPrompt()}
              onClick={() => onApply('videoPrompt')}
              title="写入选中镜头的出片正文"
            >
              出片正文
            </button>
          </div>
          <p className="board-hint">
            外部案例多为整片级描述，写入后可能需要按镜头删减；反推案例可按镜逐条复制。
          </p>
        </footer>
      </section>
    </div>
  )
}

export { copyText }
