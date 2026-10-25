/**
 * APIMart（APIB）协议客户端：目录、图片上传、异步图像/视频、TTS。
 *
 * 纯 HTTP + Buffer，不依赖 vite；可用 mock fetch 直接测试。
 * 协议要点：
 * - 文本/图像/视频响应可能带 {code, data} 外层；图像/视频是 task_id + /tasks/{id}
 * - 参考图必须先 POST /uploads/images 换 URL
 * - 视频请求体跨厂商不统一，这里只实现已接入的 Seedance 2.5 / Kling v3
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE = 'https://api.apimart.ai/v1'
const CATALOG_TIMEOUT_MS = 30_000
const SUBMIT_TIMEOUT_MS = 30_000
const UPLOAD_TIMEOUT_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const TASK_TIMEOUT_MS = 5 * 60_000
const POLL_INTERVAL_MS = 2_500

export const APIMART_DEFAULT_VOICE = 'alloy'
export const APIMART_VOICES = [
  { id: 'alloy', label: 'Alloy · 中性' },
  { id: 'echo', label: 'Echo · 男声稳' },
  { id: 'fable', label: 'Fable · 英伦叙述' },
  { id: 'onyx', label: 'Onyx · 男声低沉' },
  { id: 'nova', label: 'Nova · 女声活力' },
  { id: 'shimmer', label: 'Shimmer · 女声柔和' },
]
export const APIMART_TTS_MODELS = ['gpt-4o-mini-tts']

export class ApimartError extends Error {
  constructor(message, { kind = 'api', status = 0, code = '', taskId = '' } = {}) {
    super(String(message || 'APIMart 请求失败'))
    this.name = 'ApimartError'
    this.kind = kind
    this.status = status
    this.code = code
    this.taskId = taskId
  }
}

export function resolveBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
}

export function errorFromResponse(text, status) {
  let code = ''
  let message = String(text || '').slice(0, 400)
  try {
    const parsed = JSON.parse(text)
    const err = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed
    code = String(err?.code ?? '')
    message = String(err?.message ?? message)
  } catch {
    /* 保持原始文本 */
  }
  const lower = `${code} ${message}`.toLowerCase()
  const kind =
    status === 402 || /insufficient|balance|余额不足|欠费/.test(lower)
      ? 'billing'
      : status === 401 || status === 403
        ? 'auth'
        : status === 429
          ? 'rate-limit'
          : status === 404
            ? 'not-found'
            : status === 400 || status === 413
              ? 'bad-request'
              : 'api'
  return new ApimartError(`${code ? `${code} — ` : ''}${message || `HTTP ${status}`}`, {
    kind,
    status,
    code,
  })
}

function timeoutController(parent, ms) {
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = () => ctrl.abort()
  if (parent?.aborted) ctrl.abort()
  else parent?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ms)
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    },
  }
}

function abortError(lt) {
  return new ApimartError(lt.timedOut() ? '请求超时' : '请求已取消', {
    kind: lt.timedOut() ? 'timeout' : 'cancelled',
  })
}

async function requestJson(url, { apiKey, method = 'GET', body, signal, timeoutMs = SUBMIT_TIMEOUT_MS, fetchImpl = fetch }) {
  const lt = timeoutController(signal, timeoutMs)
  try {
    const r = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: lt.signal,
    })
    const text = await r.text()
    if (!r.ok) throw errorFromResponse(text, r.status)
    if (!text.trim()) return {}
    try {
      return JSON.parse(text)
    } catch {
      throw new ApimartError('渠道返回了非 JSON 响应', { kind: 'api', status: r.status })
    }
  } catch (e) {
    if (e instanceof ApimartError) throw e
    if (e?.name === 'AbortError') throw abortError(lt)
    throw new ApimartError(e?.message || '网络请求失败', { kind: 'network' })
  } finally {
    lt.dispose()
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApimartError('请求已取消', { kind: 'cancelled' }))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(new ApimartError('请求已取消', { kind: 'cancelled' }))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------------------------------------------------------------- 目录

/** 不是“给首帧就出片”的视频模型：编辑/动作控制/源任务再生成/提示词增强 */
export const VIDEO_UTILITY_MODELS = new Set([
  'MiniMax-H3-Context-IR',
  'MiniMax-H3-Regeneration',
  'wan2.7-videoedit',
  'kling-v2-6-motion-control',
  'kling-v3-motion-control',
  'veo3.1-lite',
])

export function isSupportedVideoModel(model) {
  return Boolean(String(model || '').trim())
}

export function videoFamilyFor(model) {
  const id = String(model || '').trim().toLowerCase()
  if (!id) return ''
  if (id === 'seedance-2.5' || id === 'seedance-2-5' || id === 'seedance-2_5') return 'seedance-2.5'
  if (id === 'kling-v3' || id === 'kling-3' || id === 'kling-3.0') return 'kling-v3'
  // 其余视频模型走通用 schema 适配：APIMart 的 /videos/generations 对全部视频模型
  // 暴露同一组 prompt/duration/resolution/aspect_ratio/image_urls/video_urls 字段。
  return 'generic'
}

function inferCategory(id) {
  const s = String(id || '').toLowerCase()
  if (/seedream|imagen|flux|gpt-image|nano-banana|qwen-image|midjourney|z-image|mai-image|hy-image|grok-imagine.*image|wan[\d.]*-image/.test(s)) {
    return 'image'
  }
  if (/seedance|(^|-)veo|kling|hailuo|pixverse|vidu|skyreels|happyhorse|wan[\d.]*|omni|grok-imagine.*video|flux.*video/.test(s)) {
    return 'video'
  }
  if (/tts|whisper|suno|lyria|music|speech|audio/.test(s)) return 'audio'
  if (/gpt|claude|gemini|deepseek|qwen|kimi|glm|llama|mistral|doubao|moonshot|minimax|abab|yi-/.test(s)) {
    return 'chat'
  }
  return 'unknown'
}

function normalizeTags(raw) {
  const list = Array.isArray(raw?.capability_tags)
    ? raw.capability_tags
    : Array.isArray(raw?.tags)
      ? raw.tags
      : Array.isArray(raw?.capabilities)
        ? raw.capabilities
        : []
  return list
    .map((t) => (typeof t === 'string' ? t : String(t?.name ?? t?.id ?? '')))
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * 目录条目 → 本地模型候选项。
 * 只做纯映射；是否可运行由 runtime 明确标出，UI 不猜。
 */
export function mapCatalogEntry(raw) {
  const id = String(raw?.id ?? raw?.model ?? '').trim()
  if (!id) return null
  const category = ['chat', 'image', 'video', 'audio'].includes(raw?.category)
    ? raw.category
    : inferCategory(id)
  const tags = normalizeTags(raw)
  const lowerTags = tags.join(' ').toLowerCase()
  const lowerId = id.toLowerCase()

  if (/embedding|moderation/.test(lowerId) || /embedding|moderation/.test(lowerTags)) {
    return {
      id,
      category,
      tags,
      suggestedCaps: [],
      runtime: 'catalog-only',
      reason: '嵌入/审核模型，当前版本未接入',
    }
  }

  if (category === 'chat') {
    const caps = ['text', 'textPro']
    const vision = /vision|image|多模态|图像|file/.test(lowerTags)
    if (vision) caps.push('vision')
    return {
      id,
      category,
      tags,
      suggestedCaps: caps,
      runtime: 'ready',
      features: vision ? { vision: true } : undefined,
    }
  }

  if (category === 'image') {
    const imageRef = /image to image|i2i|edit|reference|图生图|参考|编辑/.test(lowerTags)
      ? 'multi'
      : 'none'
    return {
      id,
      category,
      tags,
      suggestedCaps: ['image', 'view'],
      runtime: 'ready',
      features: { imageRef },
    }
  }

  if (category === 'video') {
    const family = videoFamilyFor(id)
    const common = { firstFrame: true, lastFrame: true }
    const features =
      family === 'seedance-2.5' ? { ...common, videoRef: true, audioOut: true } : common
    const utility = VIDEO_UTILITY_MODELS.has(id) || [...VIDEO_UTILITY_MODELS].some((x) => x.toLowerCase() === id.toLowerCase())
    return {
      id,
      category,
      tags,
      suggestedCaps: ['video'],
      runtime: utility ? 'catalog-only' : 'ready',
      reason: utility ? '需要源视频/源任务，或目录分类不是视频生成' : undefined,
      features,
    }
  }

  if (category === 'audio') {
    const transcribe = /whisper|transcri|asr|转写|识别/.test(`${lowerId} ${lowerTags}`)
    if (transcribe) {
      return {
        id,
        category,
        tags,
        suggestedCaps: ['audio'],
        runtime: 'catalog-only',
        reason: '转写模型，当前版本未接入',
      }
    }
    const music = /suno|lyria|flow-music|music|音乐|歌词/.test(`${lowerId} ${lowerTags}`)
    if (music) {
      return {
        id,
        category,
        tags,
        suggestedCaps: ['audio'],
        runtime: 'catalog-only',
        reason: '音乐生成，当前版本未接入',
      }
    }
    if (!/gpt-4o-mini-tts/.test(lowerId)) {
      return {
        id,
        category,
        tags,
        suggestedCaps: ['audio'],
        runtime: 'catalog-only',
        reason: '非 gpt-4o-mini-tts 音频模型，当前版本未验证',
      }
    }
    return {
      id,
      category,
      tags,
      suggestedCaps: ['audio'],
      runtime: 'ready',
      features: { audioOut: true },
    }
  }

  return {
    id,
    category: 'unknown',
    tags,
    suggestedCaps: [],
    runtime: 'catalog-only',
    reason: '无法映射到当前能力',
  }
}

export async function fetchCatalog({ baseUrl, apiKey, signal, timeoutMs = CATALOG_TIMEOUT_MS, fetchImpl = fetch }) {
  const j = await requestJson(`${resolveBaseUrl(baseUrl)}/models?expand=category`, {
    apiKey,
    signal,
    timeoutMs,
    fetchImpl,
  })
  const list = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : null
  if (!list) throw new ApimartError('目录响应缺少 data 数组', { kind: 'api' })
  return list.map(mapCatalogEntry).filter(Boolean)
}

// ---------------------------------------------------------------- 上传

function mimeFor(file) {
  const ext = path.extname(String(file || '')).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

export async function uploadImage({
  baseUrl,
  apiKey,
  filePath,
  buffer,
  mime,
  filename,
  signal,
  timeoutMs = UPLOAD_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  const bytes = buffer ? Buffer.from(buffer) : fs.readFileSync(filePath)
  if (bytes.length > 20 * 1024 * 1024) {
    throw new ApimartError('参考图超过 20MB 上限', { kind: 'bad-request' })
  }
  const name = filename || (filePath ? path.basename(filePath) : 'image.jpg')
  const type = mime || (filePath ? mimeFor(filePath) : 'image/jpeg')
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  const lt = timeoutController(signal, timeoutMs)
  try {
    const r = await fetchImpl(`${resolveBaseUrl(baseUrl)}/uploads/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: lt.signal,
    })
    const text = await r.text()
    if (!r.ok) throw errorFromResponse(text, r.status)
    let j
    try {
      j = JSON.parse(text)
    } catch {
      throw new ApimartError('上传接口返回了非 JSON 响应', { kind: 'api', status: r.status })
    }
    const url = String(j?.url ?? j?.data?.url ?? '').trim()
    if (!url) throw new ApimartError('上传接口没有返回 URL', { kind: 'api', status: r.status })
    return { url, filename: String(j?.filename ?? name), contentType: String(j?.content_type ?? type) }
  } catch (e) {
    if (e instanceof ApimartError) throw e
    if (e?.name === 'AbortError') throw abortError(lt)
    throw new ApimartError(e?.message || '参考图上传失败', { kind: 'network' })
  } finally {
    lt.dispose()
  }
}

// ---------------------------------------------------------------- 图像

export function buildImagePayload({ model, prompt, ratio = '16:9', size, refUrls = [], n = 1 }) {
  const text = String(prompt || '').trim()
  if (!text) throw new ApimartError('提示词为空', { kind: 'bad-request' })
  const refs = (Array.isArray(refUrls) ? refUrls : []).map(String).filter(Boolean)
  return {
    model,
    prompt: text,
    size: String(size || ratio || '16:9'),
    n: Math.max(1, Math.min(4, Number(n) || 1)),
    ...(refs.length ? { image_urls: refs } : {}),
    watermark: false,
  }
}

export async function submitImage({ baseUrl, apiKey, payload, signal, timeoutMs = SUBMIT_TIMEOUT_MS, fetchImpl = fetch }) {
  const j = await requestJson(`${resolveBaseUrl(baseUrl)}/images/generations`, {
    apiKey,
    method: 'POST',
    body: payload,
    signal,
    timeoutMs,
    fetchImpl,
  })
  const first = Array.isArray(j?.data) ? j.data[0] : undefined
  const taskId = String(first?.task_id ?? j?.task_id ?? '').trim()
  if (taskId) return { taskId }
  const url = String(first?.url ?? '').trim()
  if (url) return { url }
  throw new ApimartError('图像任务没有返回 task_id', { kind: 'api' })
}

// ---------------------------------------------------------------- 视频

const SEEDANCE_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
const KLING_RATIOS = new Set(['16:9', '9:16', '1:1'])

function clampDuration(seconds, min, max, label) {
  const duration = Math.round(Number(seconds))
  if (!Number.isFinite(duration) || duration < min || duration > max) {
    throw new ApimartError(`${label} 仅支持 ${min}~${max} 秒，当前 ${seconds}`, { kind: 'bad-request' })
  }
  return duration
}

export function buildVideoPayload({
  family,
  model,
  prompt,
  ratio = '16:9',
  seconds,
  resolution = '720p',
  firstFrame = '',
  lastFrame = '',
  referenceImages = [],
  referenceVideos = [],
  audioUrl = '',
  generateAudio = false,
}) {
  const text = String(prompt || '').trim()
  if (!text) throw new ApimartError('提示词为空', { kind: 'bad-request' })
  const first = String(firstFrame || '').trim()
  const last = String(lastFrame || '').trim()
  const refs = (Array.isArray(referenceImages) ? referenceImages : []).map(String).filter(Boolean)
  const vids = (Array.isArray(referenceVideos) ? referenceVideos : []).map(String).filter(Boolean)

  if (family === 'seedance-2.5') {
    if (generateAudio && Number(seconds) < 4) {
      throw new ApimartError('Seedance 2.5 原生音频最短 4 秒', { kind: 'bad-request' })
    }
    if (generateAudio && !String(audioUrl || '').trim()) {
      throw new ApimartError('原生音频需要 audio_url 音色参考', { kind: 'bad-request' })
    }
    const duration = clampDuration(seconds, 4, 30, 'Seedance 2.5')
    const res = ['480p', '720p', '1080p'].includes(String(resolution)) ? String(resolution) : '720p'
    // 首尾帧任务输出跟随首帧画幅，官方只接受 adaptive；普通图生视频才用显式比例
    const hasBoundary = Boolean(first || last)
    const ratioValue = hasBoundary
      ? 'adaptive'
      : SEEDANCE_RATIOS.has(String(ratio))
        ? String(ratio)
        : '16:9'
    const images = []
    if (first) images.push({ url: first, role: 'first_frame' })
    if (last) images.push({ url: last, role: 'last_frame' })
    for (const url of refs) images.push({ url, role: 'reference_image' })
    return {
      model,
      prompt: text,
      duration,
      size: ratioValue,
      resolution: res,
      ...(images.length ? { image_with_roles: images } : {}),
      ...(vids.length ? { video_urls: vids } : {}),
      ...(generateAudio ? { audio_url: String(audioUrl).trim(), generate_audio: true } : { generate_audio: false }),
      watermark: false,
    }
  }

  if (family === 'kling-v3') {
    if (generateAudio) throw new ApimartError('Kling v3 当前未接入原生音频参考', { kind: 'unsupported' })
    if (vids.length) {
      throw new ApimartError('Kling v3 不支持参考视频，请改用首帧或参考图', { kind: 'unsupported' })
    }
    if (refs.length) {
      throw new ApimartError('Kling v3 不支持多参考图；请用单首帧，或改用 Seedance 2.5', {
        kind: 'unsupported',
      })
    }
    if (!first) {
      throw new ApimartError('Kling v3 需要首帧图片', { kind: 'bad-request' })
    }
    const duration = clampDuration(seconds, 3, 15, 'Kling v3')
    const ratioValue = String(ratio || '16:9')
    if (!KLING_RATIOS.has(ratioValue)) {
      throw new ApimartError('Kling v3 只支持 16:9 / 9:16 / 1:1', { kind: 'bad-request' })
    }
    const mode = String(resolution) === '1080p' ? 'pro' : String(resolution) === '4k' ? '4k' : 'std'
    return {
      model,
      prompt: text,
      image_urls: last ? [first, last] : [first],
      duration,
      mode,
      aspect_ratio: ratioValue,
      audio: false,
    }
  }

  if (family === 'generic') {
    if (generateAudio) throw new ApimartError('当前视频族未接入原生音频参考', { kind: 'unsupported' })
    const duration = clampDuration(seconds, 1, 30, model)
    let res = String(resolution || '720p')
    // Omni-Flash-Ext 的 resolution 只接受 360p/720p/1080p/4k；480p 取最接近的 720p
    if (/^omni-flash-ext$/i.test(String(model)) && res === '480p') res = '720p'
    const ratioValue = String(ratio || '16:9')
    return {
      model,
      prompt: text,
      duration,
      resolution: res,
      aspect_ratio: ratioValue,
      generate_audio: false,
      ...(first ? { first_frame_image: first } : {}),
      ...(last ? { last_frame_image: last } : {}),
      ...(refs.length ? { image_urls: refs } : {}),
      ...(vids.length ? { video_urls: vids } : {}),
    }
  }

  throw new ApimartError(`视频模型「${model}」尚未接入 APIMart 运行时`, { kind: 'unsupported' })
}

export async function submitVideo({ baseUrl, apiKey, payload, signal, timeoutMs = SUBMIT_TIMEOUT_MS, fetchImpl = fetch }) {
  const j = await requestJson(`${resolveBaseUrl(baseUrl)}/videos/generations`, {
    apiKey,
    method: 'POST',
    body: payload,
    signal,
    timeoutMs,
    fetchImpl,
  })
  const first = Array.isArray(j?.data) ? j.data[0] : undefined
  const taskId = String(first?.task_id ?? j?.task_id ?? '').trim()
  if (!taskId) throw new ApimartError('视频任务没有返回 task_id', { kind: 'api' })
  return { taskId }
}

// ---------------------------------------------------------------- 轮询 / 下载

export async function pollTask({
  baseUrl,
  apiKey,
  taskId,
  signal,
  timeoutMs = TASK_TIMEOUT_MS,
  intervalMs = POLL_INTERVAL_MS,
  fetchImpl = fetch,
  onProgress,
}) {
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new ApimartError('请求已取消', { kind: 'cancelled' })
    if (Date.now() - started > timeoutMs) {
      throw new ApimartError(`任务 ${taskId} 超时`, { kind: 'timeout', taskId })
    }
    const j = await requestJson(
      `${resolveBaseUrl(baseUrl)}/tasks/${encodeURIComponent(taskId)}?language=zh`,
      { apiKey, signal, timeoutMs: SUBMIT_TIMEOUT_MS, fetchImpl },
    )
    const data = j?.data && typeof j.data === 'object' ? j.data : j
    const status = String(data?.status || '')
    if (typeof onProgress === 'function') onProgress({ status, progress: Number(data?.progress) || 0 })
    if (status === 'completed') return data
    if (status === 'failed' || status === 'cancelled') {
      const message = String(data?.error?.message || data?.error || `任务${status}`)
      const kind = status === 'cancelled' ? 'cancelled' : 'api'
      throw new ApimartError(message, { kind, taskId })
    }
    await sleep(intervalMs, signal)
  }
}

export async function downloadResult({ url, signal, timeoutMs = DOWNLOAD_TIMEOUT_MS, fetchImpl = fetch }) {
  const lt = timeoutController(signal, timeoutMs)
  try {
    const r = await fetchImpl(url, { signal: lt.signal })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw errorFromResponse(text || `下载失败 HTTP ${r.status}`, r.status)
    }
    const contentType = String(r.headers.get('content-type') || 'application/octet-stream')
    const bytes = Buffer.from(await r.arrayBuffer())
    if (!bytes.length) throw new ApimartError('结果文件为空', { kind: 'api' })
    return { bytes, contentType }
  } catch (e) {
    if (e instanceof ApimartError) throw e
    if (e?.name === 'AbortError') throw abortError(lt)
    throw new ApimartError(e?.message || '结果下载失败', { kind: 'network' })
  } finally {
    lt.dispose()
  }
}

export function imageUrlsFromTask(data) {
  const images = Array.isArray(data?.result?.images) ? data.result.images : []
  const urls = []
  for (const item of images) {
    if (Array.isArray(item?.url)) urls.push(...item.url.map(String).filter(Boolean))
    else if (typeof item?.url === 'string' && item.url) urls.push(item.url)
    else if (Array.isArray(item)) urls.push(...item.map(String).filter(Boolean))
  }
  return urls
}

export function videoUrlFromTask(data) {
  const videos = Array.isArray(data?.result?.videos) ? data.result.videos : []
  for (const item of videos) {
    const url = typeof item?.url === 'string' ? item.url : Array.isArray(item?.url) ? item.url[0] : ''
    if (url) return String(url)
  }
  const direct = data?.result?.video_url || data?.result?.url || ''
  return String(direct || '')
}

// ---------------------------------------------------------------- 文本

/** 兼容 APIMart 的 {code,data} 与裸 OpenAI 响应 */
export function normalizeChatPayload(j) {
  if (j && typeof j === 'object' && j.data && typeof j.data === 'object' && Array.isArray(j.data.choices)) {
    return j.data
  }
  return j
}

function contentText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

/**
 * 非流式请求的兼容解析：
 * APIMart 有些模型即使传 stream:false 仍返回 SSE，这里两种形态都收成完整 message。
 */
export function parseChatBody(raw, contentType = '') {
  const text = String(raw || '').trim()
  const isSse = text.startsWith('data:') || String(contentType).includes('text/event-stream')
  if (!isSse) return normalizeChatPayload(JSON.parse(text))

  let content = ''
  let finish = ''
  let usage = null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (!payload || payload === '[DONE]') {
      if (payload === '[DONE]') break
      continue
    }
    let obj
    try {
      obj = JSON.parse(payload)
    } catch {
      continue
    }
    if (obj?.error) {
      throw new ApimartError(String(obj.error.message || obj.error), { kind: 'api' })
    }
    const body = normalizeChatPayload(obj)
    const choice = body?.choices?.[0]
    if (choice?.delta?.content) content += contentText(choice.delta.content)
    if (choice?.message?.content) content += contentText(choice.message.content)
    if (choice?.finish_reason) finish = String(choice.finish_reason)
    if (body?.usage && typeof body.usage === 'object') usage = body.usage
  }
  return {
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish || 'stop' }],
    usage,
  }
}

/** 把一条 SSE JSON 归一成 OpenAI chunk；无法识别时返回 null */
export function normalizeSseChunk(raw) {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!obj || typeof obj !== 'object') return null
  if (obj.error) {
    const msg = typeof obj.error === 'string' ? obj.error : obj.error.message
    throw new ApimartError(String(msg || '上游返回错误'), { kind: 'api' })
  }
  if (typeof obj.code === 'number' && obj.code !== 200 && !obj.data) {
    throw new ApimartError(String(obj.message || `上游返回 code ${obj.code}`), { kind: 'api', code: String(obj.code) })
  }
  if (Array.isArray(obj.choices)) return obj
  const data = obj.data
  if (data && typeof data === 'object') {
    if (Array.isArray(data.choices)) return data
    if (data.delta || data.message || data.finish_reason) {
      return {
        ...data,
        choices: [
          {
            index: data.index ?? 0,
            delta: data.delta,
            message: data.message,
            finish_reason: data.finish_reason,
          },
        ],
      }
    }
  }
  return null
}

// ---------------------------------------------------------------- 音频

export function normalizeVoice(voice) {
  const id = String(voice || '').trim()
  return APIMART_VOICES.some((v) => v.id === id) ? id : APIMART_DEFAULT_VOICE
}

export async function synthesizeSpeech({
  baseUrl,
  apiKey,
  text,
  voice,
  model = 'gpt-4o-mini-tts',
  format = 'mp3',
  speed = 1,
  instructions,
  strictVoice = false,
  signal,
  timeoutMs = 60_000,
  fetchImpl = fetch,
}) {
  const input = String(text || '').trim()
  if (!input) throw new ApimartError('合成文本为空', { kind: 'bad-request' })
  const supportsInstructions = /gpt-4o-mini-tts/i.test(model) && Boolean(instructions?.trim())
  const lt = timeoutController(signal, timeoutMs)
  try {
    const r = await fetchImpl(`${resolveBaseUrl(baseUrl)}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: input.slice(0, 4096),
        voice: strictVoice && voice ? String(voice) : normalizeVoice(voice),
        response_format: format,
        speed,
        ...(supportsInstructions ? { instructions: String(instructions).slice(0, 4096) } : {}),
      }),
      signal: lt.signal,
    })
    const contentType = String(r.headers.get('content-type') || '')
    if (!r.ok) {
      const textBody = await r.text()
      throw errorFromResponse(textBody, r.status)
    }
    if (contentType.includes('application/json')) {
      const textBody = await r.text()
      throw errorFromResponse(textBody, r.status)
    }
    const bytes = Buffer.from(await r.arrayBuffer())
    if (!bytes.length) throw new ApimartError('音频接口返回空响应', { kind: 'api' })
    return { audio: bytes, contentType: contentType || `audio/${format}`, voice: normalizeVoice(voice) }
  } catch (e) {
    if (e instanceof ApimartError) throw e
    if (e?.name === 'AbortError') throw abortError(lt)
    throw new ApimartError(e?.message || '音频合成失败', { kind: 'network' })
  } finally {
    lt.dispose()
  }
}
