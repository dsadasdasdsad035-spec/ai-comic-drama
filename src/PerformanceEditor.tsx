import type { ReactNode } from 'react'
import {
  EMOTION_OPTIONS,
  PACE_OPTIONS,
  VOLUME_OPTIONS,
  deliveryForLine,
  ensurePerformance,
  normalizePerformanceEntry,
} from './performance'
import type { DialogueDelivery, PerformanceEntry } from './types'

type Props = {
  cast?: string[]
  performance?: PerformanceEntry[]
  dialogue: { speaker: string; text: string }[]
  delivery?: DialogueDelivery[]
  onChange: (next: { performance: PerformanceEntry[]; dialogueDelivery: DialogueDelivery[] }) => void
  disabled?: boolean
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="perf-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/**
 * 表演编辑器：角色层和台词层共用一份数据。
 * 只发出变化后的完整数组，合并与手改标记由宿主决定。
 */
export default function PerformanceEditor({
  cast,
  performance,
  dialogue,
  delivery,
  onChange,
  disabled,
}: Props) {
  const entries = ensurePerformance(cast, performance, dialogue)
  const emit = (next: PerformanceEntry[], nextDelivery: DialogueDelivery[]) => {
    if (disabled) return
    onChange({ performance: next.map(normalizePerformanceEntry), dialogueDelivery: nextDelivery })
  }

  const updateEntry = (index: number, patch: Partial<PerformanceEntry>) => {
    const next = entries.map((e, i) => (i === index ? { ...e, ...patch } : e))
    emit(next, dialogue.map((_, i) => deliveryForLine(delivery, i)))
  }

  const updateDelivery = (index: number, patch: Partial<DialogueDelivery>) => {
    const next = dialogue.map((_, i) => ({
      ...deliveryForLine(delivery, i),
      ...(i === index ? patch : {}),
    }))
    emit(entries, next)
  }

  if (entries.length === 0 && dialogue.length === 0) {
    return <div className="perf-empty">这一镜没有角色或台词，不需要表演。</div>
  }

  return (
    <div className="perf-editor">
      {entries.length > 0 && (
        <div className="perf-block">
          <div className="perf-title">角色表演</div>
          <div className="perf-grid">
            {entries.map((entry, i) => (
              <div className="perf-row" key={entry.character || i}>
                <div className="perf-name" title={entry.character}>
                  {entry.character || `角色 ${i + 1}`}
                </div>
                <Field label="情绪">
                  <select
                    value={entry.emotion}
                    disabled={disabled}
                    onChange={(e) => updateEntry(i, { emotion: e.target.value as PerformanceEntry['emotion'] })}
                  >
                    {EMOTION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="强度">
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={entry.intensity}
                    disabled={disabled}
                    onChange={(e) => updateEntry(i, { intensity: Number(e.target.value) })}
                  />
                  <b className="perf-int">{entry.intensity}</b>
                </Field>
                <Field label="动作">
                  <input
                    value={entry.action ?? ''}
                    disabled={disabled}
                    placeholder="当前景别看得见"
                    onChange={(e) => updateEntry(i, { action: e.target.value })}
                  />
                </Field>
                <Field label="视线">
                  <input
                    value={entry.gaze ?? ''}
                    disabled={disabled}
                    placeholder="看向谁 / 什么"
                    onChange={(e) => updateEntry(i, { gaze: e.target.value })}
                  />
                </Field>
                <label className="perf-check">
                  <input
                    type="checkbox"
                    checked={Boolean(entry.speaks)}
                    disabled={disabled}
                    onChange={(e) => updateEntry(i, { speaks: e.target.checked })}
                  />
                  本镜说话
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {dialogue.length > 0 && (
        <div className="perf-block">
          <div className="perf-title">台词表演</div>
          <div className="perf-dialogue">
            {dialogue.map((line, i) => {
              const d = deliveryForLine(delivery, i)
              return (
                <div className="perf-line" key={`${line.speaker}-${i}-${line.text}`}>
                  <div className="perf-said">
                    <b>{line.speaker || '旁白'}</b>：{line.text || '（空）'}
                  </div>
                  <div className="perf-line-fields">
                    <Field label="情绪">
                      <select
                        value={d.emotion ?? 'neutral'}
                        disabled={disabled}
                        onChange={(e) => updateDelivery(i, { emotion: e.target.value as DialogueDelivery['emotion'] })}
                      >
                        {EMOTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="语速">
                      <select
                        value={d.pace ?? 'normal'}
                        disabled={disabled}
                        onChange={(e) => updateDelivery(i, { pace: e.target.value as DialogueDelivery['pace'] })}
                      >
                        {PACE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="音量">
                      <select
                        value={d.volume ?? 'normal'}
                        disabled={disabled}
                        onChange={(e) => updateDelivery(i, { volume: e.target.value as DialogueDelivery['volume'] })}
                      >
                        {VOLUME_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="重音">
                      <input
                        value={d.emphasis ?? ''}
                        disabled={disabled}
                        placeholder="重读的词"
                        onChange={(e) => updateDelivery(i, { emphasis: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
