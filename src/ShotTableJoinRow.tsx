import { useMemo, useState } from 'react'
import type { ProjectShot } from './api'
import type { TransitionOut } from './types'
import {
  DEFAULT_GENERATED_SECONDS,
  MAX_EFFECT_SECONDS,
  MAX_GENERATED_TARGET,
  MIN_EFFECT_SECONDS,
  MIN_GENERATED_TARGET,
  clampEffectSeconds,
  defaultTransition,
  normalizeEffect,
  normalizeGenerated,
  normalizeTransitionOut,
} from './transition'
import { seamSummary, transitionOutMismatch } from './shotJoins'
import { seamUxStatus, type SeamUxStatus } from './shotTableUx'
import { TRANSITION_PRESETS } from './transitionPresets'

type Props = {
  source: ProjectShot
  target: ProjectShot
  expandedIds: Set<string>
  onToggle: (joinKey: string) => void
  onPatch: (sourceId: string, transitionOut: TransitionOut | null) => void
  onOpenCanvas?: (sourceId: string, targetId: string) => void
}

const STATUS_LABEL: Record<SeamUxStatus, string> = {
  cut: '硬切',
  needs_decision: '待决策',
  needs_prompt: '缺提示词',
  ok: '已就绪',
  mismatch: '错位',
}

const joinKey = (source: ProjectShot, target: ProjectShot) => `${source.id}→${target.id}`

const isCut = (t: TransitionOut | null | undefined) => !t

export default function ShotTableJoinRow({
  source,
  target,
  expandedIds,
  onToggle,
  onPatch,
  onOpenCanvas,
}: Props) {
  const key = joinKey(source, target)
  const toKey = String(target.id || '')
  const aDur = Number(source.seconds) || 0
  const bDur = Number(target.seconds) || 0
  const mismatch = transitionOutMismatch(source, target, source.transition_out)
  const raw = source.transition_out
  const cut = isCut(raw)
  const expanded = expandedIds.has(key) || !cut || mismatch

  const t = useMemo(
    () => (cut ? null : normalizeTransitionOut(raw, toKey)),
    [cut, raw, toKey],
  )
  const effect = normalizeEffect(t?.effect)
  const generated = normalizeGenerated(t?.generated)
  const uxStatus = seamUxStatus(source, target)
  const summary = cut ? '硬切' : seamSummary(t, 'transition')
  const [mode, setMode] = useState<'effect' | 'generated'>(t?.mode === 'generated' ? 'generated' : 'effect')

  const write = (next: TransitionOut | null) => {
    onPatch(source.id, next)
  }

  const ensureTransition = (): TransitionOut => {
    if (t) return { ...t, to: toKey }
    return defaultTransition(toKey)
  }

  const setCut = () => write(null)

  const setModeAnd = (m: 'effect' | 'generated') => {
    setMode(m)
    const base = ensureTransition()
    if (m === 'effect') {
      write({
        ...base,
        mode: 'effect',
        effect: normalizeEffect(base.effect),
        generated: base.generated,
      })
    } else {
      write({
        ...base,
        mode: 'generated',
        generated: normalizeGenerated({
          ...base.generated,
          prompt: base.generated?.prompt ?? '',
          soundPrompt: base.generated?.soundPrompt ?? '',
          targetSeconds: base.generated?.targetSeconds ?? DEFAULT_GENERATED_SECONDS,
        }),
        effect: base.effect,
      })
    }
  }

  return (
    <tr
      className={`wb-seam-row ${mismatch ? 'wb-seam-warn' : ''} ${cut && !expanded ? 'wb-seam-collapsed' : ''}`}
      data-shot-join={key}
    >
      <td colSpan={11}>
        <div className="wb-seam">
          <button
            type="button"
            className="wb-seam-head"
            onClick={() => onToggle(key)}
            aria-expanded={expanded}
          >
            <span className="wb-seam-label">
              接缝 {source.no || source.id} → {target.no || target.id}
            </span>
            <span className={`wb-seam-dot status-${uxStatus}`} title={STATUS_LABEL[uxStatus]} aria-hidden />
            <span className="wb-seam-summary">{summary}</span>
            {mismatch ? (
              <em className="tag bad" title={`transitionOut.to 指向 ${raw?.to ?? '?'}，与播放序下一镜不一致`}>
                错位
              </em>
            ) : null}
            <span className="wb-seam-chevron">{expanded ? '▾' : '▸'}</span>
          </button>

          {expanded ? (
            <div className="wb-seam-body">
              <div className="wb-seam-modes">
                <button
                  type="button"
                  className={`btn-mini ${cut ? 'on' : ''}`}
                  onClick={() => setCut()}
                >
                  硬切
                </button>
                <button
                  type="button"
                  className={`btn-mini ${!cut && (t?.mode ?? mode) === 'effect' ? 'on' : ''}`}
                  onClick={() => setModeAnd('effect')}
                >
                  效果
                </button>
                <button
                  type="button"
                  className={`btn-mini ${!cut && (t?.mode ?? mode) === 'generated' ? 'on' : ''}`}
                  onClick={() => setModeAnd('generated')}
                >
                  生成
                </button>
                {onOpenCanvas ? (
                  <button
                    type="button"
                    className="btn-mini ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenCanvas(source.id, target.id)
                    }}
                    title="在画布打开转场面板（出片与参考帧）"
                  >
                    画布转场…
                  </button>
                ) : null}
              </div>

              {!cut && (t?.mode ?? mode) === 'effect' ? (
                <div className="wb-seam-grid">
                  <label>
                    <span className="label">效果</span>
                    <select
                      value={effect.presetId || 'dissolve'}
                      onChange={(e) => {
                        const base = ensureTransition()
                        write({
                          ...base,
                          mode: 'effect',
                          effect: normalizeEffect({ ...effect, presetId: e.target.value }),
                        })
                      }}
                    >
                      {TRANSITION_PRESETS.slice(0, 12).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">秒</span>
                    <input
                      type="number"
                      min={MIN_EFFECT_SECONDS}
                      max={MAX_EFFECT_SECONDS}
                      step={0.1}
                      value={effect.seconds ?? 0.5}
                      onChange={(e) => {
                        const base = ensureTransition()
                        const sec = clampEffectSeconds(Number(e.target.value) || 0.5, aDur, bDur)
                        write({
                          ...base,
                          mode: 'effect',
                          effect: normalizeEffect({ ...effect, seconds: sec }),
                        })
                      }}
                    />
                  </label>
                </div>
              ) : null}

              {!cut && (t?.mode ?? mode) === 'generated' ? (
                <div className="wb-seam-stack">
                  <label>
                    <span className="label">画面与过渡</span>
                    <textarea
                      rows={2}
                      value={generated.prompt ?? ''}
                      onChange={(e) => {
                        const base = ensureTransition()
                        write({
                          ...base,
                          mode: 'generated',
                          generated: normalizeGenerated({ ...generated, prompt: e.target.value }),
                        })
                      }}
                    />
                  </label>
                  <label>
                    <span className="label">声音描述</span>
                    <textarea
                      rows={2}
                      value={generated.soundPrompt ?? ''}
                      onChange={(e) => {
                        const base = ensureTransition()
                        write({
                          ...base,
                          mode: 'generated',
                          generated: normalizeGenerated({ ...generated, soundPrompt: e.target.value }),
                        })
                      }}
                    />
                  </label>
                  <label className="wb-seam-inline">
                    <span className="label">目标秒</span>
                    <input
                      type="number"
                      min={MIN_GENERATED_TARGET}
                      max={MAX_GENERATED_TARGET}
                      step={0.1}
                      value={generated.targetSeconds ?? DEFAULT_GENERATED_SECONDS}
                      onChange={(e) => {
                        const base = ensureTransition()
                        const sec = Math.min(
                          MAX_GENERATED_TARGET,
                          Math.max(MIN_GENERATED_TARGET, Number(e.target.value) || DEFAULT_GENERATED_SECONDS),
                        )
                        write({
                          ...base,
                          mode: 'generated',
                          generated: normalizeGenerated({ ...generated, targetSeconds: sec }),
                        })
                      }}
                    />
                    {generated.taxonomy ? (
                      <span className="label">taxonomy · {generated.taxonomy}</span>
                    ) : null}
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
