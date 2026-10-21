/**
 * 方舟 Files API 客户端：把本地视频上传成方舟托管的临时文件，拿预签名 download_url。
 *
 * 为什么需要它：Seedance 2.0/2.5 的 reference_video 只收公网 URL 或 asset://，
 * 本地 mp4 不能直接提交，视频也不支持 Base64。Files API 支持二进制上传，
 * 文件 active 后返回 download_url（预签名 TOS 地址），正好当 video_url 用。
 *
 * 纯 HTTP + 文件 IO，不依赖 vite，可用 node 直接测试。
 */
import fs from 'node:fs'
import path from 'node:path'

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024
export const MIN_VIDEO_SECONDS = 2

export class FileError extends Error {
  constructor(message, { kind = 'api', status = 0, fileId = '', stage = '' } = {}) {
    super(message)
    this.name = 'FileError'
    this.kind = kind
    this.status = status
    this.fileId = fileId
    this.stage = stage
  }
}

function filesEndpoint(baseUrl) {
  const base = String(baseUrl || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
  return `${base}/files`
}

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mov') return 'video/quicktime'
  return 'video/mp4'
}

function errorFromResponse(text, status, stage) {
  let message = String(text || '').slice(0, 300)
  let code = ''
  try {
    const j = JSON.parse(text)
    code = String(j?.error?.code || j?.code || '')
    message = String(j?.error?.message || j?.message || message)
  } catch {
    /* 保留原始响应文本 */
  }
  const kind =
    status === 401 || status === 403
      ? 'auth'
      : status === 404
        ? 'not-found'
        : status === 429
          ? 'rate-limit'
          : 'api'
  return new FileError(`${stage ? `${stage}：` : ''}${code ? `${code} - ` : ''}${message || `HTTP ${status}`}`, {
    kind,
    status,
    stage,
  })
}

/** 上传本地二进制文件；返回文件对象（可能仍在 processing） */
export async function uploadFile({ baseUrl, apiKey, filePath, mime = '', fetchImpl = fetch }) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    throw new FileError(`参考视频不存在：${path.basename(filePath)}`, { kind: 'missing', stage: '上传' })
  }
  if (stat.size > MAX_VIDEO_BYTES) {
    throw new FileError(
      `参考视频超过 200MB（${(stat.size / 1024 / 1024).toFixed(1)}MB），无法上传`,
      { kind: 'too-large', stage: '上传' },
    )
  }

  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([fs.readFileSync(filePath)], { type: mime || guessMime(filePath) }), path.basename(filePath))
  // 视频预处理只用于方舟侧抽帧；这里给最小 fps，减少等待
  form.append('preprocess_configs[video][fps]', '0.3')

  let r
  try {
    r = await fetchImpl(filesEndpoint(baseUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (e) {
    throw new FileError(`参考视频上传失败：${(e && e.message) || String(e)}`, { kind: 'net', stage: '上传' })
  }

  const text = await r.text()
  if (!r.ok) throw errorFromResponse(text, r.status, '上传')

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new FileError('Files API 返回了非 JSON 响应', { kind: 'api', status: r.status, stage: '上传' })
  }
  const id = String(json?.id || '').trim()
  if (!id) throw new FileError('Files API 未返回文件 id', { kind: 'api', status: r.status, stage: '上传' })
  return {
    id,
    status: String(json?.status || 'processing').toLowerCase(),
    download_url: String(json?.download_url || ''),
    expire_at: Number(json?.expire_at) || 0,
    raw: json,
  }
}

/** 查询文件；404 会抛 not-found，供缓存失效判断 */
export async function getFile({ baseUrl, apiKey, fileId, fetchImpl = fetch }) {
  let r
  try {
    r = await fetchImpl(`${filesEndpoint(baseUrl)}/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    throw new FileError(`查询参考视频失败：${(e && e.message) || String(e)}`, {
      kind: 'net',
      fileId,
      stage: '处理',
    })
  }
  const text = await r.text()
  if (!r.ok) {
    const err = errorFromResponse(text, r.status, '处理')
    err.fileId = fileId
    throw err
  }
  try {
    const j = JSON.parse(text)
    return {
      id: String(j?.id || fileId),
      status: String(j?.status || '').toLowerCase(),
      download_url: String(j?.download_url || ''),
      expire_at: Number(j?.expire_at) || 0,
      error: j?.error,
      raw: j,
    }
  } catch {
    throw new FileError('查询参考视频返回了非 JSON 响应', { kind: 'api', status: r.status, fileId, stage: '处理' })
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询到 active；failed / 超时 / 缺下载地址都抛 FileError */
export async function waitFileActive({
  baseUrl,
  apiKey,
  fileId,
  intervalMs = 1000,
  timeoutMs = 60_000,
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  const startedAt = Date.now()
  for (;;) {
    const f = await getFile({ baseUrl, apiKey, fileId, fetchImpl })
    if (f.status === 'active') {
      if (!f.download_url) {
        throw new FileError('方舟文件已就绪但没有下载地址', { kind: 'no-download-url', fileId, stage: '处理' })
      }
      return f
    }
    if (f.status === 'failed') {
      const err = f.error || {}
      throw new FileError(
        `参考视频处理失败${err.code ? `：${err.code}` : ''}${err.message ? ` - ${err.message}` : ''}`,
        { kind: 'processing-failed', fileId, stage: '处理' },
      )
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new FileError('等待参考视频处理超时', { kind: 'timeout', fileId, stage: '处理' })
    }
    await sleepImpl(intervalMs)
  }
}

/** 上传前校验：mp4/mov、2~15/30 秒、≤200MB；webm 由调用方先转码 */
export function validateVideoFile({ filePath, seconds, maxDuration = 15 }) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.mp4' && ext !== '.mov') {
    throw new FileError(`参考视频只支持 mp4 / mov，当前是 ${ext || '未知格式'}`, {
      kind: 'unsupported-format',
      stage: '校验',
    })
  }
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    throw new FileError(`参考视频不存在：${path.basename(filePath)}`, { kind: 'missing', stage: '校验' })
  }
  if (stat.size > MAX_VIDEO_BYTES) {
    throw new FileError(
      `参考视频超过 200MB（${(stat.size / 1024 / 1024).toFixed(1)}MB）`,
      { kind: 'too-large', stage: '校验' },
    )
  }
  const d = Number(seconds)
  if (!Number.isFinite(d) || d <= 0) {
    throw new FileError('无法读取参考视频时长', { kind: 'bad-media', stage: '校验' })
  }
  if (d < MIN_VIDEO_SECONDS || d > maxDuration) {
    throw new FileError(
      `参考视频时长需在 ${MIN_VIDEO_SECONDS}~${maxDuration} 秒，当前 ${d.toFixed(1)} 秒`,
      { kind: 'bad-duration', stage: '校验' },
    )
  }
  return { bytes: stat.size, seconds: d, ext }
}

/** 缓存 key：同一路径 + 大小 + mtime 视为同一文件；重渲染会生成新文件名 */
export function fileCacheKey(filePath) {
  try {
    const st = fs.statSync(filePath)
    return `${path.resolve(filePath)}|${st.size}|${Math.round(st.mtimeMs)}`
  } catch {
    return `${path.resolve(filePath)}|missing`
  }
}

const fileCache = new Map()

export function clearFileCache() {
  fileCache.clear()
}

/**
 * 上传并返回可用的 download_url。
 * 同一文件复用 fileId，但每次 GET 刷新预签名地址；文件过期/404 时重新上传。
 */
export async function ensureUploadedVideo({
  baseUrl,
  apiKey,
  filePath,
  seconds,
  maxDuration = 15,
  fetchImpl = fetch,
  intervalMs = 1000,
  timeoutMs = 60_000,
  sleepImpl = sleep,
}) {
  validateVideoFile({ filePath, seconds, maxDuration })
  const key = fileCacheKey(filePath)
  const hit = fileCache.get(key)
  if (hit && hit.expireAt - 60_000 > Date.now()) {
    try {
      const f = await getFile({ baseUrl, apiKey, fileId: hit.fileId, fetchImpl })
      if (f.status === 'active' && f.download_url) {
        if (f.expire_at) hit.expireAt = f.expire_at * 1000
        return { fileId: hit.fileId, downloadUrl: f.download_url, reused: true }
      }
    } catch {
      /* 404 / 过期 / 网络问题：重新上传 */
    }
    fileCache.delete(key)
  }

  const uploaded = await uploadFile({ baseUrl, apiKey, filePath, fetchImpl })
  const f =
    uploaded.status === 'active' && uploaded.download_url
      ? uploaded
      : await waitFileActive({
          baseUrl,
          apiKey,
          fileId: uploaded.id,
          intervalMs,
          timeoutMs,
          fetchImpl,
          sleepImpl,
        })
  const expireAt = f.expire_at ? f.expire_at * 1000 : Date.now() + 24 * 60 * 60 * 1000
  fileCache.set(key, { fileId: f.id, expireAt })
  return { fileId: f.id, downloadUrl: f.download_url, reused: false }
}
