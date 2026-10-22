import { endTask, startTask } from './tasks'
export type GenResult = {
  urls: string[]
  url: string
  size: string
  elapsed: number
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
}): Promise<GenResult> {
  let res: Response
  try {
    res = await fetch('/api/seedream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }

  let j: any
  try {
    j = await res.json()
  } catch {
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
  /** 多参考图模式（方舟 reference_image，1~4 张）；有值时忽略 image */
  refImages?: string[]
  /** 3D 调度视频参考（方舟 reference_video，1~3 段）；有值时进入全模态参考模式 */
  refVideos?: string[]
  prompt: string
  seconds: number
  ratio: string
  resolution?: '480p' | '720p'
  cameraFixed?: boolean
  /** 设置页模型表里的键；不传走默认 */
  modelKey?: string
  /** 尾帧约束（首帧模式生效）：让本镜落在指定构图上，衔接下一镜 */
  lastFrame?: string
  /** 让模型回传真实尾帧（默认 true），用于下一镜首帧 */
  returnLastFrame?: boolean
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
): Promise<{ url: string; tail?: string }> {
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
    if (j.status === 'succeeded') return { url: j.url as string, tail: j.tail as string | undefined }
    if (j.status === 'failed') throw new Error(j.message || '生成失败')
    onTick?.(Math.round((Date.now() - t0) / 1000))
    if (Date.now() - t0 > timeoutMs) throw new Error('等待超时，可稍后重试')
  }
}

// ---------- animatic 合成 ----------

export type ExportSegment = {
  seconds: number
  video?: string
  image?: string
  voice?: string
  /** 配音相对镜头起点偏移（秒，可负） */
  voiceOffset?: number
  /** 字幕相对镜头起点偏移（秒） */
  subOffset?: number
  /** 台词（服务端有 libass 时据此生成 SRT） */
  dialogue?: string
  /** 无 libass 时的兜底：整帧透明 PNG（dataURL） */
  sub?: string
}

export type ExportResult = {
  url: string
  shots: number
  seconds: number
  voiced: number
  subbed: number
  overflows: { shot: number; voice: number; shotLen: number }[]
  elapsed: number
}

/** 把分镜序列交给 ffmpeg 拼成一条 mp4（静帧与视频混编） */
export async function assembleAnimatic(
  segments: ExportSegment[],
  resolution: '480p' | '720p' | '1080p',
  timeoutMs = 10 * 60 * 1000,
): Promise<ExportResult> {
  const tid = startTask('export', `合成 ${resolution}`)
  let res: Response
  try {
    res = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments, resolution }),
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
        seconds: s.seconds,
        voiced: s.voiced ?? 0,
        subbed: s.subbed ?? 0,
        overflows: s.overflows ?? [],
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

export type VoiceResult = { url: string; engine: string; seconds: number; elapsed: number }

export type VoiceLine = { text: string; voice?: string; rate?: number }

export async function generateVoice(o: {
  /** 单句模式：传 text；多说话人模式：传 lines（每行可各自指定音色） */
  text?: string
  voice?: string
  rate?: number
  lines?: VoiceLine[]
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

export type VoiceOption = { id: string; label: string }
export type VoiceList = { provider: string; voices: VoiceOption[] }

/** 列出当前 TTS provider 下真正可用的音色 */
export async function listVoices(modelKey?: string): Promise<VoiceList> {
  try {
    const q = modelKey ? `?modelKey=${encodeURIComponent(modelKey)}` : ''
    const r = await fetch(`/api/voices${q}`)
    const j = await readJsonRes(r)
    if (!j.ok) return { provider: 'none', voices: [] }
    return { provider: j.provider ?? 'unknown', voices: j.voices ?? [] }
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
  /** 该镜在画面内的角色名（拆镜产出，比从台词/描述猜准） */
  cast?: string[]
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
  /** 本镜真实尾帧（本地路径），用于下一镜首帧接龙 */
  tail_image?: string
  /** 调度坐标（站位 + 机位）：只作为 3D 调度视频的输入 */
  layout?: unknown
  schedule_video?: string
  schedule_frames?: string[]
  motion_note?: string
  use_schedule_frames?: boolean
  /** 出片时把调度视频本身当 reference_video（需 Seedance 2.0+） */
  use_schedule_video_ref?: boolean
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

export async function saveProject(name: string, project: ProjectData): Promise<void> {
  const r = await fetch(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存失败')
}

export type TextOpts = {
  system?: string
  prompt: string
  /** 设置页模型表里的键（优先级高于 model 档位） */
  modelKey?: string
  model?: 'lite' | 'pro'
  json?: boolean
  maxTokens?: number
  temperature?: number
}

export async function callText<T = unknown>(
  o: TextOpts,
): Promise<{ json?: T; text: string; model: string; modelKey: string; modelLabel: string }> {
  let res: Response
  try {
    res = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '文本生成失败')
  return {
    json: j.json as T,
    text: j.text ?? '',
    model: j.model ?? '',
    modelKey: j.modelKey ?? '',
    modelLabel: j.modelLabel ?? '',
  }
}

// ---------------------------------------------------------------- 设置页

export type RulePack = { enabled: boolean; text: string }

export type Cap = 'text' | 'textPro' | 'image' | 'view' | 'video' | 'videoRef' | 'audio'
/** 生成环节：环节默认值只引用模型表键 */
export type Stage = 'script' | 'character' | 'asset' | 'shot' | 'prompt'
export const STAGES: Stage[] = ['script', 'character', 'asset', 'shot', 'prompt']
export type ProviderKind = 'ark' | 'ark-plan' | 'openai' | 'minimax' | 'elevenlabs' | 'volc-tts'
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
}
export type ModelEntry = {
  key: string
  label: string
  cap: Cap
  provider: string
  model: string
  note?: string
  /** 这个模型能否把视频作为 reference_video（Seedance 2.0/2.5） */
  supportsVideoRef?: boolean
  /** 2.5 需要显式指定 reference；2.0 留空 */
  videoRefTaskType?: 'reference'
}

export type AppSettings = {
  providers: Provider[]
  models: ModelEntry[]
  defaults: Partial<Record<Cap, string>>
  /** 每个生成环节绑定的默认模型键；空 = 沿用 defaults.text */
  stageModels?: Partial<Record<Stage, string>>
  /** 计价单价（估算，可校准） */
  pricing?: { image?: number; video480?: number; video720?: number; audio?: number }
  apiKey: string
  rules: Record<string, RulePack>
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
  kind?: 'ok' | 'no-key' | 'auth' | 'api' | 'net'
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
export async function saveScheduleVideo(dataUrl: string): Promise<string> {
  const r = await fetch('/api/save-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  }).then((x) => x.json())
  if (!r.ok) throw new Error(r.message || '调度视频保存失败')
  return r.url as string
}

/** 从调度视频抽关键帧，供出片时作结构性参考 */
export async function extractFrames(video: string, count = 3): Promise<{ urls: string[]; duration: number }> {
  const r = await fetch('/api/frames', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video, count }),
  }).then((x) => x.json())
  if (!r.ok) throw new Error(r.message || '抽帧失败')
  return { urls: (r.urls ?? []) as string[], duration: Number(r.duration) || 0 }
}
