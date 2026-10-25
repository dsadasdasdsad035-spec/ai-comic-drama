import { useMemo } from 'react'
import type { AppSettings, Cap, ModelEntry } from './api'
import type { CharacterSheet } from './characters'
import type { ShotEdgeType, ShotNodeType } from './data'
import type { Pricing } from './pricing'
import { money, videoCost } from './pricing'
import type { Relation, ShotData, TransitionDirection, TransitionEffect, TransitionOut } from './types'
import {
  DEFAULT_GENERATED_SECONDS,
  DEFAULT_TRANSITION_SECONDS,
  MAX_EFFECT_SECONDS,
  MIN_EFFECT_SECONDS,
  clampEffectSeconds,
  effectLabel,
  generatedFade,
  normalizeEffect,
  normalizeGenerated,
  normalizeTransitionOut,
  resolveJoin,
  transitionFingerprint,
} from './transition'
import {
  effectiveTransitionRefs,
  inheritedTransitionRefs,
  modelSupportsLastFrame,
  transitionRefCandidates,
  transitionRequestSeconds,
} from './transitionGen'

const DIRS: { v: TransitionDirection; label: string }[] = [
  { v: 'left', label: '←' },
  { v: 'right', label: '→' },
  { v: 'up', label: '↑' },
  { v: 'down', label: '↓' },
]

const TYPES: { v: TransitionEffect['type']; label: string }[] = [
  { v: 'dissolve', label: '叠化' },
  { v: 'wipe', label: '擦除' },
  { v: 'slide', label: '推移' },
]

const shotKey = (n: ShotNodeType) => String(n.data.shotId || n.id)
const durOf = (n: ShotNodeType) => Math.max(0.4, Number(n.data.seconds) || 3)

type Props = {
  edge: ShotEdgeType
  source: ShotNodeType
  target: ShotNodeType
  nodes: ShotNodeType[]
  characters: CharacterSheet[]
  missingMedia: Set<string>
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  projectName: string
  price: Pricing
  vidRes: '480p' | '720p'
  inactive: boolean
  onPatch: (id: string, p: Partial<ShotData>) => void
  onSetRelation: (edgeId: string, relation: Relation) => void
  onClose: () => void
  onGenerateKeyframe: (edgeId: string) => void
  onGenerateVideo: (edgeId: string) => void
}

export default function TransitionPanel({
  edge,
  source,
  target,
  nodes,
  characters,
  missingMedia,
  settings,
  pick,
  projectName,
  price,
  vidRes,
  inactive,
  onPatch,
  onSetRelation,
  onClose,
  onGenerateKeyframe,
  onGenerateVideo,
}: Props) {
  const relation: Relation = edge.data?.relation ?? 'cut'
  const t = useMemo(
    () => ({ ...normalizeTransitionOut(source.data.transitionOut, shotKey(target)), to: shotKey(target) }),
    [source.data.transitionOut, target],
  )
  const effect = normalizeEffect(t.effect)
  const g = normalizeGenerated(t.generated)
  const aDur = durOf(source)
  const bDur = durOf(target)
  const fingerprint = transitionFingerprint(source.data, target.data, g)
  const join = relation === 'transition' ? resolveJoin(t, aDur, bDur, fingerprint) : { mode: 'cut' as const }
  const stale = Boolean(g.video?.url && t.meta?.fingerprint && t.meta.fingerprint !== fingerprint)
  const keyframeImage = g.keyframe?.image || g.keyframe?.candidates?.[g.keyframe?.activeIdx ?? 0]

  const videoKey = pick.video || settings?.defaults?.video || ''
  const entry: ModelEntry | undefined = settings?.models.find((m) => m.key === videoKey)
  const supportsLast = modelSupportsLastFrame(entry)
  const req = transitionRequestSeconds(g.targetSeconds, entry?.model, supportsLast)
  const estCost = videoCost(price, req.seconds, vidRes)

  const inherited = useMemo(
    () => inheritedTransitionRefs(source, target, nodes, characters, missingMedia),
    [source, target, nodes, characters, missingMedia],
  )
  const candidates = useMemo(
    () => transitionRefCandidates(source, target, nodes, characters, missingMedia),
    [source, target, nodes, characters, missingMedia],
  )
  const chosen = useMemo(
    () => effectiveTransitionRefs(source, target, nodes, characters, missingMedia, g),
    [source, target, nodes, characters, missingMedia, g],
  )
  const inheritedUrls = new Set(inherited.map((r) => r.url))
  const extras = candidates.filter((c) => !inheritedUrls.has(c.url))

  const commit = (next: Partial<TransitionOut>) => {
    const merged = normalizeTransitionOut({ ...t, ...next, to: shotKey(target) }, shotKey(target))
    onPatch(source.id, {
      transitionOut: merged,
      handEdited: [...new Set([...(source.data.handEdited ?? []), 'transition_out'])],
    })
  }

  const setMode = (mode: 'effect' | 'generated') => {
    if (relation !== 'transition') onSetRelation(edge.id, 'transition')
    commit({ mode })
  }

  const setEffect = (patch: Partial<TransitionEffect>) => {
    commit({ mode: 'effect', effect: { ...effect, ...patch } })
  }

  const setGenerated = (patch: Partial<ReturnType<typeof normalizeGenerated>>) => {
    commit({ mode: 'generated', generated: { ...g, ...patch } })
  }

  const toggleInheritRef = (url: string, token: string, on: boolean) => {
    if (!g.inheritRefs) return
    const excluded = new Set(g.excludeRefIds ?? [])
    if (on) excluded.delete(token)
    else excluded.add(token)
    setGenerated({ excludeRefIds: [...excluded] })
  }

  const toggleExtraRef = (token: string, on: boolean) => {
    const ids = new Set(g.refIds ?? [])
    if (on) ids.add(token)
    else ids.delete(token)
    setGenerated({ refIds: [...ids] })
  }

  const pickKeyframe = (index: number) => {
    const candidates = g.keyframe?.candidates ?? []
    const image = candidates[index]
    if (!image) return
    setGenerated({ keyframe: { ...(g.keyframe ?? { candidates }), activeIdx: index, image } })
  }

  const delta =
    join.mode === 'effect'
      ? -join.seconds
      : join.mode === 'generated'
        ? join.seconds - generatedFade(aDur, join.seconds) - generatedFade(join.seconds, bDur)
        : 0
  const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`
  const clamped = clampEffectSeconds(effect.seconds, aDur, bDur)
  const keyframeState = g.keyframe?.state ?? 'idle'
  const videoState = g.video?.state ?? 'idle'

  return (
    <aside className="inspector tr-panel">
      <header className="panel-head">
        <b>转场</b>
        <span className="panel-sid">
          {source.data.no} → {target.data.no}
        </span>
        <button className="tr-x" onClick={onClose} title="关闭">
          ✕
        </button>
      </header>

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
            className={`btn-mini ${relation === 'transition' && t.mode === 'effect' ? 'on' : ''}`}
            onClick={() => setMode('effect')}
          >
            效果
          </button>
          <button
            className={`btn-mini ${relation === 'transition' && t.mode === 'generated' ? 'on' : ''}`}
            onClick={() => setMode('generated')}
          >
            生成
          </button>
        </div>
      </div>

      {relation !== 'transition' ? (
        <div className="tr-note">选“效果”或“生成”会把这条线标成转场；切回硬切不会删除已填参数和产物。</div>
      ) : null}

      <div className="field">
        <span>效果转场</span>
        <div className="tr-grid">
          {TYPES.map((x) => (
            <button
              key={x.v}
              className={`btn-mini ${effect.type === x.v ? 'on' : ''}`}
              onClick={() => setEffect({ type: x.v, ...(x.v === 'dissolve' ? {} : { dir: effect.dir || 'left' }) })}
            >
              {x.label}
            </button>
          ))}
        </div>
        {effect.type !== 'dissolve' && (
          <div className="tr-grid">
            {DIRS.map((d) => (
              <button
                key={d.v}
                className={`btn-mini ${(effect.dir || 'left') === d.v ? 'on' : ''}`}
                onClick={() => setEffect({ dir: d.v })}
                title={`${effect.type === 'wipe' ? '擦除' : '推移'}${d.label}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
        {effect.type !== 'dissolve' ? (
          <div className="tr-note">擦除/推移在预览里为近似表现，以导出为准。</div>
        ) : null}
        <label className="tr-inline">
          <span>时长</span>
          <input
            type="number"
            min={MIN_EFFECT_SECONDS}
            max={MAX_EFFECT_SECONDS}
            step={0.1}
            value={effect.seconds}
            onChange={(e) => setEffect({ seconds: Number(e.target.value) || DEFAULT_TRANSITION_SECONDS })}
          />
          <span className="tr-unit">秒</span>
        </label>
        {clamped === 0 ? (
          <div className="tr-warn">两侧镜头太短，实际按硬切处理。</div>
        ) : clamped < effect.seconds - 0.001 ? (
          <div className="tr-note">短镜限制，实际时长 {clamped.toFixed(1)}s。</div>
        ) : null}
      </div>

      <div className="field">
        <span>生成转场</span>
        <div className="tr-note">
          先出关键帧，再图生视频。参考默认继承两镜已连的角色/素材，可在这里增删。
        </div>

        <div className="tr-boundary">
          <div>
            <span className="tr-cap">上一镜尾帧</span>
            {g.boundary?.out ? <img src={g.boundary.out} alt="上一镜尾帧" /> : <i className="tr-empty">生成关键帧时自动抽取</i>}
          </div>
          <div>
            <span className="tr-cap">下一镜首帧</span>
            {g.boundary?.in ? <img src={g.boundary.in} alt="下一镜首帧" /> : <i className="tr-empty">生成关键帧时自动抽取</i>}
          </div>
        </div>

        <label className="tr-inline">
          <span>成片时长</span>
          <input
            type="number"
            min={0.8}
            max={3}
            step={0.1}
            value={g.targetSeconds}
            onChange={(e) => setGenerated({ targetSeconds: Number(e.target.value) || DEFAULT_GENERATED_SECONDS })}
          />
          <span className="tr-unit">秒</span>
        </label>
        <div className="tr-note">
          模型 {entry?.label || '未选'} · 请求 {req.seconds}s
          {req.trimTo ? `，成片裁到 ${req.trimTo.toFixed(1)}s` : '，保留整段'}
          {supportsLast ? ' · 首尾帧锁两端' : ''} · 约 ¥{money(estCost)}
        </div>

        <textarea
          className="tr-prompt"
          value={g.prompt}
          placeholder="过渡画面的提示词；留空会用上一镜/下一镜提示词自动拼"
          onChange={(e) => setGenerated({ prompt: e.target.value })}
          rows={3}
        />

        <label className="tr-check">
          <input
            type="checkbox"
            checked={g.inheritRefs}
            onChange={(e) => setGenerated({ inheritRefs: e.target.checked })}
          />
          继承两镜的角色 / 素材参考
        </label>

        <div className="tr-refs">
          {inherited.map((r) => {
            const on = g.inheritRefs && !(g.excludeRefIds ?? []).includes(r.token)
            return (
              <label key={r.token} className={`tr-ref ${on ? 'on' : ''}`} title={r.label}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!g.inheritRefs}
                  onChange={(e) => toggleInheritRef(r.url, r.token, e.target.checked)}
                />
                <img src={r.url} alt="" />
                <span>{r.label}</span>
              </label>
            )
          })}
          {extras.map((r) => {
            const on = (g.refIds ?? []).includes(r.token)
            return (
              <label key={`x-${r.token}`} className={`tr-ref ${on ? 'on' : ''}`} title={r.label}>
                <input type="checkbox" checked={on} onChange={(e) => toggleExtraRef(r.token, e.target.checked)} />
                <img src={r.url} alt="" />
                <span>{r.label}</span>
              </label>
            )
          })}
          {inherited.length === 0 && extras.length === 0 ? (
            <div className="tr-note">当前没有带图的角色或素材参考。</div>
          ) : null}
        </div>
        <div className="tr-note">最终参考 {chosen.length + (g.boundary?.out ? 1 : 0) + (g.boundary?.in ? 1 : 0)} 张（上限 10）。</div>

        <div className="tr-row">
          <button
            className="btn primary"
            onClick={() => onGenerateKeyframe(edge.id)}
            disabled={keyframeState === 'running'}
            title="抽取边界帧 + 角色/素材参考，生成过渡关键帧"
          >
            {keyframeState === 'running' ? '生成中…' : g.keyframe?.candidates?.length ? '重新生成关键帧' : '生成关键帧'}
          </button>
        </div>
        {g.keyframe?.error ? <div className="gen-error">{g.keyframe.error}</div> : null}

        {(g.keyframe?.candidates?.length ?? 0) > 0 && (
          <div className="tr-cands">
            {g.keyframe!.candidates.map((url, i) => (
              <button
                key={url}
                className={`tr-cand ${(g.keyframe?.activeIdx ?? 0) === i ? 'on' : ''}`}
                onClick={() => pickKeyframe(i)}
                title={`用第 ${i + 1} 张当关键帧`}
              >
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        )}

        <div className="tr-row">
          <button
            className="btn primary"
            onClick={() => onGenerateVideo(edge.id)}
            disabled={!keyframeImage || videoState === 'running'}
            title={keyframeImage ? '用关键帧生成转场视频' : '先生成并确认关键帧'}
          >
            {videoState === 'running' ? '生成中…' : g.video?.url ? '重新生成视频' : '生成转场视频'}
          </button>
        </div>
        {!keyframeImage ? <div className="tr-note">没有已确认的关键帧，视频按钮不可用。</div> : null}
        {g.video?.error ? <div className="gen-error">{g.video.error}</div> : null}
        {stale ? <div className="tr-warn">边界或关键帧已变化，这条生成转场需要重生成。</div> : null}
        {g.video?.url ? (
          <video className="tr-video" src={g.video.url} muted loop playsInline controls />
        ) : null}
      </div>

      <div className="tr-foot">
        <span className={`tr-delta ${delta < 0 ? 'neg' : delta > 0 ? 'pos' : ''}`}>成片 {deltaText}</span>
        <span className="tr-note">
          {effectLabel(effect)} · {t.mode === 'generated' && g.video?.url ? `生成 ${join.mode === 'generated' ? join.seconds.toFixed(1) : '—'}s` : `重叠 ${clamped.toFixed(1)}s`}
        </span>
      </div>
      {projectName ? <div className="tr-note">保存到项目：{projectName}</div> : null}
    </aside>
  )
}
