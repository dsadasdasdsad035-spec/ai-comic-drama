import type { SceneLayout, ShotData } from './types'
import { CANDIDATE_COUNTS, effectiveSeconds, MOVES, RATIOS, SHOT_SIZES, VOICE_RATES } from './types'
import {
  fallbackBlocking,
  isScheduleFresh,
  legacyLayoutToBlocking,
  rosterOf,
} from './scheduleGeometry'
import { resolveShotScene } from './shotScene'
import { isSceneCodeFresh } from './sceneCodeFreshness'
import { hasNeighborReference } from './shotReferences'
import { imageCost, money, videoCost, type Pricing } from './pricing'
import type { VoiceOption } from './api'
import type { AppSettings, Cap } from './api'
import { listVideoFiles, type VideoFile } from './api'
import { useEffect, useRef, useState } from 'react'
import type { AssetKind, AssetNodeType, ShotNodeType } from './data'
import { CapModelSelect } from './ModelSelect'
import MediaPicker from './MediaPicker'
import { pickKind, pickTitle, type PickItem } from './mediaPick'

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
  const set = (p: Partial<{ title: string; kind: AssetKind; url: string }>) => patch(node.id, p as never)
  const confirmPick = (item: PickItem) => {
    set({
      url: item.url,
      kind: pickKind(item, d.kind),
      title: pickTitle(item, d.title),
    })
    setPickerOpen(false)
  }
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
        <span>{d.kind === 'video' ? '视频来源' : '图片来源'}</span>
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
              ) : (
                <img src={d.url} alt="" />
              )
            ) : (
              <span className="asset-source-empty">＋</span>
            )}
          </span>
          <span className="asset-source-copy">
            <b>{d.url ? d.title || '已选素材' : '选择素材'}</b>
            <small>{d.url ? sourceName(d.url) : '缩略图预览 · 场景 / 道具 / 图片 / 视频'}</small>
          </span>
          <span className="asset-source-action">选择素材</span>
        </button>
      </div>
      <div className="field">
        <span>预览</span>
        {d.url ? (
          d.kind === 'video' ? (
            <video src={d.url} muted loop autoPlay playsInline className="asset-preview" />
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
  onOpenSchedule: (id: string) => void
  sceneLayouts: SceneLayout[]
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
}

export default function Inspector({
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
  onOpenSchedule,
  sceneLayouts,
  projectAspect,
  onVoice,
  voices,
  voiceProvider,
  settings,
  pick,
  onPick,
  price,
  projectName,
}: Props) {
  if (!node) {
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

  const [videos, setVideos] = useState<VideoFile[]>([])
  const [pickVideo, setPickVideo] = useState('')
  useEffect(() => {
    if (!node || (node as unknown as AssetNodeType).type === 'asset') return
    let alive = true
    listVideoFiles().then((v) => {
      if (alive) setVideos(v)
    })
    return () => {
      alive = false
    }
  }, [node?.id])

  // 素材卡走专属面板（节点数据结构与分镜卡不同）
  if ((node as unknown as AssetNodeType).type === 'asset') {
    return (
      <AssetPanel
        node={node as unknown as AssetNodeType}
        patch={patch as unknown as (id: string, p: Record<string, unknown>) => void}
        onDelete={onDelete}
        projectName={projectName}
      />
    )
  }

  const d = node.data
  const set = (p: Partial<ShotData>) => patch(node.id, p)
  const videoModelFamily = (settings?.models ?? []).filter(
    (m) => m.cap === 'video' || m.cap === 'videoRef',
  )
  const selectedVideoKey = pick.video || settings?.defaults?.video || ''
  const selectedVideoModel =
    videoModelFamily.find((m) => m.key === selectedVideoKey) ||
    videoModelFamily.find((m) => m.key === settings?.defaults?.video) ||
    videoModelFamily[0]
  const canVideoRef = Boolean(selectedVideoModel?.supportsVideoRef)
  const videoRefOn = Boolean(d.useScheduleVideoRef)
  const sceneNo = Math.max(1, Math.round(Number(d.sceneNo) || 1))
  const resolvedScene = resolveShotScene(d, {
    shotId: d.shotId || node.id,
    sceneLayouts,
    episode: Number(d.episode) || 1,
    sceneNo,
    sceneSlug: d.sceneSlug,
  })
  const sceneLayout = resolvedScene.scene
  const scheduleBlocking =
    d.shotBlocking ??
    legacyLayoutToBlocking(d.layout) ??
    fallbackBlocking(rosterOf(d.cast, d.dialogue), sceneLayout)
  const scheduleDuration = effectiveSeconds(d.seconds)
  const scheduleFresh = d.sceneCode
    ? isSceneCodeFresh({
        sceneCode: d.sceneCode,
        meta: d.sceneCodeMeta,
        context: d.shot3DContext,
        seconds: d.seconds,
        aspect: projectAspect,
        hasVideo: Boolean(d.scheduleVideo),
      })
    : Boolean(
        d.scheduleVideo &&
          d.scheduleMeta &&
          isScheduleFresh(d.scheduleMeta, {
            layout: sceneLayout,
            blocking: scheduleBlocking,
            duration: scheduleDuration,
            aspect: projectAspect,
            mode: 'clean',
          }),
      )
  const scheduleStatus = !d.scheduleVideo
    ? '未渲染'
    : d.sceneCode
      ? scheduleFresh
        ? '生效'
        : '已过期'
      : d.scheduleMeta?.mode === 'review'
        ? '仅审阅'
        : scheduleFresh
          ? '生效'
          : '已过期'
  const scheduleReady = scheduleFresh
  const sceneLabel = d.sceneCode
    ? `代码场景${d.sceneSlug ? ` · ${d.sceneSlug}` : ''}`
    : d.sceneSlug || sceneLayout.sceneSlug || `场 ${sceneNo}`

  return (
    <aside className="inspector">
      <div className="panel-title">
        <span className="panel-no">{d.no}</span>
        {d.shotId && (
          <code className="panel-sid" title="project.json 里的稳定 ID，同步靠它">
            {d.shotId}
          </code>
        )}
        {d.orphan && <em className="panel-orphan" title="project.json 里已没有这一镜">孤儿</em>}
        <span className="spacer" />
        <button className="btn-ghost" onClick={() => onDelete(node.id)}>删除</button>
      </div>

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

      <label className="field">
        <span>台词 / 音效</span>
        <textarea rows={2} value={d.dialogue} onChange={(e) => set({ dialogue: e.target.value })} />
      </label>

      <div className="gen-box voice-box">
        <div className="gen-head">
          <span>台词配音</span>
          <span className="gen-cost">
            {d.voiceUrl ? `${(d.voiceSeconds ?? 0).toFixed(1)}s · ` : ''}
            {voiceProvider === 'elevenlabs'
              ? 'ElevenLabs'
              : voiceProvider === 'minimax'
                ? 'MiniMax'
                : voiceProvider === 'volc-tts'
                  ? '火山 Seed TTS'
                  : voiceProvider === 'macos-say'
                    ? 'macOS TTS'
                    : '无可用引擎'}
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
        <button
          className="btn primary block"
          disabled={d.voiceState === 'running' || !d.dialogue.trim() || voices.length === 0}
          onClick={() => onVoice(node.id)}
          title={d.dialogue.trim() ? '根据台词合成配音' : '先填台词'}
        >
          {d.voiceState === 'running' ? '配音中…' : d.voiceUrl ? '重新配音' : '生成配音'}
        </button>
        {d.voiceState === 'error' && d.voiceError && <div className="gen-error">{d.voiceError}</div>}
        {d.voiceUrl && <audio className="voice-audio" src={d.voiceUrl} controls preload="metadata" />}
        {(d.voiceSeconds ?? 0) > d.seconds + 0.2 && (
          <div className="gen-warn">
            配音 {(d.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 {d.seconds.toFixed(1)}s，成片会被截断 ——
            要么拉长镜头时长，要么缩短台词
          </div>
        )}
        {(d.voiceSeconds ?? 0) > d.seconds + 0.2 && (
          <div className="gen-warn">
            配音 {(d.voiceSeconds ?? 0).toFixed(1)}s 超过镜头 {d.seconds.toFixed(1)}s，成片会被截断 ——
            要么拉长镜头时长，要么缩短台词
          </div>
        )}
      </div>

      <label className="field">
        <span>画面提示词</span>
        <textarea rows={4} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </label>

      <label className="field">
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

      <div className="field">
        <span>
          参考图（场景 / 道具）
          <i
            className="hint-inline"
            title="生成画面时随 cast 角色图一起传给 Seedream 做多图参考，锁定场景与道具外观"
          >
            多图参考
          </i>
        </span>
        {(d.refExtras?.length ?? 0) === 0 && (
          <div className="refx-empty">
            还没附加。推荐<b>右击画布卡片</b>点选参考（免填 URL）；也可粘图片 URL 或本地路径（/generated/xx.jpg），一行一张。
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

      <div className="gen-box">
        <div className="gen-head">
          <span>AI 生成画面</span>
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

        <button
          className="btn primary block"
          onClick={() => (d.genState === 'running' ? onCancelGenerate(node.id) : onGenerate(node.id))}
          title={d.genState === 'running' ? '取消本次出图' : undefined}
        >
          {d.genState === 'running' ? '取消生成' : `生成画面${candCount > 1 ? ` ×${candCount}` : ''}`}
        </button>

        {d.genState === 'error' && d.genError && <div className="gen-error">{d.genError}</div>}
      </div>

      <div className="gen-box vid-box">
        <div className="gen-head">
          <span>AI 生成视频</span>
          <span className="gen-cost">
            Seedance · 约 ¥{money(videoCost(price, Math.round(d.seconds), vidRes))} / 次
          </span>
        </div>
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

        <div className="sched-head">
          <div>
            <b>3D 调度</b>
            <span className={`sched-badge ${scheduleStatus === '生效' ? 'ok' : scheduleStatus === '仅审阅' ? 'review' : scheduleStatus === '已过期' ? 'stale' : 'none'}`}>
              {scheduleStatus}
            </span>
          </div>
          <button className="btn-mini" onClick={() => onOpenSchedule(node.id)}>
            编辑 3D 调度
          </button>
        </div>
        <div className="sched-meta">
          <span>
            {sceneLabel}
            {d.sceneCode
              ? ` · ${d.sceneCode.source === 'ai' ? 'AI 生成' : d.sceneCode.source === 'manual' ? '手改' : d.sceneCode.source === 'legacy-converted' ? '旧结构化转换' : '空白兜底'}`
              : d.shotSceneSeed
                ? ` · 继承 ${d.shotSceneSeed}`
                : ''}
            {!d.sceneCode && d.visualBriefMeta
              ? d.visualBriefMeta.usedVision
                ? ' · 视觉 brief'
                : ' · 参考图未参与'
              : ''}
          </span>
          <span>
            {d.sceneCode ? `${d.sceneCode.codeHash.slice(0, 10)} · ` : ''}
            {scheduleDuration}s{Math.round(Number(d.seconds) || 0) !== scheduleDuration ? '（已夹取）' : ''} · {projectAspect}
          </span>
        </div>

        {d.scheduleVideo && (
          <div className="sched-row">
            <video src={d.scheduleVideo} muted loop autoPlay playsInline preload="metadata" />
            <div className="sched-info">
              <b>{!d.sceneCode && d.scheduleMeta?.mode === 'review' ? '审阅视频' : '干净预演'}</b>
              <span>{!d.sceneCode && d.scheduleMeta?.mode === 'review' ? '仅审片，不可作参考' : '从代码机位输出，可作参考'}</span>
            </div>
            <a href={d.scheduleVideo} target="_blank" rel="noreferrer">
              查看
            </a>
          </div>
        )}

        {d.scheduleVideo && !scheduleReady && (
          <p className="sched-warn">
            {!d.sceneCode && d.scheduleMeta?.mode === 'review'
              ? '这条是审阅视角，只用于看空间；参考视频请重新渲染干净 POV。'
              : d.sceneCode
                ? '代码/选择/时长/画幅已变化，先重新渲染再作参考。'
                : '场景/走位/时长/画幅已变化，先重新渲染再作参考。'}
          </p>
        )}

        <label
          className={`chk ${d.scheduleVideo && canVideoRef && scheduleReady ? '' : 'dim'}`}
          title="把整段调度视频作为 reference_video；只约束走位与运镜，画风以参考图/提示词为准"
        >
          <input
            type="checkbox"
            checked={videoRefOn}
            disabled={!d.scheduleVideo || !canVideoRef || !scheduleReady}
            onChange={(e) =>
              set({
                useScheduleVideoRef: e.target.checked,
                ...(e.target.checked ? { useScheduleFrames: false } : {}),
              })
            }
          />
          用 3D 调度视频作参考（Seedance 2.0+）
          <span className="chk-note">
            {!d.scheduleVideo
              ? '（先生成 3D 调度）'
              : !canVideoRef
                ? '（当前模型不支持）'
                : !scheduleReady
                  ? `（${scheduleStatus}，先重新渲染）`
                  : '（只参考走位/运镜）'}
          </span>
        </label>

        {d.motionNote && (
          <p className={`motion-hint ${!scheduleReady && d.scheduleVideo ? 'dim' : ''}`}>
            运镜（{d.sceneCode ? '代码/用户提供' : '旧调度'}）：{d.motionNote}{!scheduleReady && d.scheduleVideo ? '（调度已变化，重渲后更新）' : ''}
          </p>
        )}

        {d.scheduleVideo && (
          <label
            className={`chk ${videoRefOn || !scheduleReady ? 'dim' : ''}`}
            title="调度视频抽的帧是白模，可能把画面带成 3D 风格，默认不传"
          >
            <input
              type="checkbox"
              checked={!videoRefOn && Boolean(d.useScheduleFrames)}
              disabled={videoRefOn || !scheduleReady}
              onChange={(e) => set({ useScheduleFrames: e.target.checked })}
            />
            带调度关键帧作参考
            <span className="chk-note">
              {videoRefOn
                ? '（视频参考优先，抽帧已忽略）'
                : !scheduleReady
                  ? `（${scheduleStatus}，先重新渲染）`
                  : '（白模可能影响画风）'}
            </span>
          </label>
        )}

        <p className="vid-note">
          连线了参考图就走<b>多参考图模式</b>（reference_image，最多 4 张，提示词用 [图N] 指代）；
          没连线才回落到首帧图生视频。时长取镜头时长（2~12 秒），按 tokens 计费。
        </p>
        {(d.refIds?.length ?? 0) > 0 && (
          <p className="vid-refs">参考图 {d.refIds!.length} 张（画布连线）· 多图模式</p>
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
        <button
          className="btn primary block"
          disabled={d.vidState === 'running'}
          onClick={() => onGenerateVideo(node.id)}
          title={d.refImage ? '' : '无画面时用连线的参考图作首帧'}
        >
          {d.vidState === 'running' ? '出片中…' : d.videoUrl ? '重出视频' : '生成视频'}
        </button>
        {d.vidState === 'error' && d.vidError && <div className="gen-error">{d.vidError}</div>}
        {d.videoUrl && (
          <>
            <video className="vid-thumb" src={d.videoUrl} muted loop autoPlay playsInline />
            <a className="btn-ghost vid-save" href={d.videoUrl} download={`${d.shotId || d.no}.mp4`}>
              保存成片
            </a>
          </>
        )}
      </div>

      <div className="field">
        <span>参考图</span>
        <div className="ref-thumb">
          {d.refImage ? <img src={d.refImage} alt="ref" /> : <div className="ref-empty">拖图进卡片</div>}
        </div>
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
                r.onload = () => set({ refImage: String(r.result), videoUrl: undefined, vidState: 'idle' })
                r.readAsDataURL(f)
              }}
            />
          </label>
          {d.refImage && (
            <button className="btn-ghost" onClick={() => set({ refImage: undefined, videoUrl: undefined, vidState: 'idle' })}>移除</button>
          )}
        </div>
      </div>

      <div className="field">
        <span>构图标注（{d.marks.length}）</span>
        <button className="btn-ghost" disabled={!d.marks.length} onClick={() => set({ marks: [] })}>
          清除全部标注
        </button>
      </div>

      <div className="panel-foot">
        <div>节点 ID：{node.id.slice(0, 8)}</div>
        <div>坐标：{Math.round(node.position.x)}, {Math.round(node.position.y)}</div>
      </div>
    </aside>
  )
}
