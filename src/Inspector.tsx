import type { ShotData } from './types'
import { CANDIDATE_COUNTS, effectiveSeconds, MOVES, RATIOS, SHOT_SIZES, VOICE_RATES } from './types'
import { hasNeighborReference } from './shotReferences'
import { imageCost, money, videoCost, type Pricing } from './pricing'
import type { VoiceOption } from './api'
import type { AppSettings, Cap } from './api'
import { listVideoFiles, type VideoFile } from './api'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AssetKind, AssetNodeType, ShotNodeType } from './data'
import type { CharacterSheet } from './characters'
import { CapModelSelect } from './ModelSelect'
import MediaPicker from './MediaPicker'
import { fetchStockMeta } from './stock/api'
import type { StockImportMeta } from './stock/types'
import { pickKind, pickTitle, type PickItem } from './mediaPick'
import { ACCEPT_ATTR, uploadImageFile } from './mediaUpload'
import PerformanceEditor from './PerformanceEditor'
import LipSyncPanel from './LipSyncPanel'
import NativeAudioPanel from './NativeAudioPanel'
import { audioRefCapabilitiesFor } from './nativeAudio'
import { effectiveVideoPrompt, type ShotVideoRequest } from './videoPrompt'
import { parseDialogue, reconcileDialogueDelivery } from './prompts'
import { deliveryForSpeaker, voiceFingerprint } from './performance'
import {
  clampInspectorWidth,
  DEFAULT_INSPECTOR_WIDTH,
  defaultTabForShot,
  loadInspectorPrefs,
  performanceSummary,
  saveInspectorPrefs,
  shotStatusChips,
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
}: {
  node: AssetNodeType
  patch: (id: string, p: Record<string, unknown>) => void
  onDelete: (id: string) => void
  projectName: string
}) {
  const d = node.data
  const [pickerOpen, setPickerOpen] = useState(false)
  const [stockMeta, setStockMeta] = useState<StockImportMeta | null>(null)
  const [metaMissing, setMetaMissing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)
  const set = (p: Partial<{ title: string; kind: AssetKind; url: string }>) => patch(node.id, p as never)

  /**
   * 本地上传：保存成功才写地址。素材卡会落库，所以不能像参考图那样先塞 dataURL。
   * 类型沿用既有规则（pickKind）：场景/道具卡保持原类型，其余回落图片。
   */
  const uploadFromDisk = async (file: File) => {
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
              <span className="st-hint">音频素材只用于预览与管理，暂不参与出片音轨</span>
            </div>
          ) : (
            <img src={d.url} alt={d.title} className="asset-preview" />
          )
        ) : (
          <div className="refx-empty">还没设置地址</div>
        )}
      </div>
      <p className="st-hint">
        从卡片右侧的圆点拉线到分镜卡，或<b>右击卡片</b>直接点选要连的镜头，连线即参考 ——
        生成画面时图会作为参考图传给模型；视频卡用于管理与预览素材（Seedance 1.0 出片只吃单首帧）。
      </p>
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
    </aside>
  )
}

type Props = {
  node: ShotNodeType | null
  patch: (id: string, patch: Partial<ShotData>) => void
  onDelete: (id: string) => void
  onReset: () => void
  onGenerate: (id: string) => void
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
  projectAspect: string
  onVoice: (id: string) => void
  voices: VoiceOption[]
  voiceProvider: string
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
}

export default function Inspector(props: Props) {
  if (!props.node) return <EmptyInspector onReset={props.onReset} />
  if ((props.node as unknown as AssetNodeType).type === 'asset') {
    return (
      <AssetPanel
        node={props.node as unknown as AssetNodeType}
        patch={props.patch as unknown as (id: string, p: Record<string, unknown>) => void}
        onDelete={props.onDelete}
        projectName={props.projectName}
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
  native: '原生音频',
}

/**
 * 出片前可见的最终提示词：上半部分是实际附加的参考（事实），
 * 下半部分是正文（可手改）。附件由画布连线和开关决定，改正文不会改附件。
 */
function VideoPromptPanel({
  data,
  request,
  onPatch,
}: {
  data: ShotData
  request: ShotVideoRequest
  onPatch: (p: Partial<ShotData>) => void
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const effective = effectiveVideoPrompt(request, data.videoPromptOverride)
  const meta = data.videoMeta && data.videoMeta.url === data.videoUrl ? data.videoMeta : null
  const sourceLabel =
    request.textSource === 'video_prompt'
      ? '运动提示词'
      : request.textSource === 'prompt_fallback'
        ? '画面提示词回退'
        : '默认运动描述'

  const startEdit = () => {
    setDraft(effective.text)
    setEditing(true)
  }
  const save = () => {
    const text = draft.trim()
    if (!text) return
    onPatch({
      videoPromptOverride: {
        text,
        fingerprint: request.fingerprint,
        createdAt: new Date().toISOString(),
      },
      handEdited: [...new Set([...(data.handEdited ?? []), 'video_prompt_override'])],
    })
    setEditing(false)
  }
  const restore = () => {
    onPatch({
      videoPromptOverride: undefined,
      handEdited: (data.handEdited ?? []).filter((f) => f !== 'video_prompt_override'),
    })
    setEditing(false)
  }

  return (
    <div className="vp-panel" data-video-prompt-panel>
      <div className="vp-head">
        <button className="vp-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'} 本次出片提示词
        </button>
        <span
          className={`vp-badge ${
            effective.source === 'override' ? (effective.stale ? 'warn' : 'manual') : 'auto'
          }`}
        >
          {effective.source === 'override' ? (effective.stale ? '旧快照' : '已手改') : '自动拼装'}
        </span>
      </div>

      {open && (
        <>
          <div className="vp-summary">
            {VIDEO_MODE_LABEL[request.mode]} · {request.seconds}s
            {request.resolution ? ` · ${request.resolution}` : ''} · 正文来自{sourceLabel}
            <br />
            参考图 {request.refs.length}/4
            {request.omitted.length ? `（省略 ${request.omitted.length}）` : ''}
            {` · 表情参考${data.useExpressionRef ? '开' : '关'}`}
            {request.video ? ' · 参考视频 1' : ''}
            {request.audio ? ' · 音色参考 1' : ''}
          </div>

          <ul className="vp-refs">
            {request.refs.map((r) => (
              <li key={`${r.slot}-${r.index}-${r.url}`}>
                <b>图{r.index}</b> {r.label}
                <span>{r.purpose}</span>
              </li>
            ))}
            {request.video && (
              <li>
                <b>视频1</b> {request.video.label}
                <span>{request.video.purpose}</span>
              </li>
            )}
            {request.audio && (
              <li>
                <b>音频1</b> {request.audio.label}
                <span>{request.audio.purpose}</span>
              </li>
            )}
            {request.omitted.map((o, i) => (
              <li className="omitted" key={`omitted-${i}-${o.label}`}>
                <b>省略</b> {o.label}
                <span>{o.reason}</span>
              </li>
            ))}
            {request.omittedVideos.map((o, i) => (
              <li className="omitted" key={`omitted-video-${i}-${o.label}`}>
                <b>忽略</b> {o.label}
                <span>{o.reason}</span>
              </li>
            ))}
          </ul>

          {request.blocking.map((b) => (
            <div className="gen-error vp-issue" key={b.code}>
              {b.message}
            </div>
          ))}
          {request.warnings.map((w) => (
            <div className="gen-warn vp-issue" key={w.code}>
              {w.message}
            </div>
          ))}
          {effective.stale && (
            <div className="gen-warn vp-issue">
              参考、台词或模式已变化，当前正文是保存时的旧快照。
            </div>
          )}

          {editing ? (
            <>
              <textarea
                className="vp-text vp-textarea"
                rows={9}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="vp-actions">
                <button className="btn-mini" disabled={!draft.trim()} onClick={save}>
                  保存手改
                </button>
                <button className="btn-mini" onClick={() => setEditing(false)}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <pre className="vp-text" data-video-prompt-text>
                {effective.text}
              </pre>
              <div className="vp-actions">
                <button className="btn-mini" onClick={startEdit}>
                  编辑
                </button>
                {effective.source === 'override' && (
                  <button className="btn-mini" onClick={restore}>
                    {effective.stale ? '重新拼装' : '恢复自动拼装'}
                  </button>
                )}
              </div>
            </>
          )}

          {meta ? (
            <details className="vp-meta">
              <summary>
                当前视频的提示词 · {new Date(meta.createdAt).toLocaleString()}
                {meta.modelKey ? ` · ${meta.modelKey}` : ''}
              </summary>
              <pre>{meta.prompt}</pre>
            </details>
          ) : (
            data.videoUrl && <div className="vp-meta-note">当前视频未记录提示词来源</div>
          )}
        </>
      )}
    </div>
  )
}

type BodyProps = Props & { node: ShotNodeType }

const SHOT_TABS: { id: ShotInspectorTab; label: string }[] = [
  { id: 'visual', label: '画面' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '声音' },
  { id: 'more', label: '更多' },
]

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
    <details
      className={`si-section ${className ?? ''}`}
      data-shot-tab={tab}
      data-section={id}
      hidden={hidden}
      open={open}
    >
      <summary
        onClick={(e) => {
          e.preventDefault()
          onToggle()
        }}
      >
        <span className="si-section-title">{title}</span>
        {summary ? <span className="si-section-summary">{summary}</span> : null}
        <span className="si-section-chevron" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="si-section-body">{children}</div>
    </details>
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
  projectAspect,
  onVoice,
  voices,
  voiceProvider,
  settings,
  pick,
  onPick,
  price,
  projectName,
  characters,
  videoRequest,
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
  const setLipSync = (patch: Partial<ShotData>) => {
    set({
      ...patch,
      handEdited: [...new Set([...(d.handEdited ?? []), 'lip_sync'])],
    })
  }
  const voiceLines = parseDialogue(d.dialogue)
  const voiceDeliveries = voiceLines.map((line, i) =>
    deliveryForSpeaker(d.performance, line.speaker, d.dialogueDelivery, i),
  )
  const voiceStale = Boolean(
    d.voiceUrl &&
      d.voiceMeta?.fingerprint &&
      d.voiceMeta.fingerprint !== voiceFingerprint(d.dialogue.trim(), voiceDeliveries),
  )
  const videoModelFamily = (settings?.models ?? []).filter(
    (m) => m.cap === 'video' || m.cap === 'videoRef',
  )
  const selectedVideoKey = pick.video || settings?.defaults?.video || ''
  const selectedVideoModel =
    videoModelFamily.find((m) => m.key === selectedVideoKey) ||
    videoModelFamily.find((m) => m.key === settings?.defaults?.video) ||
    videoModelFamily[0]
  const videoProvider = settings?.providers.find((p) => p.id === selectedVideoModel?.provider)
  const audioCaps = audioRefCapabilitiesFor({
    providerKind: videoProvider?.kind,
    model: selectedVideoModel?.model,
    audioOut: selectedVideoModel?.features?.audioOut,
  })
  const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
  const sceneLabel = d.sceneCode
    ? `代码场景${d.sceneSlug ? ` · ${d.sceneSlug}` : ''}`
    : d.sceneSlug || `场 ${sceneNo}`

  const [prefs, setPrefs] = useState<InspectorPrefs>(() => loadInspectorPrefs())
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  const hasImage = Boolean(d.refImage || (d.candidates?.length ?? 0))
  const effectiveTab: ShotInspectorTab =
    prefs.tab === 'auto' ? defaultTabForShot(hasImage) : prefs.tab
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
    const idx = SHOT_TABS.findIndex((tab) => tab.id === effectiveTab)
    let next = -1
    if (e.key === 'ArrowRight') next = (idx + 1) % SHOT_TABS.length
    else if (e.key === 'ArrowLeft') next = (idx - 1 + SHOT_TABS.length) % SHOT_TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = SHOT_TABS.length - 1
    if (next < 0) return
    e.preventDefault()
    const tab = SHOT_TABS[next].id
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

  const chips = shotStatusChips({
    hasImage,
    candidateCount: d.candidates?.length ?? 0,
    hasVideo: Boolean(d.videoUrl),
    seconds: d.seconds,
    voiceUrl: d.voiceUrl,
    voiceSeconds: d.voiceSeconds,
    voiceOver: (d.voiceSeconds ?? 0) > d.seconds + 0.2,
    voiceStale,
    promptSource: activeVideoPrompt?.source ?? 'auto',
    promptStale: activeVideoPrompt?.stale ?? false,
    nativeAudio: d.audioMode === 'native',
  })
  const imageReason = !String(d.prompt ?? '').trim() ? '先填写画面提示词' : ''
  const voiceReason = !String(d.dialogue ?? '').trim()
    ? '先填写台词'
    : voices.length === 0
      ? '没有可用音色'
      : ''
  const voiceEngineLabel =
    voiceProvider === 'elevenlabs'
      ? 'ElevenLabs'
      : voiceProvider === 'minimax'
        ? 'MiniMax'
        : voiceProvider === 'volc-tts'
          ? '火山 Seed TTS'
          : voiceProvider === 'macos-say'
            ? 'macOS TTS'
            : '无可用引擎'
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
        <div className="si-chips">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`si-chip ${chip.tone}`}
              onClick={() => selectTab(chip.tab)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </header>

      <nav className="si-tabs" role="tablist" aria-label="镜头检查器">
        {SHOT_TABS.map((tab) => (
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
        <InspectorSection
          id="shotParams"
          title="镜头参数"
          summary={`${d.seconds}s · ${d.size} · ${d.move}`}
          tab="visual"
          hidden={effectiveTab !== 'visual'}
          open={!prefs.collapsed.shotParams}
          onToggle={() => toggleSection('shotParams')}
        >
          <label className="field">
            <span>镜号</span>
        <input value={d.no} onChange={(e) => set({ no: e.target.value })} />
      </label>

      <div className="field-row">
        <label className="field">
          <span>时长（秒）</span>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={d.seconds}
            onChange={(e) => set({ seconds: Number(e.target.value) || 0.1 })}
          />
        </label>
        <label className="field">
          <span>景别</span>
          <select value={d.size} onChange={(e) => set({ size: e.target.value })}>
            {SHOT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

          <label className="field">
            <span>运镜</span>
            <select value={d.move} onChange={(e) => set({ move: e.target.value })}>
              {MOVES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </InspectorSection>

        <div className="field si-frame" data-shot-tab="visual" hidden={effectiveTab !== 'visual'}>
          <span>当前画面</span>
          <div className="ref-thumb">
            {d.refImage ? (
              <img src={d.refImage} alt="当前画面" />
            ) : (
              <div className="ref-empty">拖图进卡片，或点底部「生成画面」</div>
            )}
          </div>
          {(d.candidates?.length ?? 0) > 1 && (
            <div className="si-cands">
              {d.candidates!.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  type="button"
                  className={`si-cand ${i === (d.activeIdx ?? 0) ? 'on' : ''}`}
                  title={`候选 ${i + 1}（点选即定稿）`}
                  onClick={() =>
                    set({ activeIdx: i, refImage: c, videoUrl: undefined, vidState: 'idle' })
                  }
                >
                  <img src={c} alt={`候选 ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
          <div className="ref-actions">
            <label className="btn-ghost file">
              更换
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  const r = new FileReader()
                  r.onload = () =>
                    set({ refImage: String(r.result), videoUrl: undefined, vidState: 'idle' })
                  r.readAsDataURL(f)
                }}
              />
            </label>
            {d.refImage && (
              <button
                className="btn-ghost"
                onClick={() => set({ refImage: undefined, videoUrl: undefined, vidState: 'idle' })}
              >
                移除
              </button>
            )}
          </div>
        </div>

        <label className="field" data-shot-tab="audio" hidden={effectiveTab !== 'audio'}>
          <span>台词 / 音效</span>
          <textarea rows={2} value={d.dialogue} onChange={(e) => setDialogue(e.target.value)} />
        </label>

        <InspectorSection
          id="performance"
          title="表演"
          summary={performanceSummary(d.performance)}
          tab="audio"
          hidden={effectiveTab !== 'audio'}
          open={!prefs.collapsed.performance}
          onToggle={() => toggleSection('performance')}
        >
          <div className="field perf-inspector">
            <span>
              表演
              <i className="hint-inline" title="按角色写情绪、动作、视线和台词表演；会进入提示词与配音">
                表演方向
              </i>
            </span>
            <PerformanceEditor
              cast={d.cast}
              performance={d.performance}
              dialogue={parseDialogue(d.dialogue)}
              delivery={d.dialogueDelivery}
              onChange={setPerformance}
            />
            {(d.handEdited ?? []).some((f) => f === 'performance' || f === 'dialogue_delivery') && (
              <button className="btn-mini ghost" onClick={clearPerformanceHand}>
                恢复模型建议
              </button>
            )}
          </div>
        </InspectorSection>

        <div className="gen-box voice-box" data-shot-tab="audio" hidden={effectiveTab !== 'audio'}>
          <div className="gen-head">
            <span>台词配音</span>
            <span className="gen-cost">
              {d.voiceUrl ? `${(d.voiceSeconds ?? 0).toFixed(1)}s · ` : ''}
              {voiceEngineLabel}
            </span>
          </div>
        <div className="gen-controls">
          <select
            value={d.voiceName ?? voices[0]?.id ?? ''}
            onChange={(e) => set({ voiceName: e.target.value })}
            title="发音人"
            disabled={voices.length === 0}
          >
            {voices.length === 0 ? (
              <option value="">（无可用音色）</option>
            ) : (
              voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))
            )}
          </select>
          <select
            value={d.voiceRate ?? 180}
            onChange={(e) => set({ voiceRate: Number(e.target.value) })}
            title="语速"
          >
            {VOICE_RATES.map((r) => (
              <option key={r} value={r}>
                {r === 150 ? '慢' : r === 180 ? '中' : '快'}
              </option>
            ))}
          </select>
        </div>

          <CapModelSelect
            cap="audio"
            label="配音模型"
            settings={settings}
            value={pick.audio}
            onChange={(key) => onPick('audio', key)}
          />
          <label className="field expression-ref-toggle" data-shot-tab="audio" hidden={effectiveTab !== 'audio'}>
            <span>表情参考</span>
            <span className="switch-row">
              <input
                type="checkbox"
                checked={Boolean(d.useExpressionRef)}
                onChange={(e) => set({ useExpressionRef: e.target.checked })}
              />
              带说话角色表情参考
            </span>
            <em>默认关；视频最多 4 张参考图，表情只在预算有富余时加入，身份/场景优先。</em>
          </label>
          {voiceStale && (
            <div className="gen-warn">
              台词或表演已变化，配音需要重生成；旧音频仍保留。
            </div>
          )}
        {(d.voiceMeta?.unsupported?.length ?? 0) > 0 && (
          <div className="gen-note">当前引擎未应用：{d.voiceMeta?.unsupported?.join('、')}</div>
        )}
        {d.voiceUrl && <audio className="voice-audio" src={d.voiceUrl} controls preload="metadata" />}
          {(d.voiceSeconds ?? 0) > d.seconds + 0.2 && (
            <div className="gen-warn">
              配音 {(d.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 {d.seconds.toFixed(1)}s，成片会被截断 ——
              要么拉长镜头时长，要么缩短台词
            </div>
          )}
        </div>

        <div className="field lip-sync-field" data-shot-tab="audio" hidden={effectiveTab !== 'audio'}>
          <span>
            口型
            <i className="hint-inline" title="默认关闭；prompt 只改提示词；provider 需要手动确认并调用外部口型服务">
              唇形同步
            </i>
          </span>
          <LipSyncPanel data={d} onPatch={setLipSync} settings={settings} projectName={projectName} nativeAudio={d.audioMode === 'native'} />
          <div className="gen-note">原生音频在「视频」tab 的出片设置里。</div>
        </div>

        <label className="field" data-shot-tab="visual" hidden={effectiveTab !== 'visual'}>
          <span>画面提示词</span>
          <textarea rows={4} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        </label>

        <InspectorSection
          id="refs"
          title="参考"
          summary={
            videoRequest
              ? `视频出片 ${videoRequest.refs.length}/4${
                  videoRequest.omitted.length ? ` · 省略 ${videoRequest.omitted.length}` : ''
                }`
              : `${d.refIds?.length ?? 0} 项`
          }
          tab="visual"
          hidden={effectiveTab !== 'visual'}
          open={!prefs.collapsed.refs}
          onToggle={() => toggleSection('refs')}
        >
          {videoRequest?.refs.length ? (
            <ul className="si-ref-list">
              {videoRequest.refs.map((ref) => (
                <li key={`${ref.slot}-${ref.index}-${ref.url}`}>
                  <b>图{ref.index}</b>
                  <span className="si-ref-label">{ref.label}</span>
                  <span className="si-ref-purpose">{ref.purpose}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="refx-empty">
              还没有参考。右击画布卡片选择角色、场景或道具；生成画面和出片都会使用。
            </div>
          )}
          {videoRequest?.omitted.length ? (
            <div className="gen-note">
              视频出片省略：{videoRequest.omitted.map((o) => o.label).join('、')}
            </div>
          ) : null}
          <div className="gen-note">右击画布卡片添加或移除参考；手工 URL 在「更多」。</div>
          <div className="gen-note">画面生成最多 10 张；视频出片最多 4 张。</div>
          {(d.refIds?.length ?? 0) > 0 && (
            <div className="gen-note">
              画布连线 {d.refIds!.length} 项；视频出片最多 4 张，具体使用见上。
            </div>
          )}
        </InspectorSection>

        <label className="field" data-shot-tab="video" hidden={effectiveTab !== 'video'}>
          <span>
            运动提示词
            <i className="hint-inline" title="出片时发给 Seedance 的提示词，只写动作与运镜；留空则回退用画面提示词">
              Seedance
            </i>
          </span>
          <textarea
            rows={3}
            value={d.videoPrompt ?? ''}
            placeholder="只写动作与运镜：镜头缓慢前推 20 厘米，雨丝斜切画面，24fps 冷青色调"
            onChange={(e) => set({ videoPrompt: e.target.value })}
          />
        </label>
        {activeVideoPrompt?.source === 'override' && (
          <div
            className="gen-note vp-field-note"
            data-shot-tab="video"
            hidden={effectiveTab !== 'video'}
          >
            当前使用手改提示词，本字段的修改不会影响出片；要重新接管请在上方面板点「重新拼装」。
          </div>
        )}

        <InspectorSection
          id="advanced"
          title="手工参考 URL"
          summary={`${d.refExtras?.length ?? 0} 项`}
          tab="more"
          hidden={effectiveTab !== 'more'}
          open={!prefs.collapsed.advanced}
          onToggle={() => toggleSection('advanced')}
        >
          <div className="field">
            <span>
              手工参考 URL
              <i
                className="hint-inline"
                title="画布连线仍是主入口；这里用于补充外部图片 URL 或本地路径"
              >
                高级
              </i>
            </span>
            {(d.refExtras?.length ?? 0) === 0 && (
              <div className="refx-empty">
                没有手工参考。画布连线请用「画面」tab 的参考汇总；这里可粘图片 URL 或本地路径（/generated/xx.jpg），一行一张。
              </div>
            )}
        {(d.refExtras ?? []).map((r, i) => (
          <div className="refx-row" key={`${r}-${i}`}>
            <img src={r} alt="" className="refx-thumb" />
            <input
              value={r}
              onChange={(e) => {
                const next = [...(d.refExtras ?? [])]
                next[i] = e.target.value
                set({ refExtras: next })
              }}
            />
            <button className="btn-mini" title="删除" onClick={() => set({ refExtras: (d.refExtras ?? []).filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        ))}
        <div className="refx-add">
          <input
            className="refx-add-in"
            placeholder="图片 URL / /generated/xx.jpg，回车添加"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const v = (e.target as HTMLInputElement).value.trim()
              if (!v) return
              set({ refExtras: [...(d.refExtras ?? []), v] })
              ;(e.target as HTMLInputElement).value = ''
            }}
          />
        </div>
          </div>
        </InspectorSection>

        <div className="gen-box" data-shot-tab="visual" hidden={effectiveTab !== 'visual'}>
          <div className="gen-head">
            <span>出图设置</span>
          <span className="gen-cost">
            Seedream 4.5 · ¥{money(imageCost(price, candCount))} / 次
            {candCount > 1 ? ` · ${candCount} 张 × ¥${money(price.image)}` : ''}
          </span>
        </div>

        <div className="gen-controls">
          <select value={ratio} onChange={(e) => setRatio(e.target.value)} title="画幅">
            {RATIOS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={candCount}
            onChange={(e) => setCandCount(Number(e.target.value))}
            title="一次出图张数"
          >
            {CANDIDATE_COUNTS.map((c) => (
              <option key={c} value={c}>{c} 张</option>
            ))}
          </select>
        </div>

        <CapModelSelect
          cap="image"
          label="出图模型"
          settings={settings}
          value={pick.image}
          onChange={(key) => onPick('image', key)}
        />

        <label className="chk">
          <input type="checkbox" checked={refMode} onChange={(e) => setRefMode(e.target.checked)} />
          用当前画面作参考
        </label>

        <label className={`chk ${!refMode || d.marks.length === 0 ? 'dim' : ''}`}>
          <input
            type="checkbox"
            checked={marksAsGuide}
            disabled={!refMode || d.marks.length === 0}
            onChange={(e) => setMarksAsGuide(e.target.checked)}
          />
          标注作为构图约束
          <span className="chk-note">
            {d.marks.length === 0 ? '（先画框）' : !refMode ? '（需开启参考图）' : `（${d.marks.length} 个标注）`}
          </span>
        </label>
      </div>

      <div className="gen-box vid-box" data-shot-tab="video" hidden={effectiveTab !== 'video'}>
        <div className="gen-head">
          <span>出片设置</span>
          <span className="gen-cost">
            Seedance · 约 ¥{money(videoCost(price, Math.round(d.seconds), vidRes))} / 次
          </span>
        </div>
        {d.videoUrl && (
          <div className="si-video-preview">
            <video src={d.videoUrl} muted loop autoPlay playsInline controls preload="metadata" />
            <a className="btn-ghost vid-save" href={d.videoUrl} download={`${d.shotId || d.no}.mp4`}>
              保存成片
            </a>
          </div>
        )}
        <div className="gen-controls">
          <select value={vidRes} onChange={(e) => setVidRes(e.target.value as '480p' | '720p')} title="分辨率">
            <option value="480p">480p</option>
            <option value="720p">720p</option>
          </select>
          <span className="vid-len">
            {Math.min(12, Math.max(2, Math.round(d.seconds)))}s · {d.move === '固定' ? '固定机位' : `运镜 ${d.move}`}
          </span>
        </div>

        <CapModelSelect
          cap="video"
          caps={['video', 'videoRef']}
          label="出片模型"
          settings={settings}
          value={pick.video}
          onChange={(key) => onPick('video', key)}
        />

        <div className="field native-audio-field">
          <span>
            原生音频
            <i className="hint-inline" title="Seedance 2.5 原生音轨；只支持单说话人和有效音色样本">
              视频自带声音
            </i>
          </span>
          <NativeAudioPanel
            data={d}
            onPatch={set}
            characters={characters}
            caps={audioCaps}
            modelKey={selectedVideoKey}
          />
        </div>


        <p className="vid-note">
          连线了参考图就走<b>多参考图模式</b>（reference_image，最多 4 张）；连线了视频素材则同时送
          <b> reference_video</b>（首期只取第一条）。都没连线才回落到首帧图生视频。时长取镜头时长（2~12
          秒），按 tokens 计费。
        </p>
        {(videoRequest?.refs.length ?? 0) > 0 && (
          <p className="vid-refs">参考图 {videoRequest!.refs.length} 张（画布连线）· 多图模式</p>
        )}
        {hasNeighborReference(d.refIds) && (
          <p className="vid-refs">已选相邻分镜参考：本次出片使用参考图模式，图片最多 4 张。</p>
        )}
        {videos.length > 0 && (
          <div className="vid-pick">
            <select value={pickVideo} onChange={(e) => setPickVideo(e.target.value)} title="选一个已生成的视频挂到本镜">
              <option value="">挂载已有视频…（{videos.length} 个）</option>
              {videos.map((v) => (
                <option key={v.url} value={v.url}>
                  {v.name} · {(v.size / 1024 / 1024).toFixed(1)}MB
                </option>
              ))}
            </select>
            <button
              className="btn-mini"
              disabled={!pickVideo}
              onClick={() => {
                set({ videoUrl: pickVideo, vidState: 'idle', vidError: undefined })
                setPickVideo('')
              }}
            >
              挂上
            </button>
          </div>
        )}
        {videoRequest && <VideoPromptPanel data={d} request={videoRequest} onPatch={set} />}
      </div>

      <div className="field" data-shot-tab="visual" hidden={effectiveTab !== 'visual'}>
        <span>构图标注（{d.marks.length}）</span>
        <button className="btn-ghost" disabled={!d.marks.length} onClick={() => set({ marks: [] })}>
          清除全部标注
        </button>
      </div>

      <div className="field si-more" data-shot-tab="more" hidden={effectiveTab !== 'more'}>
        <span>镜头信息</span>
        <div className="si-kv">
          <span>稳定 ID</span>
          <code>{d.shotId || '—'}</code>
        </div>
        <div className="si-kv">
          <span>场次</span>
          <span>
            {sceneLabel} · {projectAspect}
          </span>
        </div>
        <div className="si-kv">
          <span>节点 ID</span>
          <code>{node.id.slice(0, 8)}</code>
        </div>
        <div className="si-kv">
          <span>坐标</span>
          <span>
            {Math.round(node.position.x)}, {Math.round(node.position.y)}
          </span>
        </div>
        {d.orphan && <div className="gen-warn">project.json 里已没有这一镜。</div>}
      </div>
      </div>

      <footer className="si-foot" data-shot-footer>
        {effectiveTab === 'visual' && (
          <>
            <button
              className="btn primary block"
              disabled={d.genState !== 'running' && !String(d.prompt ?? '').trim()}
              onClick={() =>
                d.genState === 'running' ? onCancelGenerate(node.id) : onGenerate(node.id)
              }
              title={d.genState === 'running' ? '取消本次出图' : undefined}
            >
              {d.genState === 'running'
                ? '取消生成'
                : `生成画面${candCount > 1 ? ` ×${candCount}` : ''}`}
            </button>
            <div className="si-foot-note">
              {d.genState === 'error' && d.genError ? (
                <span className="si-foot-error">{d.genError}</span>
              ) : imageReason ? (
                imageReason
              ) : (
                `约 ¥${money(imageCost(price, candCount))} / 次`
              )}
            </div>
          </>
        )}
        {effectiveTab === 'video' && (
          <>
            <button
              className="btn primary block"
              disabled={d.vidState === 'running' || Boolean(videoRequest?.blocking.length)}
              onClick={() => onGenerateVideo(node.id)}
              title={d.refImage ? '' : '无画面时用连线的参考图作首帧'}
            >
              {d.vidState === 'running' ? '出片中…' : d.videoUrl ? '重出视频' : '生成视频'}
            </button>
            <div className="si-foot-note">
              {d.vidState === 'error' && d.vidError && !videoRequest?.blocking.length ? (
                <span className="si-foot-error">{d.vidError}</span>
              ) : videoReason ? (
                '先处理上方出片提示词里的阻止项'
              ) : (
                `约 ¥${money(videoCost(price, Math.round(d.seconds), vidRes))} / 次`
              )}
            </div>
          </>
        )}
        {effectiveTab === 'audio' && (
          <>
            <button
              className="btn primary block"
              disabled={d.voiceState === 'running' || !d.dialogue.trim() || voices.length === 0}
              onClick={() => onVoice(node.id)}
              title={d.dialogue.trim() ? '根据台词合成配音' : '先填台词'}
            >
              {d.voiceState === 'running' ? '配音中…' : d.voiceUrl ? '重新配音' : '生成配音'}
            </button>
            <div className="si-foot-note">
              {d.voiceState === 'error' && d.voiceError ? (
                <span className="si-foot-error">{d.voiceError}</span>
              ) : voiceReason ? (
                voiceReason
              ) : (
                `配音 · ${voiceEngineLabel}`
              )}
            </div>
          </>
        )}
        {effectiveTab === 'more' && (
          <div className="si-foot-note">改动会自动保存到当前镜头</div>
        )}
      </footer>
    </aside>
  )
}
