import { useMemo, useState } from 'react'
import type { ShotEdgeType, ShotNodeType } from './data'
import type { Relation, ShotData, TransitionEffect, TransitionOut } from './types'
import {
  DEFAULT_TRANSITION_SECONDS,
  MAX_EFFECT_SECONDS,
  clampEffectSeconds,
  effectLabel,
  normalizeEffect,
  normalizeTransitionOut,
  resolveJoin,
} from './transition'
import Fold from './Fold'
import { PRESET_CATEGORY_LABEL, TRANSITION_PRESETS, type TransitionPresetCategory } from './transitionPresets'

const PRESET_ORDER: TransitionPresetCategory[] = ['classic', 'rhythm', 'geometry', 'motion']
/** 常用段固定 4 项：覆盖叠化、黑场淡出、白场淡入、推移 */
const COMMON_PRESET_IDS = ['dissolve', 'fadeblack', 'fadewhite', 'slide-right']
const COMMON_PRESETS = COMMON_PRESET_IDS.map((id) =>
  TRANSITION_PRESETS.find((p) => p.id === id),
).filter((p): p is NonNullable<typeof p> => Boolean(p))
const COMMON_PRESET_SET = new Set(COMMON_PRESET_IDS)

const shotKey = (n: ShotNodeType) => String(n.data.shotId || n.id)
const durOf = (n: ShotNodeType) => Math.max(0.4, Number(n.data.seconds) || 3)

type Props = {
  edge: ShotEdgeType
  source: ShotNodeType
  target: ShotNodeType
  projectName: string
  inactive: boolean
  onPatch: (id: string, p: Partial<ShotData>) => void
  onSetRelation: (edgeId: string, relation: Relation) => void
  onClose: () => void
}

/**
 * 接缝设置：只负责效果转场的预设与时长。
 * 文件名沿用 TransitionPanel —— 它描述的是数据域（transition），标题描述的是用户动作。
 */
export default function TransitionPanel({
  edge,
  source,
  target,
  projectName,
  inactive,
  onPatch,
  onSetRelation,
  onClose,
}: Props) {
  const relation: Relation = edge.data?.relation ?? 'cut'
  const t = useMemo(
    () => ({ ...normalizeTransitionOut(source.data.transitionOut, shotKey(target)), to: shotKey(target) }),
    [source.data.transitionOut, target],
  )
  const effect = normalizeEffect(t.effect)
  const aDur = durOf(source)
  const bDur = durOf(target)
  const join = relation === 'transition' ? resolveJoin(t, aDur, bDur) : { mode: 'cut' as const }
  // 全部预设默认收起，常用段固定 4 项
  const [allPresetsOpen, setAllPresetsOpen] = useState(false)
  const presetGroups = useMemo(() => {
    const m = new Map<TransitionPresetCategory, typeof TRANSITION_PRESETS>()
    for (const cat of PRESET_ORDER) m.set(cat, [])
    for (const p of TRANSITION_PRESETS) {
      const list = m.get(p.category) ?? []
      list.push(p)
      m.set(p.category, list)
    }
    return PRESET_ORDER.map((cat) => ({ cat, label: PRESET_CATEGORY_LABEL[cat], items: m.get(cat) ?? [] }))
  }, [])

  const commit = (next: Partial<TransitionOut>) => {
    const merged = normalizeTransitionOut({ ...t, ...next, to: shotKey(target) }, shotKey(target))
    onPatch(source.id, {
      transitionOut: merged,
      handEdited: [...new Set([...(source.data.handEdited ?? []), 'transition_out'])],
    })
  }

  const setEffect = (patch: Partial<TransitionEffect>) => {
    commit({ effect: { ...effect, ...patch } })
  }

  const delta = join.mode === 'effect' ? -join.seconds : 0
  const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`
  const clamped = clampEffectSeconds(effect.seconds, aDur, bDur)

  return (
    <aside className="inspector tr-panel">
      <header className="panel-head">
        <b>接缝设置</b>
        <span className="panel-sid">
          {source.data.no} → {target.data.no}
        </span>
        <button className="tr-x" onClick={onClose} title="关闭">
          ✕
        </button>
      </header>

      <div className="tr-panel-body si-scroll">
        {inactive ? (
          <div className="tr-warn">
            未参与成片：两镜在播放序列里不相邻。把下一镜拖到相邻位置，或删掉这条线。
          </div>
        ) : null}

        <div className="field">
          <span>接缝</span>
          <div className="tr-seg">
            <button
              className={`btn-mini ${relation === 'cut' ? 'on' : ''}`}
              onClick={() => onSetRelation(edge.id, 'cut')}
            >
              硬切
            </button>
            <button
              className={`btn-mini ${relation === 'transition' ? 'on' : ''}`}
              onClick={() => onSetRelation(edge.id, 'transition')}
            >
              转场
            </button>
          </div>
        </div>

        {relation !== 'transition' ? (
          <div className="tr-note">选「转场」后默认叠化 0.5 秒；旁白不断时用叠化最稳。</div>
        ) : (
          <div className="field">
            <span>效果预设</span>
            <div className="tr-preset-group tr-preset-common">
              <span className="tr-preset-cat">常用</span>
              <div className="tr-grid tr-grid-common">
                {COMMON_PRESETS.map((p) => {
                  const on = (effect.presetId ?? 'dissolve') === p.id
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`btn-mini ${on ? 'on' : ''}`}
                      title={p.xfade}
                      onClick={() =>
                        setEffect({
                          presetId: p.id,
                          type: p.legacyType,
                          ...(p.legacyDir ? { dir: p.legacyDir } : {}),
                        })
                      }
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <Fold
              className="tr-preset-all"
              idPrefix="tr-presets"
              sectionId="effectPresets"
              title="全部预设"
              meta={`${TRANSITION_PRESETS.length - COMMON_PRESETS.length} 种`}
              open={allPresetsOpen}
              onToggle={() => setAllPresetsOpen((v) => !v)}
            >
              {presetGroups.map((group) => {
                const items = group.items.filter((p) => !COMMON_PRESET_SET.has(p.id))
                if (!items.length) return null
                return (
                  <div key={group.cat} className="tr-preset-group">
                    <span className="tr-preset-cat">{group.label}</span>
                    <div className="tr-grid">
                      {items.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`btn-mini ${(effect.presetId ?? 'dissolve') === p.id ? 'on' : ''}`}
                          title={p.xfade}
                          onClick={() =>
                            setEffect({
                              presetId: p.id,
                              type: p.legacyType,
                              ...(p.legacyDir ? { dir: p.legacyDir } : {}),
                            })
                          }
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </Fold>
            <label className="tr-inline">
              <span>重叠</span>
              <input
                type="number"
                min={0}
                max={MAX_EFFECT_SECONDS}
                step={0.1}
                value={effect.seconds}
                onChange={(e) => setEffect({ seconds: Number(e.target.value) || DEFAULT_TRANSITION_SECONDS })}
              />
              <span className="tr-unit">秒</span>
            </label>
            {clamped <= 0 ? (
              <div className="tr-warn">两侧镜头太短，实际按硬切处理。</div>
            ) : clamped < effect.seconds - 0.001 ? (
              <div className="tr-note">短镜限制，实际时长 {clamped.toFixed(1)}s。</div>
            ) : null}
          </div>
        )}

        <div className="tr-note">
          {relation === 'transition'
            ? `${effectLabel(effect)} · 重叠 ${clamped.toFixed(1)}s · 成片 ${deltaText}`
            : `直接拼接 · 成片 ${deltaText}`}
        </div>
        {projectName ? <div className="tr-note">保存到项目：{projectName}</div> : null}
      </div>
    </aside>
  )
}
