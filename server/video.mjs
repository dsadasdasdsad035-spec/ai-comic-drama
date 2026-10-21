/**
 * 方舟视频任务客户端：提交、轮询、下载。
 * 纯 HTTP + 文件 IO，不依赖 vite，可用 node 直接测试。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const RATIOS = new Set(['16:9', '9:16', '4:3', '1:1', '3:4', '21:9'])
const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3'

export class VideoParamError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'VideoParamError'
    this.kind = 'bad-request'
    this.details = details
  }
}

export class VideoError extends Error {
  constructor(message, { kind = 'api', status = 0, code = '' } = {}) {
    super(message)
    this.name = 'VideoError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

/** 已知模型族的参数档位；未登记的模型返回 null，由服务商自行校验 */
export function videoCapsFor(model) {
  const id = String(model || '').toLowerCase()
  if (!id.includes('seedance')) return null
  if (/seedance[-_]?1[-_.]?5(?:[-_.]|$)/.test(id)) {
    return { minDuration: 4, maxDuration: 12, resolutions: ['480p', '720p', '1080p'] }
  }
  if (/seedance[-_]?1[-_.]?0(?:[-_.]|$)/.test(id)) {
    return { minDuration: 2, maxDuration: 12, resolutions: ['480p', '720p', '1080p'] }
  }
  return null
}

function tasksEndpoint(baseUrl) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/contents/generations/tasks`
}

function errorFromResponse(text, status) {
  let code = ''
  let message = String(text || '').slice(0, 300)
  try {
    const j = JSON.parse(text)
    code = String(j?.error?.code || j?.code || '')
    message = String(j?.error?.message || j?.message || message)
  } catch {
    /* 保持原始响应文本 */
  }
  const lower = `${code} ${message}`.toLowerCase()
  const kind =
    status === 401 || status === 403
      ? 'auth'
      : status === 429
        ? 'rate-limit'
        : /overdue|arrear|balance|insufficient|欠费/.test(lower)
          ? 'billing'
          : 'api'
  return new VideoError(`${code ? `${code} - ` : ''}${message || `HTTP ${status}`}`, {
    kind,
    status,
    code,
  })
}

/**
 * 组装方舟视频任务请求体。图片入参必须是可访问的 http URL 或 data URL。
 * 参考图与首/尾帧互斥：有参考图时忽略首帧和尾帧。
 */
export function buildVideoPayload({
  model,
  prompt,
  ratio,
  seconds,
  resolution,
  cameraFixed = false,
  returnLastFrame = true,
  firstFrame = '',
  lastFrame = '',
  referenceImages = [],
}) {
  const text = String(prompt || '').trim()
  if (!text) throw new VideoParamError('提示词为空')

  const duration = Math.round(Number(seconds))
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoParamError('视频时长必须是正整数秒')
  }

  const caps = videoCapsFor(model)
  if (caps && (duration < caps.minDuration || duration > caps.maxDuration)) {
    throw new VideoParamError(
      `模型 ${model} 仅支持 ${caps.minDuration}~${caps.maxDuration} 秒，当前 ${duration} 秒`,
      { allowedDurations: [caps.minDuration, caps.maxDuration], model },
    )
  }

  const res = String(resolution || '').trim()
  if (caps && res && !caps.resolutions.includes(res)) {
    throw new VideoParamError(
      `模型 ${model} 不支持 ${res}，可选 ${caps.resolutions.join(' / ')}`,
      { allowedResolutions: caps.resolutions, model },
    )
  }

  const ratioValue = RATIOS.has(String(ratio)) ? String(ratio) : '16:9'
  const refs = (Array.isArray(referenceImages) ? referenceImages : [])
    .map(String)
    .filter(Boolean)
    .slice(0, 4)
  const first = String(firstFrame || '')
  const last = String(lastFrame || '')

  const content = [{ type: 'text', text }]
  if (refs.length > 0) {
    for (const url of refs) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
  } else if (first) {
    content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' })
    if (last) content.push({ type: 'image_url', image_url: { url: last }, role: 'last_frame' })
  } else {
    throw new VideoParamError('缺少首帧图片或参考图')
  }

  return {
    model,
    content,
    ratio: ratioValue,
    duration,
    ...(res ? { resolution: res } : {}),
    camera_fixed: Boolean(cameraFixed),
    ...(returnLastFrame ? { return_last_frame: true } : {}),
  }
}

export async function submitVideoTask({ baseUrl, apiKey, payload, fetchImpl = fetch }) {
  const r = await fetchImpl(tasksEndpoint(baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await r.text()
  if (!r.ok) throw errorFromResponse(text, r.status)

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new VideoError('视频接口返回了非 JSON 响应', { kind: 'api', status: r.status })
  }
  const taskId = String(json?.id || json?.task_id || json?.data?.id || '').trim()
  if (!taskId) throw new VideoError('视频接口未返回任务 id', { kind: 'api', status: r.status })
  return { taskId, response: json }
}

export async function fetchVideoTask({ baseUrl, apiKey, taskId, fetchImpl = fetch }) {
  const url = `${tasksEndpoint(baseUrl)}/${encodeURIComponent(taskId)}`
  const r = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await r.text()
  if (!r.ok) throw errorFromResponse(text, r.status)
  try {
    return JSON.parse(text)
  } catch {
    throw new VideoError('视频任务查询返回了非 JSON 响应', { kind: 'api', status: r.status })
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询到终态。GET 的网络错误 / 429 / 5xx 连续容忍 2 次，第 3 次失败；
 * 鉴权失败、任务不存在等确定性错误立即抛出。
 */
export async function pollVideoTask({
  baseUrl,
  apiKey,
  taskId,
  intervalMs = 5000,
  timeoutMs = 10 * 60 * 1000,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const startedAt = Date.now()
  let transient = 0

  for (;;) {
    let task
    try {
      task = await fetchVideoTask({ baseUrl, apiKey, taskId, fetchImpl })
      transient = 0
    } catch (e) {
      const err = e instanceof VideoError ? e : new VideoError((e && e.message) || String(e))
      const deterministic =
        err.kind === 'auth' || (err.status >= 400 && err.status < 500 && err.status !== 429)
      if (deterministic) throw err
      transient++
      if (transient >= 3) throw err
    }

    if (task) {
      const status = String(task.status || '').toLowerCase()
      if (status === 'succeeded') {
        return {
          status,
          taskId,
          videoUrl: String(task.content?.video_url || ''),
          lastFrameUrl: String(task.content?.last_frame_url || ''),
          raw: task,
        }
      }
      if (['failed', 'expired', 'cancelled', 'canceled'].includes(status)) {
        const err = task.error || {}
        const label =
          status === 'expired' ? '任务已过期' : status === 'failed' ? '视频任务失败' : '任务已取消'
        throw new VideoError(
          `${err.code ? `${err.code} - ` : ''}${err.message || label}`,
          { kind: 'api', code: String(err.code || '') },
        )
      }
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new VideoError('等待视频任务超时，可稍后重试', { kind: 'timeout' })
    }
    await sleepImpl(intervalMs)
  }
}

/** 下载视频与尾帧；尾帧失败不影响视频结果，视频失败则整单失败 */
export async function downloadVideoArtifacts({
  videoUrl,
  lastFrameUrl,
  videoDir,
  frameDir,
  fetchImpl = fetch,
}) {
  if (!videoUrl) throw new VideoError('服务商未返回视频地址')

  const vr = await fetchImpl(videoUrl, { signal: AbortSignal.timeout(120_000) })
  if (!vr.ok) throw new VideoError(`下载视频失败 HTTP ${vr.status}`, { status: vr.status })
  const bytes = Buffer.from(await vr.arrayBuffer())
  fs.mkdirSync(videoDir, { recursive: true })
  const name = `shot-vid-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.mp4`
  fs.writeFileSync(path.join(videoDir, name), bytes)

  const out = { url: `/videos/${name}`, tail: '' }
  if (lastFrameUrl) {
    try {
      const fr = await fetchImpl(lastFrameUrl, { signal: AbortSignal.timeout(30_000) })
      if (fr.ok) {
        const fb = Buffer.from(await fr.arrayBuffer())
        const ct = String(fr.headers?.get?.('content-type') || '')
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg'
        fs.mkdirSync(frameDir, { recursive: true })
        const tailName = `tail-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`
        fs.writeFileSync(path.join(frameDir, tailName), fb)
        out.tail = `/generated/${tailName}`
      }
    } catch {
      /* 尾帧拿不到不影响出片 */
    }
  }
  return out
}
