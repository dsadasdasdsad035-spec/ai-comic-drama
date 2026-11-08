import { useMemo, useState } from 'react'
import type { AppSettings, Cap, ModelEntry } from './api'
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
  autoTransitionVideoPrompt,
  buildTransitionVideoPreview,
  modelSupportsLastFrame,
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
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  projectName: string
  price: Pricing
  vidRes: '480p' | '720p'
  inactive: boolean
  onPatch: (id: string, p: Partial<ShotData>) => void
  onSetRelation: (edgeId: string, relation: Relation) => void
  onClose: () => void
  onRefreshBoundary: (edgeId: string) => void
  onGenerateVideo: (edgeId: string) => void
}

export default function TransitionPanel({
  edge,
  source,
  target,
  settings,
  pick,
  projectName,
  price,
  vidRes,
  inactive,
  onPatch,
  onSetRelation,
  onClose,
  onRefreshBoundary,
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
  const [previewOpen, setPreviewOpen] = useState(true)

  const videoKey = pick.video || settings?.defaults?.video || ''
  const entry: ModelEntry | undefined = settings?.models.find((m) => m.key === videoKey)
  const supportsLast = modelSupportsLastFrame(entry)
  const req = transitionRequestSeconds(g.targetSeconds, entry?.model, supportsLast)
  const estCost = videoCost(price, req.seconds, vidRes)

  const preview = useMemo(
    () =>
      buildTransitionVideoPreview({
        source,
        target,
        generated: g,
        model: entry,
      }),
    [source, target, g, entry],
  )

  const autoPrompt = useMemo(
    () => autoTransitionVideoPrompt(source, target, { ...g, videoPromptOverride: undefined }),
    [source, target, g],
  )

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
    commit({ mode: 'generated', generated: { ...g, bridging: 'morph', ...patch } })
  }

  const setBoundaryUrl = (side: 'out' | 'in', url: string) => {
    setGenerated({
      boundary: {
        ...(g.boundary ?? {}),
        [side]: url.trim() || undefined,
      },
    })
  }

  const delta =
    join.mode === 'effect'
      ? -join.seconds
      : join.mode === 'generated'
        ? join.seconds - generatedFade(aDur, join.seconds) - generatedFade(join.seconds, bDur)
        : 0
  const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`
  const clamped = clampEffectSeconds(effect.seconds, aDur, bDur)
  const videoState = g.video?.state ?? 'idle'
  const overrideOn = Boolean(g.videoPromptOverride?.trim())

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
        <div className="tr-note">
          旁白不断 →「效果」叠化；天气/环境大变 →「生成」+ 下方出片预览里改提示词与边界。
        </div>
      ) : null}

      {relation === 'transition' && t.mode === 'effect' ? (
        <div className="field">
          <span>效果</span>
          <div className="tr-grid">
            {TYPES.map((x) => (
              <button
                key={x.v}
                className={`btn-mini ${effect.type === x.v ? 'on' : ''}`}
                onClick={() => setEffect({ type: x.v })}
              >
                {x.label}
              </button>
            ))}
          </div>
          {effect.type !== 'dissolve' ? (
            <div className="tr-grid">
              {DIRS.map((d) => (
                <button
                  key={d.v}
                  className={`btn-mini ${(effect.dir || 'left') === d.v ? 'on' : ''}`}
                  onClick={() => setEffect({ dir: d.v })}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
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
      ) : null}

      {relation === 'transition' && t.mode === 'generated' ? (
        <div className="field">
          <span>生成转场</span>

          <div className="vp-panel tr-vp">
            <div className="vp-head">
              <button type="button" className="vp-toggle" onClick={() => setPreviewOpen((v) => !v)}>
                {previewOpen ? '▾' : '▸'} 本次转场出片
              </button>
              <span className={`vp-badge ${overrideOn ? 'manual' : 'auto'}`}>
                {overrideOn ? '已手改全文' : '自动拼装'}
              </span>
            </div>

            {previewOpen ? (
              <>
                <div className="vp-summary">
                  {preview.bridging === 'morph' ? '首尾直变' : '关键帧首帧'} · 成片 {preview.seconds}s · 请求{' '}
                  {preview.requestSeconds}s
                  {preview.trimTo ? ` · 裁到 ${preview.trimTo.toFixed(1)}s` : ''}
                  {preview.modelLabel ? ` · ${preview.modelLabel}` : ' · 未选出片模型'}
                </div>

                <div className="tr-note">{preview.audio.label} — {preview.audio.detail}</div>

                <ul className="vp-refs">
                  {preview.attachments.map((a) => (
                    <li key={`${a.role}-${a.label}`}>
                      <b>{a.label}</b>
                      <span>{a.purpose}</span>
                    </li>
                  ))}
                  {preview.attachments.length === 0 ? (
                    <li>
                      <b>参考帧</b>
                      <span>尚未抽取边界</span>
                    </li>
                  ) : null}
                  <li>
                    <b>音频参考</b>
                    <span>不提交（转场渠道限制）</span>
                  </li>
                </ul>

                {preview.attachments.map((a) => (
                  <div key={`edit-${a.role}`} className="tr-boundary-edit">
                    {a.url ? <img src={a.url} alt="" /> : null}
                    <input
                      type="text"
                      value={a.role === 'first_frame' ? g.boundary?.out ?? '' : g.boundary?.in ?? ''}
                      placeholder="本地路径，如 /generated/… 或 /videos/…"
                      onChange={(e) => setBoundaryUrl(a.role === 'first_frame' ? 'out' : 'in', e.target.value)}
                    />
                  </div>
                ))}

                {preview.blocking.map((msg) => (
                  <div className="gen-error vp-issue" key={msg}>
                    {msg}
                  </div>
                ))}
                {preview.warnings.map((msg) => (
                  <div className="gen-warn vp-issue" key={msg}>
                    {msg}
                  </div>
                ))}

                <label className="tr-cap-block">画面与过渡</label>
                <textarea
                  className="tr-prompt"
                  value={g.prompt}
                  placeholder="环境、运动、人物衔接…留空则从上/下镜提示词推导"
                  onChange={(e) => setGenerated({ prompt: e.target.value })}
                  rows={3}
                />

                <label className="tr-cap-block">声音描述（写入提示词，非参考音频）</label>
                <textarea
                  className="tr-prompt"
                  value={g.soundPrompt ?? ''}
                  placeholder="例：雨声由无到有，雷声远处滚过，环境底噪加大…"
                  onChange={(e) => setGenerated({ soundPrompt: e.target.value })}
                  rows={2}
                />

                <label className="tr-cap-block">最终发送正文</label>
                <textarea
                  className="tr-prompt tr-prompt-mono"
                  value={overrideOn ? g.videoPromptOverride ?? '' : preview.prompt}
                  readOnly={!overrideOn}
                  onChange={(e) => setGenerated({ videoPromptOverride: e.target.value })}
                  rows={6}
                />
                <div className="tr-row">
                  <button
                    type="button"
                    className={`btn-mini ${overrideOn ? 'on' : ''}`}
                    onClick={() =>
                      setGenerated({
                        videoPromptOverride: overrideOn ? undefined : preview.prompt,
                      })
                    }
                  >
                    {overrideOn ? '恢复自动拼装' : '手改全文'}
                  </button>
                  {overrideOn ? (
                    <button
                      type="button"
                      className="btn-mini"
                      onClick={() => setGenerated({ videoPromptOverride: autoPrompt })}
                    >
                      用当前字段重填
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="tr-row">
            <button type="button" className="btn" onClick={() => onRefreshBoundary(edge.id)} title="从两镜成片或静帧重新抽取边界">
              刷新边界帧
            </button>
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
          <div className="tr-note">约 ¥{money(estCost)}</div>

          <div className="tr-row">
            <button
              className="btn primary"
              onClick={() => onGenerateVideo(edge.id)}
              disabled={videoState === 'running' || preview.blocking.length > 0}
              title="提交上方「最终发送正文」与参考首尾帧"
            >
              {videoState === 'running' ? '生成中…' : g.video?.url ? '重新生成视频' : '生成转场视频'}
            </button>
          </div>
          {g.video?.error ? <div className="gen-error">{g.video.error}</div> : null}
          {stale ? <div className="tr-warn">出片条件已变，建议重生成转场视频。</div> : null}
          {g.video?.url ? (
            <video className="tr-video" src={g.video.url} muted loop playsInline controls />
          ) : null}
        </div>
      ) : null}

      <div className="tr-foot">
        <span className={`tr-delta ${delta < 0 ? 'neg' : delta > 0 ? 'pos' : ''}`}>成片 {deltaText}</span>
        <span className="tr-note">
          {effectLabel(effect)} ·{' '}
          {t.mode === 'generated' && g.video?.url
            ? `生成 ${join.mode === 'generated' ? join.seconds.toFixed(1) : '—'}s`
            : `重叠 ${clamped.toFixed(1)}s`}
        </span>
      </div>
      {projectName ? <div className="tr-note">保存到项目：{projectName}</div> : null}
    </aside>
  )
}
