import { endTask, startTask } from './tasks'
import { SseEventParser } from './textStream'
import type { AgentLimitSettings } from './agent/agentLimits'
import type { CustomVoice, VoiceCapabilities, VoiceEntry, VoiceSource } from './voiceCatalog'
export type { CustomVoice, VoiceCapabilities, VoiceEntry, VoiceSource } from './voiceCatalog'
import type {
  DialogueDelivery,
  LipSyncState,
  PerformanceEntry,
  SceneCode,
  SceneCodeMeta,
  SceneLayout,
  ScheduleMeta,
  Shot3DContext,
  ShotBlocking,
  ShotScene,
  TransitionOut,
  VisualBrief,
  VisualBriefMeta,
  VideoMeta,
  VideoPromptOverride,
  VoiceMeta,
} from './types'
export type GenResult = {
  urls: string[]
  url: string
  size: string
  elapsed: number
  /** 服务端部分候选超时/失败时的提示 */
  warning?: string
  timedOut?: number
}

/** 客户端请求上限；服务端默认 180s，客户端略长，先让服务端返回结构化超时 */
export const IMAGE_GENERATION_TIMEOUT_MS =
  Number((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_IMAGE_TIMEOUT_MS) || 200_000

export type ImageLifecycle = {
  /** 任务/批量取消信号 */
  signal?: AbortSignal
  /** 测试或特殊调用可覆盖；默认 IMAGE_GENERATION_TIMEOUT_MS */
  timeoutMs?: number
}

function abortError(message = '已取消'): Error {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError')
  const e = new Error(message)
  e.name = 'AbortError'
  return e
}

function timeoutError(message = '生成超时，可重试'): Error {
  const e = new Error(message)
  e.name = 'TimeoutError'
  return e
}

export type GenError = { message: string; kind?: string }

/** 调用本地代理 → 火山方舟 Seedream，图存到 public/generated 并返回站内路径 */
export async function generateImage(opts: {
  prompt: string
  ratio: string
  /** 单张构图参考（上一镜画面 / 标注合成图） */
  refImage?: string
  /** 多参考图：角色三视图 / 场景图 / 道具图（Seedream 4.5 image 数组，上限 10 张） */
  refImages?: string[]
  n?: number
  /** 设置页模型表里的键；不传走 image 默认 */
  modelKey?: string
  /** 三视图走 view 能力，其余走 image */
  cap?: 'image' | 'view'
  /** 传入项目名时结果写项目媒体目录（角色三视图 / 设定图），不传写公共产物池 */
  project?: string
}, lifecycle: ImageLifecycle = {}): Promise<GenResult> {
  const controller = new AbortController()
  let timedOut = false
  const timeoutMs = Math.max(1000, Number(lifecycle.timeoutMs) || IMAGE_GENERATION_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (lifecycle.signal?.aborted) controller.abort()
  else lifecycle.signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    let res: Response
    try {
      res = await fetch('/api/seedream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
        signal: controller.signal,
      })
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        throw timedOut ? timeoutError() : abortError()
      }
      throw new Error('连不上本地代理，dev server 是否还在运行？')
    }

    let j: any
    try {
      j = await res.json()
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw timedOut ? timeoutError() : abortError()
      throw new Error(`代理返回了非 JSON 响应（HTTP ${res.status}）`)
    }

    if (!j.ok) {
      const hint =
        j.kind === 'billing'
          ? '（火山方舟账户可能欠费或余额不足）'
          : j.kind === 'no-key'
            ? ''
            : j.kind === 'auth'
              ? '（密钥无效）'
              : ''
      throw new Error(`${j.message}${hint}`)
    }
    const urls: string[] = Array.isArray(j.urls) ? j.urls : [j.url]
    return { ...(j as GenResult), urls }
  } finally {
    clearTimeout(timer)
    lifecycle.signal?.removeEventListener('abort', onAbort)
  }
}

/** 上传图片：dataURL 交给服务端落盘，返回站内文件 URL */
export async function saveImageDataUrl(
  dataUrl: string,
  opts: { project?: string; prefix?: string } = {},
): Promise<string> {
  const r = await fetch('/api/save-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, ...opts }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '图片保存失败')
  return String(j.url || '')
}

export async function checkHealth(): Promise<{ hasKey: boolean; model: string } | null> {
  try {
    const r = await fetch('/api/health')
    return await r.json()
  } catch {
    return null
  }
}

// ---------- 图生视频 ----------

export type VideoOpts = {
  image?: string
  /** 尾帧（APIMart Kling v3 等支持首尾帧的模型使用） */
  lastFrame?: string
  /** 多参考图模式（方舟 reference_image，1~4 张）；有值时忽略 image */
  refImages?: string[]
  /** 3D 调度视频参考（方舟 reference_video，1~3 段）；有值时进入全模态参考模式 */
  refVideos?: string[]
  /** 原生音频：Seedance 2.5 开启 generate_audio */
  generateAudio?: boolean
  /** 单个音色参考；APIMart 使用 audio_url 字符串（URL 或 data:audio/...;base64） */
  audioRef?: string
  /**
   * 转场模式：由服务端按模型能力决定首帧/尾帧/参考图。
   * 方舟用关键帧作首帧；APIMart 首尾帧模型用边界帧并（在不冲突时）把关键帧当参考。
   */
  transition?: {
    boundaryOut?: string
    boundaryIn?: string
    keyframe?: string
  }
  prompt: string
  seconds: number
  ratio: string
  resolution?: '480p' | '720p'
  cameraFixed?: boolean
  /** 设置页模型表里的键；不传走默认 */
  modelKey?: string
}

async function readJsonRes(res: Response) {
  try {
    return await res.json()
  } catch {
    throw new Error(`代理返回了非 JSON 响应（HTTP ${res.status}）`)
  }
}

/** 提交视频任务，返回任务 id（生成需要 1~4 分钟，不阻塞 HTTP） */
export async function startVideo(
  o: VideoOpts,
): Promise<{ id: string; mode?: 'ref' | 'first' | 'video'; skipped?: string[] }> {
  let res: Response
  try {
    res = await fetch('/api/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '提交失败')
  return { id: j.id as string, mode: j.mode, skipped: j.skipped }
}

/** 轮询直到出片；onTick 每次回调可用于刷新计时 */
export async function waitVideo(
  id: string,
  onTick?: (elapsedSec: number) => void,
  timeoutMs = 12 * 60 * 1000,
): Promise<{ url: string }> {
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    let j: any
    try {
      const r = await fetch(`/api/seedance?id=${encodeURIComponent(id)}`)
      j = await readJsonRes(r)
    } catch (e) {
      throw new Error((e as Error).message)
    }
    if (!j.ok) throw new Error(j.message || '查询失败')
    if (j.status === 'succeeded') return { url: j.url as string }
    if (j.status === 'failed') throw new Error(j.message || '生成失败')
    onTick?.(Math.round((Date.now() - t0) / 1000))
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时，可稍后重试')
  }
}

// ---------- animatic 合成 ----------

export type ExportSegment = {
  kind?: 'shot' | 'transition'
  seconds: number
  video?: string
  image?: string
  /** 转场片段按目标时长裁剪（仅首帧模型；首尾帧模型不裁） */
  trim?: number
  /** 音轨来源：tts = 单独配音；native = 视频自带音轨；none = 静音 */
  audioMode?: 'tts' | 'native' | 'none'
  voice?: string
  /** 配音相对镜头起点偏移（秒，可负） */
  voiceOffset?: number
  /** 字幕相对镜头起点偏移（秒）；仅旧调用兼容，新客户端用 captions */
  subOffset?: number
  /** 台词（旧调用兼容；新客户端用 captions，服务端不再据此推导字幕） */
  dialogue?: string
  /** 无 libass 时的兜底：整帧透明 PNG（dataURL）；仅旧调用兼容 */
  sub?: string
  /** 相对镜头起点的字幕 cue；有 captions 时服务端不再解析 dialogue */
  captions?: ExportCaption[]
}

export type ExportCaption = {
  startOffsetMs: number
  endOffsetMs: number
  text: string
  /** 无 libass 时该 cue 的整帧透明 PNG */
  sub?: string
}

/** 导出和预览共享的字幕样式参数 */
export type ExportCaptionStyle = {
  fontRatio: number
  bottomRatio: number
  maxWidthRatio: number
  lineHeight: number
  maxLines: number
  background: string
  textColor: string
}

/** 接缝：cut 直接拼；effect 用 xfade 重叠 T 秒。joins[0] 会被忽略。 */
export type ExportJoin =
  | { mode: 'cut' }
  | { mode: 'effect'; seconds: number; xfade?: string }

export type ExportResult = {
  url: string
  shots: number
  transitions?: number
  seconds: number
  voiced: number
  subbed: number
  /** 实际写入的字幕 cue 数 */
  captions?: number
  /** 与烧录一致的 SRT sidecar */
  srtUrl?: string
  /** 服务端对 cue 夹紧/丢弃的说明 */
  captionWarnings?: string[]
  overflows: { shot: number; voice: number; shotLen: number }[]
  /** 客户端统计：本次导出包含多少条失效的生成转场 */
  staleTransitions?: number
  elapsed: number
}

/** 把分镜序列交给 ffmpeg 拼成一条 mp4（静帧与视频混编） */
export async function assembleAnimatic(
  segments: ExportSegment[],
  resolution: '480p' | '720p' | '1080p',
  opts: {
    timeoutMs?: number
    joins?: ExportJoin[]
    staleTransitions?: number
    captionStyle?: ExportCaptionStyle
  } = {},
): Promise<ExportResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000
  const tid = startTask('export', `合成 ${resolution}`)
  let res: Response
  try {
    res = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments,
        resolution,
        ...(opts.joins ? { joins: opts.joins } : {}),
        ...(opts.captionStyle ? { captionStyle: opts.captionStyle } : {}),
      }),
    })
  } catch {
    endTask(tid, '连不上本地代理')
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) {
    endTask(tid, j.message || '提交合成失败')
    throw new Error(j.message || '提交合成失败')
  }

  const t0 = Date.now()
  try {
    for (;;) {
    await new Promise((r) => setTimeout(r, 1200))
    const r = await fetch(`/api/assemble?id=${encodeURIComponent(j.id)}`)
    const s = await readJsonRes(r)
    if (!s.ok) throw new Error(s.message || '查询合成状态失败')
    if (s.status === 'succeeded') {
      endTask(tid)
      return {
        url: s.url,
        shots: s.shots,
        transitions: s.transitions ?? 0,
        seconds: s.seconds,
        voiced: s.voiced ?? 0,
        subbed: s.subbed ?? 0,
        ...(typeof s.captions === 'number' ? { captions: s.captions } : {}),
        ...(s.srtUrl ? { srtUrl: String(s.srtUrl) } : {}),
        ...(Array.isArray(s.captionWarnings) ? { captionWarnings: s.captionWarnings.map(String) } : {}),
        overflows: s.overflows ?? [],
        staleTransitions: opts.staleTransitions ?? 0,
        elapsed: s.elapsed,
      }
    }
      if (s.status === 'failed') throw new Error(s.message || '合成失败')
      if (Date.now() - t0 > timeoutMs) throw new Error('合成超时')
    }
  } catch (e: any) {
    endTask(tid, String(e?.message || '合成失败'))
    throw e
  }
}

// ---------- 台词配音 ----------

export type VoiceResult = {
  url: string
  engine: string
  seconds: number
  elapsed: number
  /** 实际应用的表演参数名 */
  applied?: string[]
  /** 当前引擎不支持、已忽略的参数名 */
  unsupported?: string[]
}

export type VoiceLine = { text: string; voice?: string; rate?: number } & DialogueDelivery

export async function generateVoice(o: {
  /** 单句模式：传 text；多说话人模式：传 lines（每行可各自指定音色） */
  text?: string
  voice?: string
  rate?: number
  performance?: DialogueDelivery
  lines?: VoiceLine[]
  /** 传入项目名时把音频复制到项目媒体目录（角色音色样本） */
  project?: string
  purpose?: 'character-sample'
  /** 设置页模型表里的音频模型键；不传走默认 */
  modelKey?: string
}): Promise<VoiceResult> {
  let res: Response
  try {
    res = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '配音失败')
  return j as VoiceResult
}

export type LipSyncResult = {
  outputVideo: string
  provider: string
  jobId?: string
}

/** 手动提交单镜头口型；真实外部调用，调用方必须先确认。 */
export async function runLipSync(o: {
  project: string
  video: string
  audio: string
  model?: string
}): Promise<LipSyncResult> {
  const r = await fetch('/api/lipsync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(o),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '口型生成失败')
  return j as LipSyncResult
}

export type LipSyncQaResult = {
  duration: number
  silenceIntervals: { start: number; end: number }[]
  frames: {
    at: number
    kind: 'silence' | 'speech'
    expect: 'closed' | 'open'
    path: string
    mouth?: 'open' | 'closed' | 'unknown'
    advisory?: boolean
  }[]
  framesDir?: string
}

/** 本地抽帧验收；不上传视频，不调用外部 provider。 */
export async function runLipSyncQa(o: {
  video: string
  audio?: string
  noise?: string
  minSilence?: number
}): Promise<LipSyncQaResult> {
  const r = await fetch('/api/lipsync/qa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(o),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '口型验收失败')
  return j as LipSyncQaResult
}

export type VoiceOption = {
  id: string
  label: string
  voiceId?: string
  provider?: string
  providerKind?: string
  modelKey?: string
  source?: VoiceSource
  note?: string
}

export type VoiceList = {
  provider: string
  providerKind?: string
  modelKey?: string
  voices: VoiceOption[]
  capabilities?: VoiceCapabilities
  error?: string
}

/** 列出当前 TTS provider 下真正可用的音色 */
export async function listVoices(modelKey?: string, refresh = false): Promise<VoiceList> {
  try {
    const params = new URLSearchParams()
    if (modelKey) params.set('modelKey', modelKey)
    if (refresh) params.set('refresh', '1')
    const q = params.toString() ? `?${params.toString()}` : ''
    const r = await fetch(`/api/voices${q}`)
    const j = await readJsonRes(r)
    if (!j.ok) return { provider: 'none', voices: [] }
    return {
      provider: j.provider ?? 'unknown',
      providerKind: j.providerKind,
      modelKey: j.modelKey,
      voices: j.voices ?? [],
      capabilities: j.capabilities,
      error: j.error,
    }
  } catch {
    return { provider: 'none', voices: [] }
  }
}

// ---------------------------------------------------------------- 项目 / 文本

export type ProjectSummary = {
  name: string
  title: string
  style: string
  aspect: string
  episodes: number
  shots: number
  seconds: number
  broken?: boolean
}

export type ProjectShot = {
  id: string
  episode?: number
  no?: string
  seconds?: number
  size?: string
  move?: string
  desc?: string
  dialogue?: string | { speaker: string; text: string }[]
  keyframe_prompt?: string
  video_prompt?: string
  /** 手改的出片提示词快照；null = 明确恢复自动拼装 */
  video_prompt_override?: VideoPromptOverride | null
  /** 最近一次成功出片的提示词来源 */
  video_meta?: VideoMeta
  /** 该镜在画面内的角色名（拆镜产出，比从台词/描述猜准） */
  cast?: string[]
  /** 按角色分条的表演；旧项目为空 */
  performance?: PerformanceEntry[]
  /** 与 dialogue 行下标平行的台词表演 */
  dialogue_delivery?: DialogueDelivery[]
  /** 镜头音轨：off = 静音视频 + TTS，native = 视频自带音轨 */
  audio_mode?: 'off' | 'native'
  /** native 的唯一说话角色音色参考 */
  audio_ref?: { character: string; url: string; label?: string } | null
  /** native 请求指纹 */
  audio_meta?: { fingerprint: string; modelKey?: string; createdAt: string }
  /** 口型模式与结果；旧项目按 off 解释 */
  lip_sync?: LipSyncState
  /** 最近一次配音实际应用/未应用的表演参数 */
  voice_meta?: VoiceMeta
  /** 首帧图（本地相对路径，如 /generated/xxx.jpg） */
  keyframe?: string
  /** 成片视频（本地相对路径，如 /videos/xxx.mp4） */
  clip?: string
  handEdited?: string[]
  orphan?: boolean
  /** 手动附加参考图（场景图/道具图），生成画面时随角色图一起做多图参考 */
  refExtras?: string[]
  /** 参考连线节点的 id（角色卡/素材卡），生成画面时按它取参考图 */
  refIds?: string[]
  /** 到下一镜的转场配置（按目标 shotId 关联）；null = 明确清除 */
  transition_out?: TransitionOut | null
  /** 旧调度坐标；只用于迁移 */
  layout?: unknown
  /** 所属场次；同集同场共享 SceneLayout */
  scene_no?: number
  scene_slug?: string
  shot_scene?: ShotScene
  shot_scene_seed?: string
  visual_brief?: VisualBrief
  visual_brief_meta?: VisualBriefMeta
  shot_blocking?: ShotBlocking
  /** 代码优先 3D：每镜一段 Blender Python 代码 */
  scene_code?: SceneCode
  scene_code_meta?: SceneCodeMeta
  shot_3d_context?: Shot3DContext
  /** camelCase 兼容：旧项目/本地快照可能直接透传 */
  sceneCode?: SceneCode
  sceneCodeMeta?: SceneCodeMeta
  shot3DContext?: Shot3DContext
  schedule_meta?: ScheduleMeta
  schedule_video?: string
  schedule_frames?: string[]
  motion_note?: string
  /** @deprecated 3D 参考开关已移除；字段保留只为旧项目读写兼容 */
  use_schedule_frames?: boolean
  /** @deprecated 3D 参考开关已移除；字段保留只为旧项目读写兼容 */
  use_schedule_video_ref?: boolean
  /** 视频出片是否带说话角色表情单格；缺失按 false，避免旧项目自动占槽 */
  use_expression_ref?: boolean
}

export type ProjectEpisode = {
  no: number
  title?: string
  hook?: string
  scenes?: {
    no?: number
    slug?: string
    place?: string
    time?: string
    beats?: string
    characters?: string[]
    /** 冲突强度 0-10，拆镜时决定运镜条数 */
    intensity?: number
    /** 情绪基调，限一个词 */
    tone?: string
  }[]
}

export type ProjectAsset = {
  kind: string
  title: string
  url: string
  note?: string
  tags?: string[]
  /** 来自场景/道具设定卡的稳定标识；手工素材卡为空 */
  designId?: string
  /** expression-sheet 素材归属的角色名；普通素材为空 */
  characterName?: string
}

export type DesignKind = 'scene' | 'prop'

/** 场景/道具设定卡：画布发布前的真相源，和 characters 同属项目级设定 */
export type DesignSheet = {
  id: string
  kind: DesignKind
  name: string
  /** 出现过的镜号，如 E01-S03；同一地点/道具取并集 */
  refs: string[]
  summaryCn: string
  /** 英文生图锚点，定稿后逐字复用 */
  promptEn: string
  keywords: string[]
  image?: string
  candidates?: string[]
  activeIdx?: number
}

export type ProjectData = {
  name?: string
  logline?: string
  source?: string
  style?: string
  aspect?: string
  episodes?: ProjectEpisode[]
  characters?: unknown[]
  /** 素材库：场景 / 道具 / 参考图（画布素材卡的数据源） */
  assets?: ProjectAsset[]
  /** 场景/道具设定卡：发布前的工作区，不随 assets 整表回写 */
  designs?: DesignSheet[]
  /** 按集/场次复用的 3D 场景布局 */
  sceneLayouts?: SceneLayout[]
  shots?: ProjectShot[]
  updated_at?: string
  /** GET /api/project 附带：本次打开迁移了几张旧图、哪些引用文件缺失 */
  media?: { migrated?: number; missing?: string[] }
}

export async function listProjects(): Promise<{ root: string; projects: ProjectSummary[] }> {
  const r = await fetch('/api/project')
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取项目列表失败')
  return { root: j.root, projects: j.projects ?? [] }
}

export async function getProject(name: string): Promise<ProjectData> {
  const r = await fetch(`/api/project?name=${encodeURIComponent(name)}`)
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取项目失败')
  return j.project as ProjectData
}

export async function createProject(
  name: string,
  init?: { title?: string; style?: string; aspect?: string },
): Promise<void> {
  const r = await fetch(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(init ?? {}),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '新建项目失败')
}

export type ProjectPatch = {
  shots?: ProjectShot[]
  characters?: unknown[]
  designs?: DesignSheet[]
  sceneLayouts?: SceneLayout[]
  episodes?: unknown[]
  source?: string
  logline?: string
  style?: string
  aspect?: string
}

/** 局部回写：只传的字段会更新，未传的一律保留 */
export async function patchProject(
  name: string,
  patch: ProjectPatch,
): Promise<{ shots: ProjectShot[]; characters: unknown[]; savedAt: string }> {
  const r = await fetch(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存失败')
  return { shots: j.shots ?? [], characters: j.characters ?? [], savedAt: j.savedAt }
}

/** 只回写镜头的便捷形式 */
export async function mergeProjectShots(
  name: string,
  shots: ProjectShot[],
): Promise<{ shots: ProjectShot[]; savedAt: string }> {
  const r = await patchProject(name, { shots })
  return { shots: r.shots, savedAt: r.savedAt }
}

/** 场景布局是独立顶层数据：整表替换，不跟 episodes 一起被剧本站覆盖 */
export async function saveSceneLayouts(name: string, sceneLayouts: SceneLayout[]): Promise<void> {
  await patchProject(name, { sceneLayouts })
}

export async function saveProject(name: string, project: ProjectData): Promise<void> {
  const r = await fetch(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存失败')
}

export type ProviderToolCall = {
  id: string
  name: string
  /** provider 原始 JSON 字符串；由调用方解析 */
  arguments: string
}

export type ProviderChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: unknown[]
  tool_call_id?: string
  name?: string
}

export type ProviderToolCallDelta = {
  index: number
  id: string
  name: string
  delta: string
}

export type TextOpts = {
  system?: string
  /** 旧调用方式：system + prompt；与 messages 二选一 */
  prompt?: string
  /** 原生工具调用：完整对话消息（含 assistant.tool_calls / tool 角色） */
  messages?: ProviderChatMessage[]
  /** OpenAI function 工具定义 */
  tools?: unknown[]
  toolChoice?: string | Record<string, unknown>
  /** 设置页模型表里的键（优先级高于 model 档位） */
  modelKey?: string
  model?: 'lite' | 'pro'
  json?: boolean
  maxTokens?: number
  temperature?: number
  /** 编辑器取消生成时中止请求 */
  signal?: AbortSignal
}

export type TextResult<T = unknown> = {
  json?: T
  text: string
  model: string
  modelKey: string
  modelLabel: string
  /** provider 的结束原因；length 表示输出被长度上限截断 */
  finishReason?: string
  /** 原生工具调用（非流式/流式最终聚合） */
  toolCalls?: ProviderToolCall[]
  usage?: Record<string, unknown>
}

export async function callText<T = unknown>(o: TextOpts): Promise<TextResult<T>> {
  let res: Response
  const { signal, ...body } = o
  try {
    res = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    // 取消必须原样抛 AbortError，不能伪装成网络错误（内置动作靠它判断“已取消”）
    if ((e as Error)?.name === 'AbortError') throw e
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '文本生成失败')
  return {
    ...(j.json !== undefined ? { json: j.json as T } : {}),
    text: j.text ?? '',
    model: j.model ?? '',
    modelKey: j.modelKey ?? '',
    modelLabel: j.modelLabel ?? '',
    ...(j.finishReason ? { finishReason: String(j.finishReason) } : {}),
    ...(Array.isArray(j.toolCalls) ? { toolCalls: j.toolCalls as ProviderToolCall[] } : {}),
    ...(j.usage && typeof j.usage === 'object' ? { usage: j.usage as Record<string, unknown> } : {}),
  }
}

/**
 * 流式文本生成：代理按 SSE 发 meta/progress/done/error。
 * 渠道不支持流式时，代理会回退成整段 JSON，这里同样能解析。
 */
export async function callTextStream<T = unknown>(
  o: TextOpts & {
    onProgress?: (chars: number) => void
    onToolCallDelta?: (delta: ProviderToolCallDelta) => void
  },
): Promise<TextResult<T>> {
  const { signal, onProgress, onToolCallDelta, ...body } = o
  let res: Response
  try {
    res = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }

  const contentType = res.headers.get('content-type') || ''
  if (!res.ok || !res.body || !contentType.includes('text/event-stream')) {
    // 回退：整段 JSON（mock、渠道忽略 stream、或代理报错）
    const j = await readJsonRes(res)
    if (!j.ok) throw new Error(j.message || '文本生成失败')
    return {
      ...(j.json !== undefined ? { json: j.json as T } : {}),
      text: j.text ?? '',
      model: j.model ?? '',
      modelKey: j.modelKey ?? '',
      modelLabel: j.modelLabel ?? '',
      ...(j.finishReason ? { finishReason: String(j.finishReason) } : {}),
      ...(Array.isArray(j.toolCalls) ? { toolCalls: j.toolCalls as ProviderToolCall[] } : {}),
      ...(j.usage && typeof j.usage === 'object' ? { usage: j.usage as Record<string, unknown> } : {}),
    }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseEventParser()
  let meta = { model: '', modelKey: '', modelLabel: '' }
  let final:
    | {
        text: string
        json?: T
        finishReason?: string
        toolCalls?: ProviderToolCall[]
        usage?: Record<string, unknown>
      }
    | null = null

  while (!final) {
    const { done, value } = await reader.read()
    if (done) break
    for (const event of parser.push(decoder.decode(value, { stream: true }))) {
      const type = String(event.type || '')
      if (type === 'meta') {
        meta = {
          model: String(event.model || ''),
          modelKey: String(event.modelKey || ''),
          modelLabel: String(event.modelLabel || ''),
        }
      } else if (type === 'progress') {
        onProgress?.(Number(event.chars) || 0)
      } else if (type === 'tool_call_delta') {
        const id = String(event.id || '')
        if (id) {
          onToolCallDelta?.({
            index: Number(event.index) || 0,
            id,
            name: String(event.name || ''),
            delta: String(event.delta || ''),
          })
        }
      } else if (type === 'error') {
        throw new Error(String(event.message || '流式生成失败'))
      } else if (type === 'done') {
        meta = {
          model: String(event.model || meta.model),
          modelKey: String(event.modelKey || meta.modelKey),
          modelLabel: String(event.modelLabel || meta.modelLabel),
        }
        final = {
          text: String(event.text || ''),
          ...(event.json !== undefined ? { json: event.json as T } : {}),
          ...(event.finishReason ? { finishReason: String(event.finishReason) } : {}),
          ...(Array.isArray(event.toolCalls) ? { toolCalls: event.toolCalls as ProviderToolCall[] } : {}),
          ...(event.usage && typeof event.usage === 'object'
            ? { usage: event.usage as Record<string, unknown> }
            : {}),
        }
      }
    }
  }
  if (!final) throw new Error('流式响应提前结束')
  return {
    ...(final.json !== undefined ? { json: final.json } : {}),
    text: final.text,
    ...(final.finishReason ? { finishReason: final.finishReason } : {}),
    ...(final.toolCalls ? { toolCalls: final.toolCalls } : {}),
    ...(final.usage ? { usage: final.usage } : {}),
    ...meta,
  }
}

// ---------------------------------------------------------------- 视觉理解

export type VisionOpts = {
  system?: string
  prompt: string
  /** 带标签的参考板 dataURL；只允许 data:image */
  image: string
  modelKey?: string
  json?: boolean
  maxTokens?: number
  signal?: AbortSignal
}

/** 调用视觉模型理解参考板；没有配置视觉模型时由服务端返回明确错误 */
export async function askVision(
  o: VisionOpts,
): Promise<{ json?: unknown; text: string; model: string; modelKey: string; modelLabel: string }> {
  const { signal, ...body } = o
  let res: Response
  try {
    res = await fetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '视觉理解失败')
  return {
    json: j.json,
    text: j.text ?? '',
    model: j.model ?? '',
    modelKey: j.modelKey ?? '',
    modelLabel: j.modelLabel ?? '',
  }
}

export type VideoVisionOpts = {
  system?: string
  prompt: string
  /** 公网可访问的视频 URL；本地视频应回退关键帧 */
  video: string
  modelKey?: string
  json?: boolean
  maxTokens?: number
  signal?: AbortSignal
}

export async function askVideoVision(
  o: VideoVisionOpts,
): Promise<{ json?: unknown; text: string; model: string; modelKey: string; modelLabel: string }> {
  const { signal, ...body } = o
  let res: Response
  try {
    res = await fetch('/api/video-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '视频理解失败')
  return {
    json: j.json,
    text: j.text ?? '',
    model: j.model ?? '',
    modelKey: j.modelKey ?? '',
    modelLabel: j.modelLabel ?? '',
  }
}

// ---------------------------------------------------------------- 设置页

export type RulePack = { enabled: boolean; text: string }

export type Cap = 'text' | 'textPro' | 'vision' | 'videoVision' | 'image' | 'view' | 'video' | 'videoRef' | 'audio'
/** 生成环节：环节默认值只引用模型表键 */
export type Stage = 'script' | 'character' | 'asset' | 'shot' | 'prompt' | 'sceneCode' | 'vision' | 'videoVision'
export const STAGES: Stage[] = ['script', 'character', 'asset', 'shot', 'prompt', 'sceneCode', 'vision', 'videoVision']
export type ProviderKind =
  | 'ark'
  | 'ark-plan'
  | 'apimart'
  | 'openai'
  | 'minimax'
  | 'elevenlabs'
  | 'volc-tts'
export type ProviderCap = 'text' | 'image' | 'video' | 'audio'
export type Provider = {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  apiKey?: string
  note?: string
  /** 这个渠道能承接哪几类活 */
  caps?: ProviderCap[]
  /** 服务端只读：当前是否解析到 Key（不回传 Key 本身，保存时忽略） */
  keyAvailable?: boolean
}
export type ModelFeatureSet = {
  /** 支持图像输入 */
  vision?: boolean
  /** 支持视频输入 */
  videoInput?: boolean
  /** 参考图能力；none = 明确不支持 */
  imageRef?: 'none' | 'single' | 'multi'
  /** 支持参考视频 */
  videoRef?: boolean
  firstFrame?: boolean
  lastFrame?: boolean
  audioOut?: boolean
  tools?: boolean
}
export type ModelEntry = {
  key: string
  label: string
  cap: Cap
  /** 一个模型可服务多个能力；缺省时按 cap 的旧语义路由 */
  caps?: Cap[]
  provider: string
  model: string
  note?: string
  /** 这个模型能否把视频作为 reference_video（Seedance 2.0/2.5） */
  supportsVideoRef?: boolean
  /** 2.5 需要显式指定 reference；2.0 留空 */
  videoRefTaskType?: 'reference'
  /** DeepSeek Flash 混合推理：auto = 普通文本思考、JSON/工具协议关思考 */
  thinking?: 'auto' | 'enabled' | 'disabled'
  /** 目录/预设来源 */
  source?: 'preset' | 'catalog' | 'manual'
  /** 目录已登记但运行时尚未接入时不可选 */
  runtime?: 'ready' | 'catalog-only'
  /** 能力细节，供 UI 与服务端判定 */
  features?: ModelFeatureSet
}

export type LipSyncSettings = {
  provider: 'off' | 'sync-labs'
  baseUrl?: string
  apiKey?: string
  /** 估算用：每秒输出价格；0 = 不计入 */
  pricePerSecond?: number
}

export type AppSettings = {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  /** 每个生成环节绑定的默认模型键；空 = 沿用 defaults.text */
  stageModels?: Partial<Record<Stage, string>>
  /** 计价单价（估算，可校准） */
  pricing?: { image?: number; video480?: number; video720?: number; audio?: number }
  /** 3D agent 的运行上限；缺省使用默认值 */
  agentLimits?: AgentLimitSettings
  /**
   * 3D agent 的工具协议：auto 按模型能力表选择，native 强制原生 tool calls，json 强制 JSON action。
   * 缺省 auto；不支持 tools 的模型在 auto 下继续走 JSON。
   */
  agentToolProtocol?: 'auto' | 'native' | 'json'
  /** 口型 provider；默认关闭，Key 只存设置库 */
  lipSync?: LipSyncSettings
  /** 设置库里的自定义音色条目 */
  customVoices?: CustomVoice[]
  apiKey: string
  rules: Record<string, RulePack>
  /** 旧规则包已迁移为技能覆盖；避免重复迁移 */
  skillsMigrated?: boolean
  presetsVersion?: number
}

export async function getSettings(): Promise<{ settings: AppSettings; db?: string }> {
  const r = await fetch('/api/settings')
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取设置失败')
  return { settings: j.settings as AppSettings, db: j.db }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const r = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存设置失败')
  return j.settings as AppSettings
}

// ---------------------------------------------------------------- 渠道测试

export type ProviderTestResult = {
  ok: boolean
  kind?: 'ok' | 'no-key' | 'auth' | 'billing' | 'api' | 'net' | 'config' | 'plan'
  status?: number
  latency?: number
  endpoint?: string
  message?: string
}

/** 用一个最轻的请求验证渠道的 Key / baseUrl / 首个文本模型是否可用 */
export async function testProvider(id: string, provider?: Provider): Promise<ProviderTestResult> {
  try {
    const r = await fetch('/api/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, provider }),
    })
    return (await readJsonRes(r)) as ProviderTestResult
  } catch (e) {
    return { ok: false, kind: 'net', message: (e as Error).message }
  }
}

/** 已生成的视频（public/videos），用于把本地视频挂到镜头 */
export type VideoFile = { name: string; url: string; size: number; mtime: number }

export async function listVideoFiles(): Promise<VideoFile[]> {
  try {
    const r = await fetch('/api/videos')
    const j = await readJsonRes(r)
    return j.ok ? ((j.videos ?? []) as VideoFile[]) : []
  } catch {
    return []
  }
}

/** 项目可用素材：生成的图 / 视频 / assets 表里的条目（素材卡选地址用） */
export type MediaItem = { name: string; url: string; size: number; mtime: number }
export type ProjectAssetItem = { kind: string; title: string; url: string; note?: string }
export type MediaBundle = { images: MediaItem[]; videos: MediaItem[]; assets: ProjectAssetItem[] }

export async function listMedia(projectName: string): Promise<MediaBundle> {
  try {
    const r = await fetch(`/api/media?name=${encodeURIComponent(projectName)}`)
    const j = await readJsonRes(r)
    if (!j.ok) return { images: [], videos: [], assets: [] }
    return { images: j.images ?? [], videos: j.videos ?? [], assets: j.assets ?? [] }
  } catch {
    return { images: [], videos: [], assets: [] }
  }
}

/** 保存浏览器录制的调度视频（webm dataURL），后端转 mp4 后返回站内路径 */
export async function saveScheduleVideo(
  dataUrl: string,
  signal?: AbortSignal,
  duration?: number,
): Promise<string> {
  const r = await fetch('/api/save-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl, ...(duration && duration > 0 ? { duration } : {}) }),
    signal,
  }).then((x) => x.json())
  if (!r.ok) throw new Error(r.message || '调度视频保存失败')
  return r.url as string
}

/** 从调度视频抽关键帧，供出片时作结构性参考 */
export async function extractFrames(
  video: string,
  count = 3,
  signal?: AbortSignal,
  times?: number[],
): Promise<{ urls: string[]; duration: number; times: number[] }> {
  const r = await fetch('/api/frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video, count, ...(times?.length ? { times } : {}) }),
    signal,
  }).then((x) => x.json())
  if (!r.ok) throw new Error(r.message || '抽帧失败')
  return {
    urls: (r.urls ?? []) as string[],
    duration: Number(r.duration) || 0,
    times: Array.isArray(r.times) ? r.times.map(Number) : [],
  }
}
