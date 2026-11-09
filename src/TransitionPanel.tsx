import { useMemo, useState } from 'react'
import { type AppSettings, type Cap, type ModelEntry } from './api'
import type { CharacterSheet } from './characters'
import type { ShotEdgeType, ShotNodeType } from './data'
import type { Pricing } from './pricing'
import { money, videoCost } from './pricing'
import type { Relation, ShotData, TransitionEffect, TransitionOut } from './types'
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
  OMIT_REASON_LABELS,
  transitionPreviewToPromptPanelModel,
  transitionRefCandidates,
  transitionDialogueText,
  transitionRequestSeconds,
  transitionStyleRefTokens,
} from './transitionGen'
import { audioRefCapabilitiesFor } from './nativeAudio'
import OutgoingReferencePickerModal from './OutgoingReferencePickerModal'
import OutgoingVideoPromptPanel from './OutgoingVideoPromptPanel'
import { PRESET_CATEGORY_LABEL, TRANSITION_PRESETS, type TransitionPresetCategory } from './transitionPresets'
import { TransitionNativeAudioBlock, VideoOutgoingModelRow } from './VideoOutgoingWorkbench'

const PRESET_ORDER: TransitionPresetCategory[] = ['classic', 'rhythm', 'geometry', 'motion']

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
  onRefreshBoundary: (edgeId: string) => void
  onGenerateVideo: (edgeId: string) => void
  onCancelVideo: (edgeId: string) => void
  onFocusShot: (nodeId: string) => void
  onPick: (cap: Cap, key: string) => void
  onVidResChange: (v: '480p' | '720p') => void
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
  onRefreshBoundary,
  onGenerateVideo,
  onCancelVideo,
  onFocusShot,
  onPick,
  onVidResChange,
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
  const styleTokens = useMemo(
    () => transitionStyleRefTokens(source, target, nodes, characters, missingMedia, g),
    [source, target, nodes, characters, missingMedia, g],
  )
  const fingerprint = transitionFingerprint(source.data, target.data, g, effect, styleTokens)
  const join = relation === 'transition' ? resolveJoin(t, aDur, bDur, fingerprint) : { mode: 'cut' as const }
  const stale = Boolean(g.video?.url && t.meta?.fingerprint && t.meta.fingerprint !== fingerprint)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [continuityOpen, setContinuityOpen] = useState(false)
  const [refPickerOpen, setRefPickerOpen] = useState(false)
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

  const videoKey = pick.video || settings?.defaults?.video || ''
  const entry: ModelEntry | undefined = settings?.models.find((m) => m.key === videoKey)
  const videoProvider = settings?.providers.find((p) => p.id === entry?.provider)
  const modelForPreview = entry
    ? { ...entry, providerKind: videoProvider?.kind, features: entry.features }
    : null
  const supportsLast = modelSupportsLastFrame(entry)
  const req = transitionRequestSeconds(g.targetSeconds, entry?.model, supportsLast, {
    nativeAudio: g.audioMode === 'native',
  })
  const estCost = videoCost(price, req.seconds, vidRes)
  const audioCaps = useMemo(
    () =>
      audioRefCapabilitiesFor({
        providerKind: videoProvider?.kind,
        model: entry?.model,
        audioOut: entry?.features?.audioOut,
      }),
    [videoProvider, entry],
  )
  const nativeAudioData = useMemo((): ShotData => {
    return {
      no: '',
      seconds: req.seconds,
      size: '中景',
      move: '固定',
      prompt: '',
      dialogue: transitionDialogueText(source, target),
      performance: [...(source.data.performance ?? []), ...(target.data.performance ?? [])],
      refIds: [],
      marks: [],
      audioMode: g.audioMode,
      audioRef: g.audioRef,
      audioMeta: g.audioMeta,
    }
  }, [source, target, g, req.seconds])

  const preview = useMemo(
    () =>
      buildTransitionVideoPreview({
        source,
        target,
        generated: g,
        model: modelForPreview,
        nodes,
        characters,
        missingMedia,
      }),
    [source, target, g, modelForPreview, nodes, characters, missingMedia],
  )

  const refCandidates = useMemo(
    () => transitionRefCandidates(source, target, nodes, characters, missingMedia),
    [source, target, nodes, characters, missingMedia],
  )
  const dedicatedRefTokens = useMemo(() => new Set(g.refIds ?? []), [g.refIds])
  const assetPickCandidates = useMemo(
    () => refCandidates.filter((c) => c.source === 'asset'),
    [refCandidates],
  )
  const charPickCandidates = useMemo(
    () => refCandidates.filter((c) => c.source === 'character'),
    [refCandidates],
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

  const excludeRef = (token: string) => {
    setGenerated({
      excludeRefIds: [...new Set([...(g.excludeRefIds ?? []), token])],
    })
  }

  const restoreRef = (token: string) => {
    setGenerated({
      excludeRefIds: (g.excludeRefIds ?? []).filter((t) => t !== token),
    })
  }

  const removeAddedRef = (token: string) => {
    setGenerated({ refIds: (g.refIds ?? []).filter((t) => t !== token) })
  }

  const toggleDedicatedRef = (token: string) => {
    const cur = g.refIds ?? []
    if (cur.includes(token)) removeAddedRef(token)
    else setGenerated({ refIds: [...new Set([...cur, token])] })
  }

  const omitBanner =
    preview.styleRefs.length > 0 && preview.submittedStyleCount === 0
      ? OMIT_REASON_LABELS[preview.styleRefs[0]?.omittedReason ?? ''] ?? '风格参考图本次不提交'
      : ''

  const delta =
    join.mode === 'effect'
      ? -join.seconds
      : join.mode === 'generated'
        ? join.seconds - generatedFade(aDur, join.seconds) - generatedFade(join.seconds, bDur)
        : 0
  const deltaText = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}s`
  const clamped = clampEffectSeconds(effect.seconds, aDur, bDur)
  const videoState = g.video?.state ?? 'idle'
  const hasOverride = preview.promptSource === 'override'
  const boundaryBlocking = preview.blocking.some((m) => m.code === 'transition-boundary-missing')
  const panelModel = useMemo(() => transitionPreviewToPromptPanelModel(preview, vidRes), [preview, vidRes])
  const effectivePrompt = useMemo(
    () => ({
      text: preview.prompt,
      source: preview.promptSource,
      stale: preview.promptStale,
    }),
    [preview.prompt, preview.promptSource, preview.promptStale],
  )
  const videoMeta =
    g.video?.videoMeta && g.video.videoMeta.url === g.video.url ? g.video.videoMeta : null
  const videoReason = preview.blocking[0]?.message ?? ''

  const showGeneratedFoot = relation === 'transition' && t.mode === 'generated'

  const manualRefCount = dedicatedRefTokens.size
  const boundaryReady = Boolean(g.boundary?.out && g.boundary?.in)

  return (
  <>
    <OutgoingReferencePickerModal
      open={refPickerOpen}
      onClose={() => setRefPickerOpen(false)}
      title={`转场参考 · ${source.data.no} → ${target.data.no}`}
      boundaryRows={preview.attachments
        .filter((a) => a.role === 'first_frame' || a.role === 'last_frame')
        .map((a) => ({
          role: a.role,
          label: a.label,
          purpose: a.purpose,
        }))}
      boundaryOut={g.boundary?.out ?? ''}
      boundaryIn={g.boundary?.in ?? ''}
      onBoundaryChange={setBoundaryUrl}
      onRefreshBoundary={() => onRefreshBoundary(edge.id)}
      onFocusSourceShot={() => onFocusShot(source.id)}
      onFocusTargetShot={() => onFocusShot(target.id)}
      charItems={charPickCandidates.map((c) => ({
        token: c.token,
        label: c.label,
        url: c.url,
        source: 'character' as const,
      }))}
      assetItems={assetPickCandidates.map((c) => ({
        token: c.token,
        label: c.label,
        url: c.url,
        source: 'asset' as const,
      }))}
      selectedTokens={dedicatedRefTokens}
      onToggleToken={toggleDedicatedRef}
    />
    <aside className={`inspector tr-panel${showGeneratedFoot ? ' tr-panel--foot' : ''}`}>
      <header className="panel-head">
        <b>转场</b>
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
          <span>效果预设</span>
          {presetGroups.map((group) => (
            <div key={group.cat} className="tr-preset-group">
              <span className="tr-preset-cat">{group.label}</span>
              <div className="tr-grid">
                {group.items.map((p) => (
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
          ))}
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
        <>
          <label className="field tr-inline tr-target-sec">
            <span>成片时长</span>
            <input
              type="number"
              min={0.8}
              max={3}
              step={0.1}
              value={g.targetSeconds}
              onChange={(e) =>
                setGenerated({ targetSeconds: Number(e.target.value) || DEFAULT_GENERATED_SECONDS })
              }
            />
            <span className="tr-unit">秒</span>
            <span className="tr-note">
              时间轴 {deltaText}
              {t.mode === 'generated' && g.video?.url
                ? ` · 生成段 ${join.mode === 'generated' ? join.seconds.toFixed(1) : '—'}s`
                : ''}
            </span>
          </label>

          <label className="field">
            <span>
              画面与过渡
              <i className="hint-inline" title="写入转场提示词；留空则从上/下镜推导">
                Seedance
              </i>
            </span>
            <textarea
              className="tr-prompt"
              value={g.prompt}
              placeholder="环境、运动、人物衔接…留空则从上/下镜提示词推导"
              onChange={(e) => setGenerated({ prompt: e.target.value })}
              rows={3}
            />
          </label>
          {hasOverride ? (
            <div className="gen-note vp-field-note">
              当前使用手改提示词，本字段的修改不会影响出片；要重新接管请在上方面板点「重新拼装」。
            </div>
          ) : null}
          <label className="field">
            <span>声音描述</span>
            <textarea
              className="tr-prompt"
              value={g.soundPrompt ?? ''}
              placeholder="例：雨声由无到有，雷声远处滚过，环境底噪加大…"
              onChange={(e) => setGenerated({ soundPrompt: e.target.value })}
              rows={2}
            />
            <em className="st-hint">写入提示词，非音色参考（转场与原生音频互斥）。</em>
          </label>
          {hasOverride ? (
            <div className="gen-note vp-field-note">
              当前使用手改提示词，声音描述修改不会影响出片；要重新接管请在上方面板点「重新拼装」。
            </div>
          ) : null}

          <div className="gen-box vid-box tr-vid-box">
            <div className="gen-head">
              <span>出片设置</span>
              <span className="gen-cost">
                Seedance · 约 ¥{money(estCost)} / 次
              </span>
            </div>
            {g.video?.url ? (
              <div className="si-video-preview">
                <video src={g.video.url} muted loop autoPlay playsInline controls preload="metadata" />
                <a
                  className="btn-ghost vid-save"
                  href={g.video.url}
                  download={`transition-${source.data.shotId || source.data.no}-${target.data.shotId || target.data.no}.mp4`}
                >
                  保存成片
                </a>
              </div>
            ) : null}

            <VideoOutgoingModelRow
              settings={settings}
              pick={pick}
              onPick={onPick}
              vidRes={vidRes}
              onVidResChange={onVidResChange}
            />
            <div className="gen-controls">
              <span className="vid-len">
                {Math.min(12, Math.max(2, Math.round(preview.seconds)))}s ·{' '}
                {preview.bridging === 'morph' ? '首尾直变' : '关键帧首帧'}
                {preview.trimTo ? ` · 裁到 ${preview.trimTo.toFixed(1)}s` : ''}
              </span>
            </div>

            <TransitionNativeAudioBlock
              data={nativeAudioData}
              characters={characters}
              caps={audioCaps}
              modelKey={videoKey}
              onPatch={(patch) =>
                setGenerated({
                  audioMode: patch.audioMode,
                  audioRef: patch.audioRef,
                  audioMeta: patch.audioMeta,
                })
              }
            />

            <p className="vid-note">
              连线参考图走<b>多参考图模式</b>（reference_image）；连线了视频素材则同时送
              <b> reference_video</b>（首期只取第一条）。未连线参考图时仍可用首尾直变。时长取转场成片时长（约
              0.8~3 秒），按 tokens 计费。
            </p>
            {omitBanner ? <p className="vid-refs">{omitBanner}</p> : null}

            <OutgoingVideoPromptPanel
              summary={panelModel.summaryLine}
              refs={preview.refs}
              refPrefix={panelModel.refPrefix}
              video={preview.video}
              omitted={preview.omitted}
              omittedVideos={preview.omittedVideos}
              blocking={preview.blocking}
              warnings={preview.warnings}
              effective={effectivePrompt}
              staleMessage="参考、边界或分层字段已变化，当前正文是保存时的旧快照。"
              onSaveOverride={(text) =>
                setGenerated({
                  videoPromptOverride: {
                    text,
                    fingerprint: preview.promptFingerprint,
                    createdAt: new Date().toISOString(),
                  },
                })
              }
              onClearOverride={() => setGenerated({ videoPromptOverride: undefined })}
              onRebuildOverride={() =>
                setGenerated({
                  videoPromptOverride: {
                    text: autoPrompt,
                    fingerprint: preview.promptFingerprint,
                    createdAt: new Date().toISOString(),
                  },
                })
              }
              videoMeta={videoMeta}
              hasVideoUrl={Boolean(g.video?.url)}
              advancedSlot={
                <details
                  className="tr-advanced"
                  open={advancedOpen}
                  onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
                >
                  <summary>转场与边界</summary>
                  <p className="tr-note">
                    不自动继承镜头连线；画布拖线仍可写入本条转场（先点接缝边）。集中选择请用下方按钮。
                  </p>
                  <div className="tr-row tr-ref-launch">
                    <button type="button" className="btn" onClick={() => setRefPickerOpen(true)}>
                      选择出片参考…
                    </button>
                    <span className="tr-ref-summary">
                      {boundaryReady ? '首尾帧已设' : '首尾帧未齐'}
                      {' · '}
                      手动 {manualRefCount} 项
                    </span>
                  </div>
                  {boundaryBlocking ? (
                    <div className="gen-error">缺少上一镜尾帧或下一镜首帧，请在弹窗「首尾帧」中填写或刷新。</div>
                  ) : null}
                  <ul className="vp-refs tr-ref-actions">
                    {preview.styleRefs.map((r) => (
                      <li key={r.token} className={r.submitted ? '' : 'omitted'}>
                        {r.label}
                        <span>
                          {r.submitted ? '将提交' : r.omittedReason ? OMIT_REASON_LABELS[r.omittedReason] : '未提交'}
                        </span>
                        {r.kind === 'added' ? (
                          <button type="button" className="btn-mini" onClick={() => removeAddedRef(r.token)}>
                            移除
                          </button>
                        ) : (
                          <button type="button" className="btn-mini" onClick={() => excludeRef(r.token)}>
                            排除
                          </button>
                        )}
                      </li>
                    ))}
                    {(g.excludeRefIds ?? []).map((token) => {
                      const hit = refCandidates.find((c) => c.token === token)
                      if (!hit) return null
                      return (
                        <li className="omitted" key={`ex-${token}`}>
                          <b>已排除</b> {hit.label}
                          <button type="button" className="btn-mini" onClick={() => restoreRef(token)}>
                            恢复
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {!hasOverride && preview.continuityPreview.trim() ? (
                    <div className="tr-continuity">
                      <button
                        type="button"
                        className="vp-toggle tr-continuity-toggle"
                        onClick={() => setContinuityOpen((v) => !v)}
                      >
                        {continuityOpen ? '▾' : '▸'} 自动衔接约束（只读，已写入自动正文）
                      </button>
                      {continuityOpen ? (
                        <pre className="vp-text tr-continuity-text">{preview.continuityPreview.trim()}</pre>
                      ) : null}
                    </div>
                  ) : null}
                </details>
              }
            />

            {g.video?.error ? <div className="gen-error">{g.video.error}</div> : null}
            {stale ? <div className="tr-warn">出片条件已变，建议重出视频。</div> : null}
          </div>
        </>
      ) : null}

      {relation !== 'transition' || t.mode !== 'generated' ? (
        <div className="tr-note">
          {effectLabel(effect)} · 重叠 {clamped.toFixed(1)}s · 成片 {deltaText}
        </div>
      ) : null}
      {projectName ? <div className="tr-note">保存到项目：{projectName}</div> : null}
      </div>

      {showGeneratedFoot ? (
        <footer className="si-foot" data-shot-footer>
          <button
            type="button"
            className="btn primary block"
            onClick={() => (videoState === 'running' ? onCancelVideo(edge.id) : onGenerateVideo(edge.id))}
            disabled={videoState !== 'running' && preview.blocking.length > 0}
            title={
              videoState === 'running'
                ? '取消本次转场出片（本地停止等待，远端任务可能仍在跑）'
                : undefined
            }
          >
            {videoState === 'running' ? '取消生成' : g.video?.url ? '重出视频' : '生成视频'}
          </button>
          <div className="si-foot-note">
            {g.video?.error && !preview.blocking.length ? (
              <span className="si-foot-error">{g.video.error}</span>
            ) : videoReason ? (
              videoReason
            ) : videoState === 'running' ? (
              '出片中…'
            ) : (
              `约 ¥${money(estCost)} / 次`
            )}
          </div>
        </footer>
      ) : null}
    </aside>
  </>
  )
}
