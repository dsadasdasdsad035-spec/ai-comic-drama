import type { ShotData } from './types'
import {
  CAMERA_LEXICON_ATTRIBUTION,
  getCameraLexiconEntry,
  listCameraLexicon,
  resolveShotLexiconRef,
} from './cameraLexicon'
import { importCameraLexiconPreset } from './api'
import { CANDIDATE_COUNTS, effectiveSeconds, MOVES, RATIOS, SHOT_SIZES } from './types'
import { hasNeighborReference } from './shotReferences'
import { imageCost, money, videoCost, type Pricing } from './pricing'
import type { AppSettings, Cap, Stage } from './api'
import { listVideoFiles, type VideoFile } from './api'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AssetKind, AssetNodeType, ShotNodeType } from './data'
import SubtitleAssetPanel from './SubtitleAssetPanel'
import { resolveShotsFromSourceIds, type ShotPromptField } from './assetShotPromptRef'
import MusicAssetPanel from './MusicAssetPanel'
import { isMusicAudioModel } from './assetCardGeneration'
import type { CharacterSheet } from './characters'
import { CapModelSelect, type StagePick } from './ModelSelect'
import { IMAGE_CAPS } from './modelCaps'
import MediaPicker from './MediaPicker'
import { fetchStockMeta } from './stock/api'
import type { StockImportMeta } from './stock/types'
import { pickKind, pickTitle, type PickItem } from './mediaPick'
import { ACCEPT_ATTR, uploadImageFile } from './mediaUpload'
import { CharacterImageCropModal } from './CharacterImageCropModal'
import type { MaterialCropPlan } from './imageMaterialCrop'
import { materialUploadGateFromFile, releaseMaterialCropPlan } from './materialImageGate'
import { VideoOutgoingModelRow } from './VideoOutgoingWorkbench'
import OutgoingVideoPromptPanel from './OutgoingVideoPromptPanel'
import Fold from './Fold'
import GenErrorNote from './GenErrorNote'
import { parseUpstreamTaskIdFromError } from './videoRecover'
import { effectiveVideoPrompt, isVideoPromptHandEdited, type ShotVideoRequest } from './videoPrompt'
import { requestSecondsNote } from './videoSeconds'
import { parseDialogue, reconcileDialogueDelivery } from './prompts'
import { visibleShotTabsForProdKind } from './canvasProdMode'
import {
  clampInspectorWidth,
  coerceShotTab,
  DEFAULT_INSPECTOR_WIDTH,
  loadInspectorPrefs,
  saveInspectorPrefs,
  type CollapsibleSection,
  type InspectorPrefs,
  type ShotInspectorTab,
} from './inspectorLayout'

/** 素材卡编辑面板：类型 / 标题 / 图片或视频地址 */
function AssetPanel({
  node,
  patch,
  onDelete,
  projectName,
  settings,
  pick,
  onPick,
  onGenerate,
  onGenerateAudio,
  shotNodes = [],
}: {
  node: AssetNodeType
  patch: (id: string, p: Record<string, unknown>) => void
  onDelete: (id: string) => void
  projectName: string
  settings: AppSettings | null
  pick: Partial<Record<Cap, string>>
  onPick: (cap: Cap, key: string) => void
  onGenerate?: (id: string) => void
  onGenerateAudio?: (id: string) => void
  shotNodes?: ShotNodeType[]
}) {
  const d = node.data
  const [pickerOpen, setPickerOpen] = useState(false)
  const [stockMeta, setStockMeta] = useState<StockImportMeta | null>(null)
  const [metaMissing, setMetaMissing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [cropPending, setCropPending] = useState<MaterialCropPlan | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const set = (p: Partial<{ title: string; kind: AssetKind; url: string; prompt?: string }>) => patch(node.id, p as never)
  /**
   * 本地上传：保存成功才写地址。素材卡会落库，所以不能像参考图那样先塞 dataURL。
   * 类型沿用既有规则（pickKind）：场景/道具卡保持原类型，其余回落图片。
   */
  const uploadFromDiskFile = async (file: File) => {
    setUploadError('')
    setUploading(true)
    try {
      const url = await uploadImageFile(file, { project: projectName, prefix: `asset-${d.kind || 'image'}` })
      const kind = pickKind(
        { key: url, source: 'project-image', kind: 'image', mediaType: 'image', title: '', url },
        d.kind,
      )
      set({ url, kind })
    } catch (e) {
      setUploadError((e as Error).message || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const uploadFromDisk = async (file: File) => {
    const gate = await materialUploadGateFromFile(file)
    if (!gate.ok) {
      setUploadError(gate.reason)
      return
    }
    if (gate.mode === 'crop') {
      setCropPending(gate.plan)
      return
    }
    await uploadFromDiskFile(gate.file)
  }

  const confirmCropUpload = async () => {
    if (!cropPending) return
    const file = cropPending.croppedFile
    URL.revokeObjectURL(cropPending.previewUrl)
    setCropPending(null)
    setCropBusy(true)
    try {
      await uploadFromDiskFile(file)
    } finally {
      setCropBusy(false)
    }
  }

  /**
   * 选择确认必须读「打开时的最新值」：选择器是条件渲染，闭包会拿到
   * 打开那一刻的 d；否则「先改标题再选素材」会被旧标题判空而覆盖用户输入。
   */
  const latestRef = useRef(d)
  latestRef.current = d
  const confirmPick = (item: PickItem) => {
    const cur = latestRef.current
    set({
      url: item.url,
      kind: pickKind(item, cur.kind),
      title: pickTitle(item, cur.title),
    })
    setPickerOpen(false)
  }
  // 来源元数据在侧表里：只有在线导入过的素材才有，普通素材保持无该区块
  useEffect(() => {
    let alive = true
    const url = String(d.url || '')
    setStockMeta(null)
    setMetaMissing(false)
    if (!url.startsWith('/project-assets/') || !projectName) return () => { alive = false }
    fetchStockMeta(projectName, url)
      .then((meta) => {
        if (alive) setStockMeta(meta)
      })
      .catch(() => {
        if (alive) setMetaMissing(true)
      })
    return () => {
      alive = false
    }
  }, [d.url, projectName])

  const sourceName = (url?: string) => {
    if (!url) return ''
    const part = url.split(/[?#]/)[0].split('/').pop() || url
    try {
      return decodeURIComponent(part)
    } catch {
      return part
    }
  }
  const KINDS: { v: AssetKind; label: string }[] = [
    { v: 'scene', label: '场景图' },
    { v: 'prop', label: '道具图' },
    { v: 'image', label: '参考图' },
    { v: 'video', label: '视频' },
    { v: 'audio', label: '音频' },
    { v: 'expression-sheet', label: '表情总图' },
  ]
  return (
    <aside className="inspector">
      <header className="panel-head">
        <b>素材卡</b>
        <span className="panel-sid">{node.id.slice(0, 14)}</span>
      </header>
      <div className="field">
        <span>类型</span>
        <div className="refx-kinds">
          {KINDS.map((k) => (
            <button
              key={k.v}
              className={`btn-mini ${d.kind === k.v ? 'on' : ''}`}
              onClick={() => set({ kind: k.v })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>标题</span>
        <input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      {(d.kind === 'image' || d.kind === 'audio') && (
        <label className="field">
          <span>生成提示词</span>
          <textarea
            className="prompt-box"
            value={d.prompt ?? ''}
            onChange={(e) => set({ prompt: e.target.value })}
            rows={4}
            placeholder={d.kind === 'audio' ? '要写进 TTS 的文本（旁白/对白）' : 'Seedream 画面描述'}
          />
          {(d.refIds?.length ?? 0) > 0 && d.kind === 'image' ? (
            <p className="st-hint">已连线 {d.refIds!.length} 项参考，出图时会带上（不含相邻镜头）。</p>
          ) : null}
        </label>
      )}
      {d.kind === 'audio' ? (
        <>
          <div className="field">
            <span>分镜引用字段</span>
            <select
              value={(d as { promptSource?: ShotPromptField }).promptSource || 'dialogue'}
              onChange={(e) => patch(node.id, { promptSource: e.target.value } as never)}
            >
              <option value="dialogue">台词 dialogue</option>
              <option value="video_prompt">出片提示词</option>
            </select>
          </div>
          <div className="field">
            <span>已引用分镜</span>
            <span className="st-hint">
              {(() => {
                const linked = resolveShotsFromSourceIds(shotNodes, (d as { sourceShotIds?: string[] }).sourceShotIds ?? [])
                return linked.length
                  ? linked.map((s) => s.no || s.id).join('、')
                  : '尚无（从分镜拖到本卡）'
              })()}
            </span>
          </div>
        </>
      ) : null}
      <div className="field">
        <span>{d.kind === 'video' ? '视频来源' : d.kind === 'audio' ? '音频来源' : '图片来源'}</span>
        <button
          type="button"
          className="asset-source"
          onClick={() => setPickerOpen(true)}
          title={d.url || '打开素材选择器'}
        >
          <span className="asset-source-thumb">
            {d.url ? (
              d.kind === 'video' ? (
                <video src={d.url} muted playsInline preload="metadata" />
              ) : d.kind === 'audio' ? (
                <span className="asset-source-audio">♪</span>
              ) : (
                <img src={d.url} alt="" />
              )
            ) : (
              <span className="asset-source-empty">＋</span>
            )}
          </span>
          <span className="asset-source-copy">
            <b>{d.url ? d.title || '已选素材' : '选择素材'}</b>
            <small>{d.url ? sourceName(d.url) : '缩略图预览 · 场景 / 道具 / 图片 / 视频 / 音频'}</small>
          </span>
          <span className="asset-source-action">选择素材</span>
        </button>
        <div className="asset-upload-row">
          <button
            type="button"
            className="btn-mini ghost"
            disabled={uploading}
            onClick={() => uploadRef.current?.click()}
            title="上传本地图片（png / jpeg / webp）作为本文素材"
          >
            {uploading ? '上传中…' : '上传图片'}
          </button>
          {uploadError ? <span className="asset-upload-error">{uploadError}</span> : null}
        </div>
        <input
          ref={uploadRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void uploadFromDisk(file)
            e.target.value = ''
          }}
        />
      </div>
      {stockMeta ? (
        <div className="field" data-stock-meta>
          <span>在线来源</span>
          <div className="asset-stock-meta">
            <div className="asset-stock-row">
              <b>{stockMeta.provider}</b>
              <span>{stockMeta.author || '未署名'}</span>
            </div>
            <div className="asset-stock-row">
              <span>{stockMeta.license || '未标注许可'}</span>
              {stockMeta.sourceUrl ? (
                <a href={stockMeta.sourceUrl} target="_blank" rel="noreferrer">
                  来源页面
                </a>
              ) : null}
            </div>
            {stockMeta.attribution ? <code>{stockMeta.attribution}</code> : null}
          </div>
        </div>
      ) : metaMissing ? (
        <div className="field">
          <span>在线来源</span>
          <p className="st-hint">来源信息读取失败；素材本身不受影响</p>
        </div>
      ) : null}
      <div className="field">
        <span>预览</span>
        {d.url ? (
          d.kind === 'video' ? (
            <video src={d.url} muted loop autoPlay playsInline className="asset-preview" />
          ) : d.kind === 'audio' ? (
            <div className="asset-preview asset-preview-audio">
              <audio src={d.url} controls preload="metadata" />
              <span className="st-hint">连线到出片镜时作为音色参考；不单独成为时间线音轨</span>
            </div>
          ) : (
            <img src={d.url} alt={d.title} className="asset-preview" />
          )
        ) : (
          <div className="refx-empty">还没设置地址</div>
        )}
      </div>
      <p className="st-hint">
        图片/音频卡：填写提示词后在此生成。
        {d.kind === 'image' ? (
          <>
            <b>出图参考</b>：从角色或其它有图素材<b>拖到本卡</b>。
            <b>被分镜引用</b>：右键本卡点选分镜，或从本卡拖到出片镜。
          </>
        ) : (
          <>
            连到<b>出片镜</b>时，音频进音频槽；图片素材请用图片卡。
          </>
        )}
      </p>
      {d.kind === 'image' ? (
        <CapModelSelect
          cap="image"
          caps={IMAGE_CAPS}
          label="生图模型"
          settings={settings}
          value={pick.image}
          onChange={(key) => onPick('image', key)}
        />
      ) : null}
      {d.kind === 'audio' ? (
        <CapModelSelect
          cap="audio"
          label="配音模型"
          settings={settings}
          value={pick.audio}
          onChange={(key) => onPick('audio', key)}
          filterEntry={(m) => !isMusicAudioModel(m)}
        />
      ) : null}
      {d.kind === 'image' && onGenerate ? (
        <button
          type="button"
          className="gen-go"
          disabled={d.genState === 'running'}
          onClick={() => onGenerate(node.id)}
        >
          {d.genState === 'running' ? '出图中…' : '生成图片'}
        </button>
      ) : null}
      {d.kind === 'audio' && onGenerateAudio ? (
        <button
          type="button"
          className="gen-go"
          disabled={d.genState === 'running'}
          onClick={() => onGenerateAudio(node.id)}
        >
          {d.genState === 'running' ? '生成中…' : '生成配音'}
        </button>
      ) : null}
      {d.genError ? <p className="st-hint error-text">{d.genError}</p> : null}
      <button className="btn-ghost reset" onClick={() => onDelete(node.id)}>删除素材卡</button>
      {pickerOpen && (
        <MediaPicker
          projectName={projectName}
          currentUrl={d.url}
          currentKind={d.kind}
          onConfirm={confirmPick}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <CharacterImageCropModal
        open={Boolean(cropPending)}
        title="裁切素材图"
        plan={cropPending}
        busy={cropBusy || uploading}
        onConfirm={() => void confirmCropUpload()}
        onCancel={() => {
          releaseMaterialCropPlan(cropPending)
          setCropPending(null)
        }}
      />
    </aside>
  )
}

function ShotClipFrameActions({
  hasVideo,
  hasPrevShot,
  showLinkPrev,
  onPublishClipFrame,
  onLinkPrevShotTail,
}: {
  hasVideo: boolean
  hasPrevShot: boolean
  showLinkPrev: boolean
  onPublishClipFrame?: (role: 'head' | 'tail') => Promise<{ title: string; notice?: string }>
  onLinkPrevShotTail?: () => Promise<{ title: string; notice?: string }>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  if (!hasVideo || (!onPublishClipFrame && !onLinkPrevShotTail)) return null
  const run = async (fn: () => Promise<{ notice?: string } | void>) => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      const r = await fn()
      if (r && 'notice' in r && r.notice) setNote(r.notice)
    } catch (e) {
      setError((e as Error).message || String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="si-clip-frame-actions">
      <div className="si-clip-frame-btns">
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !onPublishClipFrame}
          onClick={() => void run(() => onPublishClipFrame!('head'))}
        >
          {busy ? '抽帧中…' : '抽首帧 → 素材卡'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || !onPublishClipFrame}
          onClick={() => void run(() => onPublishClipFrame!('tail'))}
        >
          {busy ? '抽帧中…' : '抽尾帧 → 素材卡'}
        </button>
        {showLinkPrev ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || !hasPrevShot || !onLinkPrevShotTail}
            title={!hasPrevShot ? '集内第一镜或没有上一镜' : undefined}
            onClick={() => void run(onLinkPrevShotTail!)}
          >
            引用上一镜尾帧
          </button>
        ) : null}
      </div>
      {error ? <GenErrorNote message={error} /> : null}
      {note ? <div className="gen-note vp-field-note">{note}</div> : null}
    </div>
  )
}

/** 槽位标题行：名字 + 计数 + 一行说明 */
function SlotHead({
  label,
  count,
  hint,
}: {
  label: string
  count?: number
  hint?: string
}) {
  return (
    <div className="si-slot-head">
      <b>{label}</b>
      {count != null ? <span className="si-slot-count">{count}</span> : null}
      {hint ? <em className="si-slot-hint">{hint}</em> : null}
    </div>
  )
}

const AUDIO_SOURCE_LABEL: Record<string, string> = {
  character: '角色音色',
  asset: '素材库',
  manual: '手工地址',
}

/**
 * 图片槽位：画布连线（角色/场景/道具/相邻镜/表情）+ 素材选择器 + 手工地址。
 *
 * 槽位条目就是请求里的 `reference_image` 集合，不截断张数。
 */
function ImageSlot({
  request,
  data,
  onPatch,
  projectName,
  onAddAsset,
}: {
  request: ShotVideoRequest | null
  data: ShotData
  onPatch: (p: Partial<ShotData>) => void
  projectName: string
  onAddAsset: (kind: 'image' | 'video' | 'audio', url: string, title: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const refs = request?.refs ?? []
  return (
    <section className="si-slot" data-slot="image">
      <SlotHead label="图片" count={refs.length} hint="连线 / 素材库 / 手工地址" />
      {refs.length ? (
        <ul className="si-slot-list">
          {refs.map((r) => (
            <li key={`${r.slot}-${r.index}-${r.url}`}>
              <img className="si-slot-thumb" src={r.url} alt="" loading="lazy" />
              <span className="si-slot-copy">
                <b>图{r.index}</b>
                <span>{r.label}</span>
                <em>{r.purpose}</em>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="refx-empty">还没有图片参考。右击画布卡片连线角色/场景/道具，或从下面添加。</p>
      )}
      {request?.omitted.length ? (
        <p className="gen-note">
          省略 {request.omitted.length} 项：{request.omitted.map((o) => o.label).join('、')}
        </p>
      ) : null}
      <div className="si-slot-actions">
        <button type="button" className="btn-mini" onClick={() => setPickerOpen(true)}>
          添加图片
        </button>
        <label className="chk si-slot-inline">
          <input
            type="checkbox"
            checked={Boolean(data.useExpressionRef)}
            onChange={(e) => onPatch({ useExpressionRef: e.target.checked })}
          />
          表情参考
        </label>
      </div>
      <ManualUrlAdd
        placeholder="图片 URL / /generated/xx.jpg，回车添加"
        onAdd={(v) => onPatch({ refExtras: [...(data.refExtras ?? []), v] })}
      />
      {(data.refExtras ?? []).length ? (
        <ul className="si-slot-extras">
          {data.refExtras!.map((r, i) => (
            <li key={`${r}-${i}`}>
              <img className="si-slot-thumb" src={r} alt="" />
              <code>{r}</code>
              <button
                type="button"
                className="btn-mini"
                title="移除"
                onClick={() => onPatch({ refExtras: (data.refExtras ?? []).filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {pickerOpen ? (
        <MediaPicker
          projectName={projectName}
          currentKind="image"
          accept={['image']}
          onConfirm={(item) => {
            setPickerOpen(false)
            onAddAsset('image', item.url, item.title || '图片素材')
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  )
}

/**
 * 视频槽位：连线视频素材 + 镜头语言库运镜参照 + 素材选择器。
 *
 * 首期只提交第一条，其余在槽位内列出被忽略原因。
 */
function VideoSlot({
  request,
  data,
  onPatch,
  projectName,
  onAddAsset,
}: {
  request: ShotVideoRequest | null
  data: ShotData
  onPatch: (p: Partial<ShotData>) => void
  projectName: string
  onAddAsset: (kind: 'image' | 'video' | 'audio', url: string, title: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const lexicon = useMemo(() => resolveShotLexiconRef(data), [data])
  const options = useMemo(() => listCameraLexicon({ limit: 132 }), [])

  const bindLexicon = async (key: string) => {
    if (!key) {
      onPatch({ lexiconRefKey: undefined, lexiconRefUrl: undefined, motionLexiconAsRef: false })
      return
    }
    setBusy(true)
    try {
      const r = await importCameraLexiconPreset(projectName, key)
      onPatch({ lexiconRefKey: key, lexiconRefUrl: r.url, motionLexiconAsRef: true })
    } finally {
      setBusy(false)
    }
  }

  const video = request?.video ?? null
  return (
    <section className="si-slot" data-slot="video">
      <SlotHead label="视频" count={video ? 1 : 0} hint="连线素材 / 运镜参照 / 素材库" />
      {video ? (
        <ul className="si-slot-list">
          <li>
            <video className="si-slot-thumb" src={video.url} muted playsInline preload="metadata" />
            <span className="si-slot-copy">
              <b>视频1</b>
              <span>{video.label}</span>
              <em>{video.purpose}</em>
            </span>
          </li>
        </ul>
      ) : (
        <p className="refx-empty">还没有视频参考。连线视频素材、选一条运镜参照，或从素材库添加。</p>
      )}
      {request?.omittedVideos.length ? (
        <p className="gen-note">
          {request.omittedVideos.map((o, i) => (
            <span key={`${o.label}-${i}`}>
              {o.label}：{o.reason}
            </span>
          ))}
        </p>
      ) : null}
      <div className="si-slot-actions">
        <button type="button" className="btn-mini" onClick={() => setPickerOpen(true)}>
          添加视频
        </button>
      </div>
      <label className="field si-slot-lexicon">
        <span>运镜参照</span>
        <select
          value={data.lexiconRefKey || lexicon?.key || ''}
          disabled={busy}
          onChange={(e) => void bindLexicon(e.target.value)}
        >
          <option value="">默认（随景别/运镜）</option>
          {options.map((e) => (
            <option key={e.key} value={e.key}>
              {e.cn} · {e.en}
            </option>
          ))}
        </select>
        {data.lexiconRefKey || lexicon ? (
          <label className="chk">
            <input
              type="checkbox"
              checked={Boolean(data.motionLexiconAsRef)}
              onChange={(e) => onPatch({ motionLexiconAsRef: e.target.checked })}
            />
            作为运镜 reference_video
          </label>
        ) : null}
      </label>
      {pickerOpen ? (
        <MediaPicker
          projectName={projectName}
          currentKind="video"
          accept={['video']}
          onConfirm={(item) => {
            setPickerOpen(false)
            onAddAsset('video', item.url, item.title || '视频素材')
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  )
}

/**
 * 音频槽位：音色参考，单条。
 *
 * 三级来源：显式选择（素材库 / 手工地址）→ 台词说话人自动推断 → 空。
 * 空槽位不代表静音——原生音轨由模型能力决定，仍会带 `generate_audio`。
 */
function AudioSlot({
  request,
  data,
  onPatch,
  projectName,
  onAddAsset,
}: {
  request: ShotVideoRequest | null
  data: ShotData
  onPatch: (p: Partial<ShotData>) => void
  projectName: string
  onAddAsset: (kind: 'image' | 'video' | 'audio', url: string, title: string) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const audio = request?.audio ?? null
  const source = data.audioRef?.source
  return (
    <section className="si-slot" data-slot="audio">
      <SlotHead label="音频" count={audio ? 1 : 0} hint="音色参考，单条" />
      {audio ? (
        <div className="si-slot-audio">
          <div className="si-slot-copy">
            <b>{audio.label}</b>
            {source ? <em>{AUDIO_SOURCE_LABEL[source] ?? source}</em> : null}
            <em>{audio.purpose}</em>
          </div>
          <audio src={audio.url} controls preload="metadata" />
        </div>
      ) : (
        <p className="refx-empty">
          没有音色参考：出片仍会带原生音轨，<b>声音由模型决定</b>。可以选一条音频锁定音色。
        </p>
      )}
      <div className="si-slot-actions">
        <button type="button" className="btn-mini" onClick={() => setPickerOpen(true)}>
          {audio ? '更换' : '选择音频'}
        </button>
        {data.audioRef ? (
          <button
            type="button"
            className="btn-mini"
            // 写 null 而不是 undefined：服务端 mergeShots 会跳过 undefined，清不掉已存的音色
            onClick={() => onPatch({ audioRef: null, audioMeta: undefined })}
          >
            移除
          </button>
        ) : null}
      </div>
      <ManualUrlAdd
        placeholder="音频 URL / /videos/x.mp3，回车添加"
        onAdd={(v) => onPatch({ audioRef: { url: v, source: 'manual' }, audioMeta: undefined })}
      />
      {pickerOpen ? (
        <MediaPicker
          projectName={projectName}
          currentKind="audio"
          currentUrl={data.audioRef?.url}
          accept={['audio']}
          onConfirm={(item) => {
            setPickerOpen(false)
            onPatch({
              audioRef: { url: item.url, label: item.title || '音频素材', source: 'asset' },
              audioMeta: undefined,
            })
            onAddAsset('audio', item.url, item.title || '音频素材')
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </section>
  )
}

/** 手工地址输入行：回车即加入 */
function ManualUrlAdd({
  placeholder,
  onAdd,
}: {
  placeholder: string
  onAdd: (url: string) => void
}) {
  return (
    <input
      className="refx-add-in si-slot-manual"
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        const v = (e.target as HTMLInputElement).value.trim()
        if (!v) return
        onAdd(v)
        ;(e.target as HTMLInputElement).value = ''
      }}
    />
  )
}

type Props = {
  node: ShotNodeType | null
  patch: (id: string, patch: Partial<ShotData>) => void
  onDelete: (id: string) => void
  onReset: () => void
  onGenerate: (id: string) => void
  onGenerateAssetAudio?: (id: string) => void
  onGenerateAssetMusic?: (id: string) => void
  onCancelGenerate: (id: string) => void
  ratio: string
  setRatio: (v: string) => void
  refMode: boolean
  setRefMode: (v: boolean) => void
  marksAsGuide: boolean
  setMarksAsGuide: (v: boolean) => void
  candCount: number
  setCandCount: (v: number) => void
  vidRes: '480p' | '720p'
  setVidRes: (v: '480p' | '720p') => void
  onGenerateVideo: (id: string) => void
  onRecoverVideo?: (id: string) => void
  projectAspect: string
  /** 设置页的渠道+模型表，用于生成时选模型 */
  settings: AppSettings | null
  /** 当前手动选的模型（键），空 = 用设置页默认 */
  pick: Partial<Record<Cap, string>>
  onPick: (cap: Cap, key: string) => void
  /** 计价单价（设置页可校准） */
  price: Pricing
  /** 当前项目名：素材卡挑素材要用 */
  projectName: string
  /** 角色卡：native 音色参考 */
  characters: CharacterSheet[]
  /** 选中镜头的出片请求预览；与生成请求共用同一个拼装器 */
  videoRequest: ShotVideoRequest | null
  /**
   * 解除某镜某字段的手改锁。服务端 handEdited 是并集（只增不减），
   * 必须走这条显式解锁通道，普通 patch 清标记会被合并逻辑吞掉。
   */
  onUnlockHandEdit?: (nodeId: string, fields: string[]) => void
  /** 槽位「添加」把素材直接建成画布素材卡并连线到本镜 */
  onAddAssetRef?: (shotNodeId: string, kind: 'image' | 'video' | 'audio', url: string, title: string) => void
  projectStyle: string
  stagePick: StagePick
  onPickStage: (stage: Stage, key: string) => void
  onAddAssetCard?: (input: { title: string; kind: string; url: string }) => void
  hasPrevShot?: boolean
  onPublishClipFrame?: (role: 'head' | 'tail') => Promise<{ title: string; notice?: string }>
  onLinkPrevShotTail?: () => Promise<{ title: string; notice?: string }>
  /** 当前集可见分镜节点（字幕/音频引用分镜文案） */
  shotNodes?: ShotNodeType[]
}

function ShotLexiconRefBlock({
  data,
  projectName,
  onPatch,
  onAddAssetCard,
}: {
  data: ShotData
  projectName: string
  onPatch: (p: Partial<ShotData>) => void
  onAddAssetCard?: (input: { title: string; kind: string; url: string }) => void
}) {
  const ref = useMemo(() => resolveShotLexiconRef(data), [data])
  const previewUrl = data.lexiconRefUrl || ref?.url || ''
  const [busy, setBusy] = useState(false)
  const options = useMemo(() => listCameraLexicon({ limit: 132 }), [])

  const bindKey = async (key: string) => {
    if (!key) {
      onPatch({ lexiconRefKey: undefined, lexiconRefUrl: undefined, motionLexiconAsRef: false })
      return
    }
    setBusy(true)
    try {
      const r = await importCameraLexiconPreset(projectName, key)
      onPatch({ lexiconRefKey: key, lexiconRefUrl: r.url, motionLexiconAsRef: true })
    } finally {
      setBusy(false)
    }
  }

  const publish = async () => {
    const key = data.lexiconRefKey || ref?.key
    if (!key || !onAddAssetCard) return
    setBusy(true)
    try {
      const r = await importCameraLexiconPreset(projectName, key)
      onPatch({ lexiconRefUrl: r.url })
      onAddAssetCard({ title: r.title, kind: 'video', url: r.url })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field si-lexicon" data-shot-lexicon>
      <span>
        运镜参照
        <i className="hint-inline" title={`内置白膜库 · ${CAMERA_LEXICON_ATTRIBUTION}`}>
          镜头语言库
        </i>
      </span>
      <select
        value={data.lexiconRefKey || ref?.key || ''}
        disabled={busy}
        onChange={(e) => void bindKey(e.target.value)}
      >
        <option value="">默认（随景别/运镜）</option>
        {options.map((e) => (
          <option key={e.key} value={e.key}>
            {e.cn} · {e.en}
          </option>
        ))}
      </select>
      {previewUrl ? (
        <video className="si-lexicon-vid" src={previewUrl} muted loop playsInline controls preload="metadata" />
      ) : null}
      <label className="chk">
        <input
          type="checkbox"
          checked={Boolean(data.motionLexiconAsRef)}
          onChange={(e) => onPatch({ motionLexiconAsRef: e.target.checked })}
        />
        作为运镜 reference_video（不占画布连线）
      </label>
      {onAddAssetCard && (
        <button type="button" className="btn-ghost" disabled={busy || !(data.lexiconRefKey || ref?.key)} onClick={() => void publish()}>
          发布参照到画布
        </button>
      )}
      {data.lexiconRefKey && (
        <span className="muted">{getCameraLexiconEntry(data.lexiconRefKey)?.en ?? data.lexiconRefKey}</span>
      )}
    </div>
  )
}

export default function Inspector(props: Props) {
  if (!props.node) return <EmptyInspector onReset={props.onReset} />
  if ((props.node as unknown as AssetNodeType).type === 'asset') {
    const asset = props.node as unknown as AssetNodeType
    if (asset.data.kind === 'music') {
      return (
        <MusicAssetPanel
          node={asset}
          patch={props.patch as unknown as (id: string, p: Record<string, unknown>) => void}
          onDelete={props.onDelete}
          settings={props.settings}
          pick={props.pick}
          onPick={props.onPick}
          onGenerate={props.onGenerateAssetMusic}
          shotNodes={props.shotNodes ?? []}
        />
      )
    }
    if (asset.data.kind === 'subtitle') {
      return (
        <SubtitleAssetPanel
          node={asset}
          patch={props.patch as unknown as (id: string, p: Record<string, unknown>) => void}
          onDelete={props.onDelete}
          projectName={props.projectName}
          settings={props.settings}
          pick={props.pick}
          onPick={props.onPick}
          shotNodes={props.shotNodes ?? []}
        />
      )
    }
    return (
      <AssetPanel
        node={asset}
        patch={props.patch as unknown as (id: string, p: Record<string, unknown>) => void}
        onDelete={props.onDelete}
        projectName={props.projectName}
        settings={props.settings}
        pick={props.pick}
        onPick={props.onPick}
        onGenerate={props.onGenerate}
        onGenerateAudio={props.onGenerateAssetAudio}
        shotNodes={props.shotNodes}
      />
    )
  }
  return <InspectorBody {...props} node={props.node} />
}

function EmptyInspector({ onReset }: { onReset: () => void }) {
  return (
    <aside className="inspector">
      <div className="panel-empty">
        <h3>未选中镜头</h3>
        <p>点击画布上的分镜卡片查看参数。</p>
        <ul>
          <li><b>V</b> 选择模式 · 拖动卡片、拉连线</li>
          <li><b>P</b> 画笔 · 在画面上画构图标记</li>
          <li><b>R</b> 框选 · 圈出主体位置</li>
          <li>把图片<b>拖进卡片</b>即可替换参考图</li>
          <li>点连线中间的文字可切换关系类型</li>
          <li>编辑内容自动存在浏览器本地</li>
        </ul>
        <button className="btn-ghost reset" onClick={onReset}>恢复示例分镜</button>
      </div>
    </aside>
  )
}

const VIDEO_MODE_LABEL: Record<ShotVideoRequest['mode'], string> = {
  first: '首帧',
  ref: '多参考图',
  video: '参考视频',
}

function SiReadinessBar({ request }: { request: ShotVideoRequest }) {
  const block = request.blocking[0]
  const warn = !block ? request.warnings[0] : undefined
  const tone = block ? 'err' : warn ? 'warn' : 'ok'
  return (
    <div className={`si-readiness si-readiness--${tone}`} data-readiness-bar>
      <span className="si-readiness-mode">{VIDEO_MODE_LABEL[request.mode]}</span>
      <span className="si-readiness-msg">
        {block ? block.message : warn ? warn.message : '条件满足，可生成视频'}
      </span>
    </div>
  )
}

type BodyProps = Props & { node: ShotNodeType }

/** 分镜 Inspector 的可折叠区块；summary 点击由偏好控制，避免原生 details 状态和 React 状态打架。 */
function InspectorSection({
  id,
  title,
  summary,
  tab,
  hidden,
  open,
  onToggle,
  children,
  className,
}: {
  id: CollapsibleSection
  title: string
  summary?: ReactNode
  tab: ShotInspectorTab
  hidden: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`si-section ${className ?? ''}`.trim()}
      data-shot-tab={tab}
      data-section={id}
      data-open={open ? 'true' : 'false'}
      hidden={hidden}
    >
      <Fold
        open={open}
        onToggle={onToggle}
        title={title}
        meta={summary}
        idPrefix={`si-${id}`}
        bodyClassName="si-section-body"
      >
        {children}
      </Fold>
    </div>
  )
}

function InspectorBody({
  node,
  patch,
  onDelete,
  onReset,
  onGenerate,
  onCancelGenerate,
  ratio,
  setRatio,
  refMode,
  setRefMode,
  marksAsGuide,
  setMarksAsGuide,
  candCount,
  setCandCount,
  vidRes,
  setVidRes,
  onGenerateVideo,
  onRecoverVideo,
  projectAspect,
  settings,
  pick,
  onPick,
  price,
  projectName,
  characters,
  videoRequest,
  onUnlockHandEdit,
  stagePick,
  onPickStage,
  onAddAssetCard,
  onAddAssetRef,
  hasPrevShot,
  onPublishClipFrame,
  onLinkPrevShotTail,
}: BodyProps) {
  const [videos, setVideos] = useState<VideoFile[]>([])
  const [pickVideo, setPickVideo] = useState('')
  useEffect(() => {
    let alive = true
    listVideoFiles().then((v) => {
      if (alive) setVideos(v)
    })
    return () => {
      alive = false
    }
  }, [node.id])

  const d = node.data
  const set = (p: Partial<ShotData>) => patch(node.id, p)
  const activeVideoPrompt = videoRequest
    ? effectiveVideoPrompt(videoRequest, d.videoPromptOverride)
    : null
  const setDialogue = (text: string) => {
    const oldLines = parseDialogue(d.dialogue)
    const nextLines = parseDialogue(text)
    const { delivery } = reconcileDialogueDelivery(oldLines, d.dialogueDelivery, nextLines)
    set({ dialogue: text, dialogueDelivery: delivery })
  }
  const setPerformance = (next: { performance: NonNullable<ShotData['performance']>; dialogueDelivery: NonNullable<ShotData['dialogueDelivery']> }) => {
    set({
      performance: next.performance,
      dialogueDelivery: next.dialogueDelivery,
      handEdited: [...new Set([...(d.handEdited ?? []), 'performance', 'dialogue_delivery'])],
    })
  }
  const clearPerformanceHand = () => {
    set({
      handEdited: (d.handEdited ?? []).filter((f) => f !== 'performance' && f !== 'dialogue_delivery'),
    })
  }
  /** 槽位「添加」：把选中的素材建成画布素材卡并连到本镜（连线才是出片来源） */
  const addAssetFromSlot = (kind: 'image' | 'video' | 'audio', url: string, title: string) => {
    onAddAssetRef?.(node.id, kind, url, title)
  }

  const prodKind = 'video' as const
  const shotTabs = useMemo(() => visibleShotTabsForProdKind(prodKind), [prodKind])
  const videoModelFamily = (settings?.models ?? []).filter(
    (m) => m.cap === 'video' || m.cap === 'videoRef',
  )
  const selectedVideoKey = pick.video || settings?.defaults?.video || ''
  const selectedVideoModel =
    videoModelFamily.find((m) => m.key === selectedVideoKey) ||
    videoModelFamily.find((m) => m.key === settings?.defaults?.video) ||
    videoModelFamily[0]
  const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
  const sceneLabel = d.sceneSlug || `场 ${sceneNo}`
  /** 请求秒数只从拼装结果取；拼装缺失时退回本地取整，避免界面出现空值 */
  const requestSeconds = videoRequest?.seconds ?? effectiveSeconds(d.seconds)
  const requestSecondsText = requestSecondsNote(
    (videoRequest?.shotSeconds ?? Number(d.seconds)) || 0,
    requestSeconds,
    videoRequest?.secondsFloor ?? null,
  )

  const [prefs, setPrefs] = useState<InspectorPrefs>(() => loadInspectorPrefs())
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  const hasImage = Boolean(d.refImage || (d.candidates?.length ?? 0))
  const effectiveTab: ShotInspectorTab = coerceShotTab(prodKind, prefs.tab, hasImage)
  const updatePrefs = (patch: Partial<InspectorPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      saveInspectorPrefs(next)
      return next
    })
  }
  const selectTab = (tab: ShotInspectorTab) => updatePrefs({ tab })
  const toggleSection = (id: CollapsibleSection) => {
    setPrefs((prev) => {
      const next = {
        ...prev,
        collapsed: { ...prev.collapsed, [id]: !prev.collapsed[id] },
      }
      saveInspectorPrefs(next)
      return next
    })
  }

  useEffect(() => {
    const root = panelRef.current
    const scroll = root?.querySelector<HTMLElement>('.si-scroll')
    if (scroll) scroll.scrollTop = 0
  }, [effectiveTab])

  useEffect(() => {
    const coerced = coerceShotTab(prodKind, prefs.tab, hasImage)
    if (coerced === effectiveTab) return
    selectTab(coerced)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 随镜头类型校正 tab
  }, [prodKind])

  useEffect(() => {
    const root = panelRef.current
    if (!root) return
    root.querySelectorAll<HTMLElement>('[data-shot-tab]').forEach((block) => {
      if (block.getAttribute('data-shot-tab') === effectiveTab) return
      block.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => {
        try {
          media.pause()
        } catch {
          /* 忽略浏览器媒体状态错误 */
        }
      })
    })
  }, [effectiveTab])

  useEffect(
    () => () => {
      document.body.classList.remove('si-resizing')
    },
    [],
  )

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: prefs.width }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('si-resizing')
  }
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const next = clampInspectorWidth(drag.startWidth - (e.clientX - drag.startX))
    setPrefs((prev) => (prev.width === next ? prev : { ...prev, width: next }))
  }
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已释放 */
    }
    document.body.classList.remove('si-resizing')
    saveInspectorPrefs(prefsRef.current)
  }
  const resetWidth = () => updatePrefs({ width: DEFAULT_INSPECTOR_WIDTH })

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const idx = shotTabs.findIndex((tab) => tab.id === effectiveTab)
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % shotTabs.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + shotTabs.length) % shotTabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = shotTabs.length - 1
    if (next < 0) return
    e.preventDefault()
    const tab = shotTabs[next].id
    selectTab(tab)
    requestAnimationFrame(() => document.getElementById(`si-tab-${tab}`)?.focus())
  }

  const closeMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.closest('details')?.removeAttribute('open')
  }
  const copyShotId = (e: React.MouseEvent<HTMLButtonElement>) => {
    closeMenu(e)
    if (d.shotId) void navigator.clipboard?.writeText(d.shotId)
  }
  const confirmDelete = (e: React.MouseEvent<HTMLButtonElement>) => {
    closeMenu(e)
    if (window.confirm(`删除镜头 ${d.no}？此操作不可撤销。`)) onDelete(node.id)
  }

  const imageReason = !String(d.prompt ?? '').trim() ? '先填写画面提示词' : ''
  const videoReason = videoRequest?.blocking[0]?.message ?? ''

  return (
    <aside
      ref={panelRef}
      className="inspector shot-inspector"
      style={{ width: prefs.width, flexBasis: prefs.width }}
    >
      <div
        className="si-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整检查器宽度"
        aria-valuenow={prefs.width}
        aria-valuemin={320}
        aria-valuemax={520}
        title="拖动调整宽度，双击复位"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
        onDoubleClick={resetWidth}
      />

      <header className="si-head">
        <div className="si-head-main">
          <div className="si-thumb">
            {d.refImage ? <img src={d.refImage} alt="" /> : <span>无画面</span>}
          </div>
          <div className="si-title">
            <div className="si-title-row">
              <span className="panel-no">{d.no}</span>
              <span className="si-badge-prod si-badge-prod--video">出片镜</span>
              {d.orphan && (
                <em className="panel-orphan" title="project.json 里已没有这一镜">
                  孤儿
                </em>
              )}
            </div>
            <div className="si-sub">
              {d.size} · {d.move} · {d.seconds}s
              {d.shotId && (
                <code className="panel-sid" title="project.json 里的稳定 ID，同步靠它">
                  {d.shotId}
                </code>
              )}
            </div>
          </div>
        </div>
        <details className="si-menu">
          <summary title="更多操作" aria-label="更多操作">
            ⋯
          </summary>
          <div className="si-menu-pop">
            {d.shotId && <button onClick={copyShotId}>复制稳定 ID</button>}
            <button className="danger" onClick={confirmDelete}>
              删除镜头
            </button>
          </div>
        </details>
      </header>

      <nav className="si-tabs" role="tablist" aria-label="镜头检查器">
        {shotTabs.map((tab) => (
          <button
            key={tab.id}
            id={`si-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={effectiveTab === tab.id}
            aria-controls="si-panel"
            tabIndex={effectiveTab === tab.id ? 0 : -1}
            className={effectiveTab === tab.id ? 'on' : ''}
            onClick={() => selectTab(tab.id)}
            onKeyDown={onTabKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div
        className="si-scroll"
        id="si-panel"
        role="tabpanel"
        aria-labelledby={`si-tab-${effectiveTab}`}
      >
      <div
        className="si-slots"
        data-shot-tab="outgoing"
        hidden={effectiveTab !== 'outgoing'}
      >
        <ImageSlot
          request={videoRequest}
          data={d}
          onPatch={set}
          projectName={projectName}
          onAddAsset={addAssetFromSlot}
        />
        <VideoSlot
          request={videoRequest}
          data={d}
          onPatch={set}
          projectName={projectName}
          onAddAsset={addAssetFromSlot}
        />
        <AudioSlot
          request={videoRequest}
          data={d}
          onPatch={set}
          projectName={projectName}
          onAddAsset={addAssetFromSlot}
        />
        <section className="si-slot" data-slot="prompt">
          <SlotHead label="提示词" hint="唯一必填项，逐字提交" />
          {activeVideoPrompt ? (
            <OutgoingVideoPromptPanel
              effective={activeVideoPrompt}
              handEdited={isVideoPromptHandEdited(d)}
              empty={!activeVideoPrompt.text.trim()}
              onSaveBody={(text) => {
                // 先解锁再写正文：解锁读的是 nodesRef 快照，若先 set 再解锁，
                // 解锁会把刚写的正文回滚成旧值（set 是异步的）。
                if ((d.handEdited ?? []).includes('video_prompt_override')) {
                  onUnlockHandEdit?.(node.id, ['video_prompt_override'])
                }
                // 正文只有一个落点：写回 video_prompt，并锁住它不被模型重写覆盖。
                set({
                  videoPrompt: text,
                  videoPromptOverride: undefined,
                  handEdited: [
                    ...new Set([
                      ...(d.handEdited ?? []).filter((f) => f !== 'video_prompt_override'),
                      'video_prompt',
                    ]),
                  ],
                })
              }}
              onClearHandEdit={() => {
                onUnlockHandEdit?.(node.id, ['video_prompt'])
                set({ handEdited: (d.handEdited ?? []).filter((f) => f !== 'video_prompt') })
              }}
            />
          ) : null}
        </section>

        <div className="gen-box vid-settings-block" data-shot-settings>
          <div className="gen-head">
            <span>生成设置</span>
            <span className="gen-cost">
              ¥{money(videoCost(price, requestSeconds, vidRes))} / 次
            </span>
          </div>
          <VideoOutgoingModelRow
            settings={settings}
            pick={pick}
            onPick={onPick}
            vidRes={vidRes}
            onVidResChange={setVidRes}
          />
          <div className="gen-controls">
            <label className="field vid-len-field">
              <span>时长（秒）</span>
              <input
                type="number"
                step="0.1"
                min="0.1"
                data-shot-seconds
                value={d.seconds}
                onChange={(e) => set({ seconds: Number(e.target.value) || 0.1 })}
              />
            </label>
            <select value={ratio} onChange={(e) => setRatio(e.target.value)} title="画幅">
              {RATIOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {requestSecondsText !== `${requestSeconds}s` ? (
            <p className="gen-note" data-shot-request-seconds>{requestSecondsText}</p>
          ) : null}
        </div>

        <div className="gen-box vid-box" data-shot-result>
          <div className="gen-head">
            <span>成片</span>
            {d.videoUrl ? <span className="gen-cost">{requestSeconds}s</span> : null}
          </div>
          {d.videoUrl ? (
            <div className="si-video-preview">
              <video src={d.videoUrl} muted loop autoPlay playsInline controls preload="metadata" />
              <a className="btn-ghost vid-save" href={d.videoUrl} download={`${d.shotId || d.no}.mp4`}>
                保存成片
              </a>
              <ShotClipFrameActions
                hasVideo
                hasPrevShot={Boolean(hasPrevShot)}
                showLinkPrev
                onPublishClipFrame={onPublishClipFrame}
                onLinkPrevShotTail={onLinkPrevShotTail}
              />
            </div>
          ) : (
            <p className="refx-empty">还没有成片。填好上面四个槽位后点底部「生成视频」。</p>
          )}
        </div>
      </div>

      </div>

      <footer className="si-foot" data-shot-footer>
        {effectiveTab === 'outgoing' && (
          <>
            <button
              className="btn primary block"
              disabled={d.vidState === 'running' || Boolean(videoRequest?.blocking.length)}
              onClick={() => onGenerateVideo(node.id)}
              title={d.refImage ? '' : '静帧预览与出片无关；出片须画布连线参考'}
            >
              {d.vidState === 'running' ? '出片中…' : d.videoUrl ? '重出视频' : '生成视频'}
            </button>
            {d.vidState === 'error' &&
            onRecoverVideo &&
            (d.videoUpstreamRecover?.upstreamTaskId ||
              parseUpstreamTaskIdFromError(d.vidError || '')) ? (
              <button
                type="button"
                className="btn block"
                onClick={() => onRecoverVideo(node.id)}
                title="按报错里的上游 task_id 向云端查询并下载，不会重新提交生成"
              >
                重新拉取成片
              </button>
            ) : null}
            <div className="si-foot-note">
              {d.vidState === 'error' && d.vidError && !videoRequest?.blocking.length ? (
                <GenErrorNote message={d.vidError} summary="出片失败" />
              ) : videoReason ? (
                videoReason
              ) : (
                `约 ¥${money(videoCost(price, requestSeconds, vidRes))} / 次`
              )}
            </div>
          </>
        )}
        {effectiveTab === 'narrative' && (
          <div className="si-foot-note">改动会自动保存到当前镜头</div>
        )}
      </footer>
    </aside>
  )
}
