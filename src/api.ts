import { endTask, startTask } from './tasks'
import { SseEventParser } from './textStream'
import type { AgentLimitSettings } from './agent/agentLimits'
import type { CreativeSettings } from './creative/settings'
import type { StockSettings } from './stock/types'
import type { CustomVoice, VoiceCapabilities, VoiceEntry, VoiceSource } from './voiceCatalog'
export type { CustomVoice, VoiceCapabilities, VoiceEntry, VoiceSource } from './voiceCatalog'
import type {
  DialogueDelivery,
  LipSyncState,
  PerformanceEntry,
  TransitionOut,
  VisualBrief,
  VisualBriefMeta,
  VideoMeta,
  VideoPromptOverride,
  VideoPromptRenderMeta,
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

/** 同源代理请求携带计费会话 Cookie（sb_session） */
function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: 'include' })
}

type ProxyErrBody = { message?: string; kind?: string; code?: string }

/** 上下文超限的可操作出路：历史不丢，新建会话即可继续 */
export const CONTEXT_OVERFLOW_HINT = '本次会话上下文已满，建议新建会话（历史仍保留在侧栏）。'

/**
 * 上游错误转异常：context-overflow 换成可操作说明（原始报文留在 detail 供排查），
 * 其余 kind 保持原有呈现。
 */
function textStreamError(message: string, kind: string): Error & { kind?: string; detail?: string } {
  const err = new Error(kind === 'context-overflow' ? CONTEXT_OVERFLOW_HINT : message) as Error & {
    kind?: string
    detail?: string
  }
  if (kind) err.kind = kind
  if (kind === 'context-overflow') err.detail = message
  return err
}

/** 代理 402/401 等可读说明（平台计费 / 登录） */
function proxyErrorMessage(j: ProxyErrBody, fallback: string): string {
  const base = j.message || fallback
  if (j.kind === 'billing') {
    if (j.code === 'user_insufficient_credits') return `${base}（平台积分不足，请到「账号与充值」页充值）`
    if (j.code === 'upstream_apimart_balance') return `${base}（上游 APIMart 余额不足，请联系管理员）`
    return base
  }
  if (j.kind === 'auth') {
    // 账号页是全局视图（项目大厅顶栏进入），不再位于项目侧栏
    if (j.code === 'login_required') return `${base}（请先在「账号与充值」页登录）`
    if (j.code === 'email_unverified') return `${base}（请先完成邮箱验证）`
    if (j.code) return base
    return `${base}（密钥无效）`
  }
  if (j.kind === 'no-key') return base
  return base
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
      res = await apiFetch('/api/seedream', {
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

    if (!j.ok) throw new Error(proxyErrorMessage(j, j.message || '图片生成失败'))
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
  const r = await apiFetch('/api/save-image', {
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
    const r = await apiFetch('/api/health')
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
  /** 参考视频（方舟 reference_video，1~3 段）；有值时进入全模态参考模式 */
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
    /** keyframe | morph；morph 时首帧=上一镜尾、尾帧=下一镜首 */
    bridging?: 'keyframe' | 'morph'
  }
  prompt: string
  seconds: number
  ratio: string
  resolution?: '480p' | '720p'
  cameraFixed?: boolean
  /** 设置页模型表里的键；不传走默认 */
  modelKey?: string
  /** 出片成功后服务端直接写回分镜 clip */
  project?: string
  shotId?: string
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
): Promise<{ id: string; mode?: 'ref' | 'first' | 'video'; skipped?: string[]; prompt?: string }> {
  let res: Response
  try {
    res = await apiFetch('/api/seedance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(proxyErrorMessage(j, '提交失败'))
  return { id: j.id as string, mode: j.mode, skipped: j.skipped, prompt: j.prompt }
}

/** 轮询直到出片；onTick 每次回调可用于刷新计时 */
function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 上游已完成时，凭 task_id 下载成片（不重新提交生成） */
export async function recoverVideo(body: {
  upstreamTaskId: string
  modelKey?: string
  providerKind?: 'apimart' | 'ark'
}): Promise<{ url: string }> {
  let res: Response
  try {
    res = await apiFetch('/api/seedance/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(j.message || '拉取成片失败')
  return { url: String(j.url || '') }
}

export async function waitVideo(
  id: string,
  onTick?: (elapsedSec: number) => void,
  timeoutMs = 12 * 60 * 1000,
  signal?: AbortSignal,
): Promise<{ url: string }> {
  const t0 = Date.now()
  for (;;) {
    if (signal?.aborted) throw abortError()
    await sleepMs(3000, signal)
    let j: any
    try {
      const r = await apiFetch(`/api/seedance?id=${encodeURIComponent(id)}`)
      j = await readJsonRes(r)
    } catch (e) {
      throw new Error((e as Error).message)
    }
    if (!j.ok) throw new Error(j.message || '查询失败')
    if (j.status === 'succeeded') return { url: j.url as string }
    if (j.status === 'failed') {
      const parts = [String(j.message || '生成失败').trim()]
      const upstream = String(j.taskId || '').trim()
      if (upstream) parts.push(`上游 task_id：${upstream}`)
      const err = new Error(parts.filter(Boolean).join('\n'))
      if (upstream) (err as Error & { upstreamTaskId?: string }).upstreamTaskId = upstream
      throw err
    }
    onTick?.(Math.round((Date.now() - t0) / 1000))
    if (Date.now() - t0 > timeoutMs) {
      const upstream = String(j.taskId || '').trim()
      const err = new Error(
        upstream
          ? `等待超时，可点「重新拉取成片」\n上游 task_id：${upstream}`
          : '等待超时，可稍后重试',
      )
      if (upstream) (err as Error & { upstreamTaskId?: string }).upstreamTaskId = upstream
      throw err
    }
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
    /** 成片归属；用于服务端合成任务标题 */
    project?: string
    episode?: number
    title?: string
  } = {},
): Promise<ExportResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000
  const tid = startTask('export', `合成 ${resolution}`)
  let res: Response
  try {
    res = await apiFetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segments,
        resolution,
        ...(opts.joins ? { joins: opts.joins } : {}),
        ...(opts.captionStyle ? { captionStyle: opts.captionStyle } : {}),
        ...(opts.project ? { project: opts.project } : {}),
        ...(opts.episode ? { episode: opts.episode } : {}),
        ...(opts.title ? { title: opts.title } : {}),
      }),
    })
  } catch {
    endTask(tid, '连不上本地代理')
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) {
    const msg = proxyErrorMessage(j, '提交合成失败')
    endTask(tid, msg)
    throw new Error(msg)
  }

  const t0 = Date.now()
  try {
    for (;;) {
    await new Promise((r) => setTimeout(r, 1200))
    const r = await apiFetch(`/api/assemble?id=${encodeURIComponent(j.id)}`)
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

export type VoiceLine = { text: string; voice?: string; rate?: number; modelKey?: string } & DialogueDelivery

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
    res = await apiFetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(o),
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(proxyErrorMessage(j, '配音失败'))
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
  const r = await apiFetch('/api/lipsync', {
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
  const r = await apiFetch('/api/lipsync/qa', {
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
    const r = await apiFetch(`/api/voices${q}`)
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

const voiceListCache = new Map<string, VoiceList>()

/** 按 modelKey 缓存音色列表；角色板多卡共用同一渠道时少打 /api/voices */
export async function listVoicesCached(modelKey?: string, refresh = false): Promise<VoiceList> {
  const cacheKey = String(modelKey || '').trim()
  if (refresh) voiceListCache.delete(cacheKey)
  const hit = voiceListCache.get(cacheKey)
  if (hit) return hit
  const list = await listVoices(modelKey, refresh)
  voiceListCache.set(cacheKey, list)
  return list
}

export function clearVoiceListCache() {
  voiceListCache.clear()
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
  /** 最后写入时间；用于项目管理列表排序与展示 */
  updated_at?: string
  /** 第一张非空首帧（大厅卡片封面） */
  cover?: string
  /** 服务端判定的损坏项目：入口禁用 */
  broken?: boolean
  /** 缺首帧 / 缺锚点 / 空项目；服务端健康计算失败时不返回 */
  health?: { empty: boolean; missing_keyframe: number; missing_anchor: number }
}

export type ProjectShot = {
  id: string
  /** 生图镜 image / 出片镜 video */
  prod_kind?: 'image' | 'video'
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
  video_prompt_rendered?: string | null
  video_prompt_render_meta?: VideoPromptRenderMeta | null
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
  /** 音色参考；character 缺失表示手选素材或手工地址 */
  audio_ref?: { character?: string; url: string; label?: string; source?: 'character' | 'asset' | 'manual' } | null
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
  /** 一次性解锁信号：本次提交要从 handEdited 移除的字段。不落库，只用于「交由模型重写」这类动作 */
  handEditedUnlocked?: string[]
  orphan?: boolean
  /** 手动附加参考图（场景图/道具图），生成画面时随角色图一起做多图参考 */
  refExtras?: string[]
  /** 参考连线节点的 id（角色卡/素材卡），生成画面时按它取参考图 */
  refIds?: string[]
  /** 到下一镜的转场配置（按目标 shotId 关联）；null = 明确清除 */
  transition_out?: TransitionOut | null
  /** 所属场次 */
  scene_no?: number
  scene_slug?: string
  visual_brief?: VisualBrief
  visual_brief_meta?: VisualBriefMeta
  motion_note?: string
  /** 绑定的镜头语言条目 key；空则未绑定，不从 move/size 反推 */
  lexicon_ref_key?: string | null
  /** 该条目导入项目后的视频地址；未导入过则为空 */
  lexicon_ref_url?: string | null
  /** 为 true 时把 lexicon_ref_url 作为运镜参考视频提交 */
  motion_lexicon_as_ref?: boolean
  /** 视频出片是否带说话角色表情单格；缺失按 false，避免旧项目自动占槽 */
  use_expression_ref?: boolean
  /**
   * 出图候选（画布态的产物列表）。
   * shots 表没有专列，服务端把它原样收进 shots.extra 落库，读项目时展开。
   */
  candidates?: string[]
}

export type ProjectEpisode = {
  no: number
  title?: string
  hook?: string
  /** 该集成片目标时长（秒）；各集可不同 */
  targetSeconds?: number
  scenes?: {
    no?: number
    slug?: string
    /** 场次空间（内 / 外 / 内外），由剧本 Markdown 场标题解析 */
    space?: string
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

export type Cc0PropEntry = {
  id: string
  title: string
  source: string
  license?: string
  categories?: string[]
  /** 家具侧的分组：seat / bed / table / storage / soft / decor / plant / light / kitchen / bath / laundry */
  group?: string
  url: string
}

export type Cc0PropManifest = {
  schemaVersion: number
  source?: string
  license?: string
  updatedAt?: string
  vendorReady?: boolean
  /** Grab3D 人形分镜 GLB 是否已全部在 vendor */
  charactersReady?: boolean
  /** Grab3D 写实动物 GLB 是否已全部在 vendor */
  animalsReady?: boolean
  /** Grab3D 布景家具补库 GLB 是否已全部在 vendor */
  furnitureReady?: boolean
  samples: Cc0PropEntry[]
}

export async function fetchCc0PropsManifest(): Promise<Cc0PropManifest> {
  const res = await apiFetch('/api/cc0-props')
  const j = (await res.json()) as Cc0PropManifest & { ok?: boolean }
  if (!j.ok) return { schemaVersion: 1, samples: [] }
  return j
}

export type ItchPropEntry = {
  id: string
  title: string
  pack: string
  license?: string
  itchUrl?: string
  categories?: string[]
  url: string
}

export type ItchPropManifest = {
  schemaVersion: number
  source?: string
  license?: string
  updatedAt?: string
  vendorReady?: boolean
  samples: ItchPropEntry[]
}

export async function fetchItchPropsManifest(): Promise<ItchPropManifest> {
  const res = await apiFetch('/api/itch-props')
  const j = (await res.json()) as ItchPropManifest & { ok?: boolean }
  if (!j.ok) return { schemaVersion: 1, samples: [] }
  return j
}

export async function importItchPropToProject(opts: {
  project: string
  url: string
  title?: string
}): Promise<{ url: string; title: string; kind: string; note?: string }> {
  const res = await apiFetch('/api/itch-props/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const j = (await res.json()) as { ok?: boolean; message?: string; url?: string; title?: string; kind?: string; note?: string }
  if (!j.ok || !j.url) throw new Error(j.message || '导入 itch 道具失败')
  return { url: j.url, title: j.title || opts.title || 'itch 道具', kind: j.kind || 'model', note: j.note }
}

export async function importCc0PropToProject(opts: {
  project: string
  url: string
  title?: string
}): Promise<{ url: string; title: string; kind: string; note?: string }> {
  const res = await apiFetch('/api/cc0-props/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const j = (await res.json()) as { ok?: boolean; message?: string; url?: string; title?: string; kind?: string; note?: string }
  if (!j.ok || !j.url) throw new Error(j.message || '导入 CC0 道具失败')
  return { url: j.url, title: j.title || opts.title || 'CC0 道具', kind: j.kind || 'model', note: j.note }
}

export type ProjectAsset = {
  kind: string
  title: string
  url: string
  /** 图片/音频素材卡生成提示词 */
  prompt?: string
  /** 图片素材卡接受的参考连线（画布节点 id） */
  refIds?: string[]
  note?: string
  tags?: string[]
  /** 来自场景/道具设定卡的稳定标识；手工素材卡为空 */
  designId?: string
  /** expression-sheet 素材归属的角色名；普通素材为空 */
  characterName?: string
  /**
   * 画布身份（稳定 UUID）。画布节点 id 由它派生（`asset-<canvasId>`），
   * `shot.refIds` 里的 `asset-<canvasId>` 也指向它；标题改名不会改变它。
   * 首次进画布时生成一次并随素材卡落库；旧数据为空时由前端补写。
   */
  canvasId?: string
  /** 成片帧溯源：业务镜 id（如 E01-S01） */
  sourceShotId?: string
  /** 成片首帧或尾帧 */
  frameRole?: 'head' | 'tail'
  /** 抽取时来源成片的指纹（路径哈希） */
  sourceClipFingerprint?: string
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

/**
 * 画布节点几何（服务端 `canvas_layouts` 的一行）。
 * key 只有两种形态：`shot:<shotId>` / `asset:<canvasId>`。
 */
export type ProjectCanvasSpot = { key: string; x: number; y: number }

export type NarratorVoice = {
  modelKey: string
  voiceId: string
}

export type ProjectData = {
  name?: string
  logline?: string
  source?: string
  style?: string
  aspect?: string
  /** 画布旁白 TTS 声线（项目级，不进角色卡） */
  narratorVoice?: NarratorVoice
  episodes?: ProjectEpisode[]
  characters?: unknown[]
  /** 素材库：场景 / 道具 / 参考图（画布素材卡的数据源） */
  assets?: ProjectAsset[]
  /** 画布节点位置：随项目落库，本地只剩边与集号缓存 */
  canvas?: ProjectCanvasSpot[]
  /** 场景/道具设定卡：发布前的工作区，不随 assets 整表回写 */
  designs?: DesignSheet[]
  /** 素材·镜头语言：项目级自定义白模（Blender 代码 + 渲染 MP4） */
  lexiconWhitebox?: import('./lexiconWhitebox').LexiconWhiteboxSheet[]
  /** 素材·场景三维：Babylon 编排场景（立板 / GLB / 机位书签） */
  material3dScenes?: import('./material3d/material3dTypes').Material3dScene[]
  shots?: ProjectShot[]
  /** 落库单调序：每次 POST/PUT 写项目 +1，供创意读工具与画布实况对齐 */
  revision?: number
  updated_at?: string
  /** GET /api/project 附带：本次打开迁移了几张旧图、哪些引用文件缺失 */
  media?: { migrated?: number; missing?: string[] }
  /** 生图镜已迁成素材卡（一次性迁移标记） */
  imageShotsToAssetCards?: boolean
}

export async function listProjects(): Promise<{ root: string; projects: ProjectSummary[] }> {
  const r = await apiFetch('/api/project')
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取项目列表失败')
  return { root: j.root, projects: j.projects ?? [] }
}

export async function getProject(name: string): Promise<ProjectData> {
  const r = await apiFetch(`/api/project?name=${encodeURIComponent(name)}`)
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取项目失败')
  return j.project as ProjectData
}

export async function createProject(
  name: string,
  init?: { title?: string; style?: string; aspect?: string },
): Promise<void> {
  const r = await apiFetch(`/api/project?name=${encodeURIComponent(name)}&create=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(init ?? {}),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '新建项目失败')
}

/** 删除预览：不存在的项目返回 exists:false，不抛错 */
export type ProjectDeletePreview = {
  ok: true
  name: string
  exists: boolean
  counts: Record<string, number>
  mediaBytes: number
  activeJobs: ProjectDeleteJob[]
}

export type ProjectDeleteJob = {
  id: string
  platform: string
  state: string
  deliverableId: string
  createdAt: string
}

export type ProjectDeleteResult = {
  name: string
  ok: boolean
  code?: 'not_found' | 'active_jobs' | 'snapshot_failed' | 'delete_failed' | 'error'
  message?: string
  jobs?: ProjectDeleteJob[]
  snapshot?: string
  filesRemoved?: boolean
  sharedFilesKept?: boolean
  warnings?: string[]
}

export async function previewProjectDelete(name: string): Promise<ProjectDeletePreview> {
  const r = await apiFetch(`/api/project?name=${encodeURIComponent(name)}&preview=delete`)
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取删除预览失败')
  return j as ProjectDeletePreview
}

/** 批量预览：一次请求算完所有选中项，避免几百个并发请求 */
export async function previewProjectDeletes(names: string[]): Promise<ProjectDeletePreview[]> {
  if (!names.length) return []
  const r = await apiFetch('/api/project?preview=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取删除预览失败')
  return (j.items ?? []) as ProjectDeletePreview[]
}

/**
 * 删除一批项目。批量接口即使部分失败也返回 200，调用方按 results 逐项处理。
 * 名字走请求体而不是查询串：没有数量上限，几百个项目名放 URL 会被长度限制截断。
 */
export async function deleteProjects(names: string[]): Promise<{
  ok: true
  results: ProjectDeleteResult[]
  deleted: string[]
  sharedFilesKept: true
}> {
  const r = await apiFetch('/api/project', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '删除项目失败')
  return j
}

export type ProjectPatch = {
  shots?: ProjectShot[]
  /**
   * 镜头写回模式：
   * - `partial`（缺省）：本次只是「要改的那几条」，其余镜头原样保留、不标 orphan。
   * - `full`：本次声明为「当前全集」，缺席的既有镜头保留并标 orphan（保护性保留，不删）。
   */
  shotsMode?: 'partial' | 'full'
  /** 显式删除这些镜头 id（缺席不等于删除：缺席只标 orphan） */
  deleteShotIds?: string[]
  characters?: unknown[]
  assets?: ProjectAsset[]
  /** 逐行写入画布位置（按 key upsert）；不传即保留既有布局 */
  canvas?: ProjectCanvasSpot[]
  /** 按 key 删除画布位置（删素材卡时用）；与 canvas 同 key 时以删除为准 */
  canvasDelete?: string[]
  designs?: DesignSheet[]
  lexiconWhitebox?: import('./lexiconWhitebox').LexiconWhiteboxSheet[]
  material3dScenes?: import('./material3d/material3dTypes').Material3dScene[]
  episodes?: unknown[]
  /** 生图镜已迁出素材卡（只写 true，一次迁移） */
  imageShotsToAssetCards?: boolean
  source?: string
  logline?: string
  style?: string
  aspect?: string
  /** 项目标题（显示名）；目录名不随之改变 */
  title?: string
  narratorVoice?: NarratorVoice
}

/** 局部回写：只传的字段会更新，未传的一律保留 */
export async function patchProject(
  name: string,
  patch: ProjectPatch,
): Promise<{ shots: ProjectShot[]; characters: unknown[]; savedAt: string; revision?: number }> {
  const r = await apiFetch(`/api/project?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存失败')
  return {
    shots: j.shots ?? [],
    characters: j.characters ?? [],
    savedAt: j.savedAt,
    revision: typeof j.revision === 'number' ? j.revision : undefined,
  }
}

export type ShotWriteMode = 'partial' | 'full'

export type MergeShotsOpts = {
  deleteShotIds?: string[]
  /** 缺省 partial：只改提交的镜，其余不标 orphan */
  mode?: ShotWriteMode
}

/**
 * 只回写镜头的便捷形式。
 *
 * `mode` 决定服务端怎么对待「这次没提交的镜头」：
 * - `partial`（缺省）：只改提交的镜，其余原样保留。单镜写回、画布防抖、导入子集都走它。
 * - `full`：声明本次是全集，缺席的既有镜头会被标 orphan（保护性保留，不删）。
 */
export async function mergeProjectShots(
  name: string,
  shots: ProjectShot[],
  opts: MergeShotsOpts = {},
): Promise<{ shots: ProjectShot[]; savedAt: string; revision?: number }> {
  const mode = opts.mode ?? 'partial'
  const deleteShotIds = opts.deleteShotIds
  const r = await patchProject(name, {
    shots,
    shotsMode: mode,
    ...(deleteShotIds?.length ? { deleteShotIds } : {}),
  })
  return { shots: r.shots, savedAt: r.savedAt, revision: r.revision }
}

/** 场景布局是独立顶层数据：整表替换，不跟 episodes 一起被剧本站覆盖 */
export async function saveProject(name: string, project: ProjectData): Promise<void> {
  const r = await apiFetch(`/api/project?name=${encodeURIComponent(name)}`, {
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

export type ProviderContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string; label?: string }

export type ProviderChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /** 纯文本，或同一条用户消息里的文字与图片块 */
  content: string | ProviderContentPart[]
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
    res = await apiFetch('/api/text', {
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
  if (!j.ok) throw new Error(proxyErrorMessage(j, '文本生成失败'))
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
    /** 正文增量：与 onProgress 同时到，但带内容 */
    onTextDelta?: (delta: string) => void
    onToolCallDelta?: (delta: ProviderToolCallDelta) => void
  },
): Promise<TextResult<T>> {
  const { signal, onProgress, onTextDelta, onToolCallDelta, ...body } = o
  let res: Response
  try {
    res = await apiFetch('/api/text', {
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
    if (!j.ok) throw textStreamError(proxyErrorMessage(j, '文本生成失败'), String(j.kind || ''))
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
      } else if (type === 'text_delta') {
        const delta = String(event.delta || '')
        if (delta) onTextDelta?.(delta)
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
        throw textStreamError(String(event.message || '流式生成失败'), String(event.kind || ''))
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
    res = await apiFetch('/api/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(proxyErrorMessage(j, '视觉理解失败'))
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
    res = await apiFetch('/api/video-vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch {
    throw new Error('连不上本地代理，dev server 是否还在运行？')
  }
  const j = await readJsonRes(res)
  if (!j.ok) throw new Error(proxyErrorMessage(j, '视频理解失败'))
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
export type Stage =
  | 'character'
  | 'asset'
  | 'shot'
  | 'prompt'
  | 'sceneCode'
  | 'vision'
  | 'videoVision'
  | 'creative'
export const STAGES: Stage[] = [
  'character',
  'asset',
  'shot',
  'prompt',
  'sceneCode',
  'vision',
  'videoVision',
  'creative',
]
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
  /** 支持只给提示词生成（文生视频）；未声明时纯文本模式会被阻止 */
  textToVideo?: boolean
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
  /** 每个环节的输出上限（tokens）；未配置 = 请求不带 max_tokens，交给渠道默认 */
  stageMaxTokens?: Partial<Record<Stage, number>>
  /** 计价单价（估算，可校准） */
  pricing?: { image?: number; video480?: number; video720?: number; audio?: number }
  /** 3D agent 的运行上限；缺省使用默认值 */
  agentLimits?: AgentLimitSettings
  /** 3D agent 宿主权限：restricted（默认）| full_host */
  agentHostMode?: import('./agent/agentHostMode').AgentHostMode
  /** 口型 provider；默认关闭，Key 只存设置库 */
  lipSync?: LipSyncSettings
  /** 设置库里的自定义音色条目 */
  customVoices?: CustomVoice[]
  /** 创意会话：摄取、能力绑定、分析档位与成本闸门；缺省用默认值 */
  creative?: CreativeSettings
  /** 只读派生：创意摄取里哪些项由 .env 兜底（服务端计算，保存时忽略） */
  creativeFromEnv?: { dtk?: boolean; ytdlp?: boolean }
  /** 在线素材来源：启用、Key（只回 hasApiKey）与可选 Base URL；缺省全部关闭 */
  stock?: StockSettings
  /**
   * 知识库伴生服务（AnythingLLM）：地址与 Key。
   * 读取时 Key 只回 `hasApiKey`；`compact` 标明哪一项来自环境变量。
   */
  knowledge?: KnowledgeSettingsView
  apiKey: string
  rules: Record<string, RulePack>
  /** 旧规则包已迁移为技能覆盖；避免重复迁移 */
  skillsMigrated?: boolean
  presetsVersion?: number
}

export async function getSettings(): Promise<{ settings: AppSettings; db?: string }> {
  const r = await apiFetch('/api/settings')
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '读取设置失败')
  return { settings: j.settings as AppSettings, db: j.db }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const r = await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '保存设置失败')
  return j.settings as AppSettings
}

// ---------------------------------------------------------------- 知识库

/**
 * 知识库设置的回读形状。
 *
 * 与 `StockSettings` 同一规矩：Key 只回 `hasApiKey`，原文永不出服务端。
 * `compact` 是只读派生（服务端算），保存时会被忽略。
 */
export type KnowledgeSettingsView = {
  baseUrl: string
  enabled: boolean
  hasApiKey: boolean
  /** 推给上游的对话模型名；空 = 用默认 MiniMax-M3.1-Flash */
  llmModel?: string
  /** 哪一项来自环境变量；设置页据此提示「这一项由 .env 提供」 */
  compact?: { baseUrlFromEnv: boolean; apiKeyFromEnv: boolean }
  /** 桌面端自带的知识库：地址与 Key 由应用注入，手填无效 */
  builtin?: boolean
  defaultBaseUrl?: string
}

/** 保存用的编辑态：可以带 apiKey 原文，也可以显式清空 */
export type KnowledgeSettingsPatch = {
  baseUrl?: string
  apiKey?: string
  clearApiKey?: boolean
}

export type KnowledgeDoc = {
  /** 上游文档标识，移出/删除要原样回传 */
  location: string
  title: string
  wordCount: number
}

export type KnowledgeDocsResult = {
  slug: string
  name: string
  docCount: number
  documents: KnowledgeDoc[]
}

/**
 * 知识库（独立命名，与项目无关）。
 *
 * `upstreamSlug` 是上游 workspace 标识：中文库名会被上游归一成不可逆推的 slug，
 * 所以必须存下来，任何「由库名反推 slug」的写法都是错的。
 */
export type KnowledgeBaseSummary = {
  id: string
  name: string
  upstreamSlug: string
  createdAt: string
  /** 文档数；列表接口按需回查上游，取不到时省略 */
  docCount?: number
  /** 上游 workspace 已不存在（被手工删了）：界面提示删记录后重建 */
  broken?: boolean
}

export type KnowledgeSearchHit = {
  text: string
  title: string
  score: number
  location: string
}

export type KnowledgeTestResult = {
  baseUrl: string
  authenticated: boolean
  workspaceCount: number
  /**
   * 连接测试时顺便把本应用的对话模型推给上游的结果。
   * `null` = 本应用还没有可用的 MiniMax 渠道，未做代配。
   */
  llm?: { ok: boolean; error?: string; written?: string[] } | null
  /** 代配来源渠道 id，便于界面说明「用的是哪个渠道」 */
  llmSource?: string
}

/** 知识库接口的错误：带 `configured` 让页面能区分「没配」与「配了但坏了」 */
export class KnowledgeError extends Error {
  configured: boolean
  /** 服务端错误码（如 kb_session_unset / kb_session_gone）；没有就是空串 */
  code: string
  constructor(message: string, configured: boolean, code = '') {
    super(message)
    this.name = 'KnowledgeError'
    this.configured = configured
    this.code = code
  }
}

async function knowledgeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init)
  const j = await readJsonRes(r)
  if (!j.ok) {
    throw new KnowledgeError(
      String(j.message || `知识库请求失败（HTTP ${r.status}）`),
      j.configured !== false,
      String((j as { code?: string }).code || ''),
    )
  }
  return j as T
}

export async function getKnowledgeSettings(): Promise<KnowledgeSettingsView> {
  return knowledgeJson<KnowledgeSettingsView>('/api/knowledge/settings')
}

export async function testKnowledge(): Promise<KnowledgeTestResult> {
  return knowledgeJson<KnowledgeTestResult>('/api/knowledge/test', { method: 'POST' })
}

export async function getKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
  const r = await knowledgeJson<{ bases: KnowledgeBaseSummary[] }>('/api/knowledge/bases')
  return r.bases
}

/** 别名：工具层按「动作命名」（list_...），界面按 get 命名，两者同一份实现 */
export const listKnowledgeBases = getKnowledgeBases

export async function createKnowledgeBase(name: string): Promise<KnowledgeBaseSummary> {
  const r = await knowledgeJson<{ base: KnowledgeBaseSummary }>('/api/knowledge/bases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return r.base
}

export async function renameKnowledgeBase(id: string, name: string): Promise<KnowledgeBaseSummary> {
  const r = await knowledgeJson<{ base: KnowledgeBaseSummary }>(
    `/api/knowledge/bases/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  )
  return r.base
}

export async function deleteKnowledgeBase(
  id: string,
): Promise<{ id: string; name: string; sessionsCleared: number; warnings: string[] }> {
  return knowledgeJson<{ id: string; name: string; sessionsCleared: number; warnings: string[] }>(
    `/api/knowledge/bases/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

/**
 * 会话选定的库。`systemId` 是 dsh 会话标识：它由宿主注入，模型看不到也改不了。
 * 界面在会话头部选库时也走这里，把同一个值写进我们的表。
 */
export async function getSessionKnowledgeBase(
  sessionId: string,
): Promise<{ kbId: string; base: KnowledgeBaseSummary | null }> {
  const r = await knowledgeJson<{ kbId: string; base: KnowledgeBaseSummary | null }>(
    `/api/knowledge/session-kb?sessionId=${encodeURIComponent(sessionId)}`,
  )
  return { kbId: r.kbId, base: r.base }
}

export async function setSessionKnowledgeBase(sessionId: string, kbId: string): Promise<void> {
  await knowledgeJson<{ ok: true }>('/api/knowledge/session-kb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, kbId }),
  })
}

export async function getKnowledgeDocs(kbId: string): Promise<KnowledgeDocsResult> {
  return knowledgeJson<KnowledgeDocsResult>(`/api/knowledge/docs?kbId=${encodeURIComponent(kbId)}`)
}

/** 可接受类型只认上游：不在这里维护第二份扩展名清单 */
export async function getKnowledgeAcceptedTypes(): Promise<{ extensions: string[] }> {
  return knowledgeJson<{ extensions: string[] }>('/api/knowledge/accepted-types')
}

export async function uploadKnowledgeDoc(
  kbId: string,
  file: File,
): Promise<{ kbId: string; documents: KnowledgeDoc[] }> {
  return knowledgeJson<{ kbId: string; documents: KnowledgeDoc[] }>(
    `/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=${encodeURIComponent(file.name)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    },
  )
}

/** 移出本库：只解绑，文档留在实例文档池 */
export async function removeKnowledgeDocs(
  kbId: string,
  locations: string[],
): Promise<{ removed: number }> {
  return knowledgeJson<{ removed: number }>('/api/knowledge/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kbId, locations }),
  })
}

/** 从实例文档池彻底删除：会影响所有挂载同一文档的库 */
export async function purgeKnowledgeDocs(locations: string[]): Promise<{ purged: number }> {
  return knowledgeJson<{ purged: number }>('/api/knowledge/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations }),
  })
}

/**
 * 检索。第一个参数是**会话标识**（Agent 工具栏）或库 id（界面用）——
 * 服务端两种都认：显式 kbId 优先，其次按会话标识查会话选定的库。
 * 工具 schema 里没有库参数，所以模型无法指定别的库。
 */
export async function searchKnowledge(
  scope: { sessionId: string } | { kbId: string },
  query: string,
  opts: { topN?: number; scoreThreshold?: number } = {},
): Promise<KnowledgeSearchHit[]> {
  const body =
    'sessionId' in scope
      ? { sessionId: scope.sessionId, query, ...opts }
      : { kbId: scope.kbId, query, ...opts }
  const r = await knowledgeJson<{ hits: KnowledgeSearchHit[] }>('/api/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return r.hits
}

/**
 * 读全文。带上作用域（会话或库）时服务端会先确认这份文档挂在该库里 ——
 * 上游文档池是实例级共享的，只认文件名不认库，不校验就等于允许越库读取。
 */
export async function readKnowledgeDoc(
  scope: { sessionId: string } | { kbId: string },
  docName: string,
): Promise<{ title: string; text: string; wordCount: number }> {
  const params = new URLSearchParams({ docName })
  if ('sessionId' in scope) params.set('sessionId', scope.sessionId)
  else params.set('kbId', scope.kbId)
  return knowledgeJson<{ title: string; text: string; wordCount: number }>(
    `/api/knowledge/doc?${params.toString()}`,
  )
}

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
    const r = await apiFetch('/api/test-provider', {
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
    const r = await apiFetch('/api/videos')
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

export type CameraLexiconImportResult = {
  ok?: boolean
  url: string
  file: string
  key: string
  title: string
  attribution: string
}

export async function importCameraLexiconPreset(
  projectName: string,
  key: string,
): Promise<CameraLexiconImportResult> {
  const r = await apiFetch('/api/camera-lexicon/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: projectName, key }),
  })
  const j = await readJsonRes(r)
  if (!j.ok) throw new Error(j.message || '运镜库导入失败')
  return j as CameraLexiconImportResult
}

export async function listMedia(projectName: string): Promise<MediaBundle> {
  try {
    const r = await apiFetch(`/api/media?name=${encodeURIComponent(projectName)}`)
    const j = await readJsonRes(r)
    if (!j.ok) return { images: [], videos: [], assets: [] }
    return { images: j.images ?? [], videos: j.videos ?? [], assets: j.assets ?? [] }
  } catch {
    return { images: [], videos: [], assets: [] }
  }
}

export type Shot3dIngestResult = {
  videoUrl: string
  bytes: number
  adapter?: string
  adapterLabel?: string
  meta?: Record<string, string>
  warnings?: string[]
  probe?: {
    duration: number | null
    width: number | null
    height: number | null
    fps: number | null
    hasAudio?: boolean
  }
}

export async function ingestShot3dReference(input: {
  projectName: string
  shotId?: string
  url?: string
  data?: string
  name?: string
  adapter?: string
}): Promise<Shot3dIngestResult> {
  const r = await apiFetch('/api/shot-3d/ingest-reference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await r.json()
  if (!j.ok) throw new Error(j.message || '参考视频摄取失败')
  return j as Shot3dIngestResult
}

/** 单帧平均亮度（YAVG，0–255）；`dark` 由服务端按近黑阈值判定 */
export type FrameStat = { yavg?: number; dark: boolean }

export async function extractFrames(
  video: string,
  count = 3,
  signal?: AbortSignal,
  times?: number[],
): Promise<{ urls: string[]; duration: number; times: number[]; stats: FrameStat[] }> {
  const r = await apiFetch('/api/frames', {
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
    // 老服务端没有 stats 时按空数组兜底，调用方无需判空
    stats: Array.isArray(r.stats) ? (r.stats as FrameStat[]) : [],
  }
}
