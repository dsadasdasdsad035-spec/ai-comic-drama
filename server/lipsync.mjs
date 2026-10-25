/**
 * 外部口型 provider：Sync Labs（sync.so）适配器。
 * 只做 HTTP + 文件搬运，不读项目、不碰设置库；调用方传入 Key 和输出路径。
 */
import fs from 'node:fs'
import path from 'node:path'

export class LipSyncError extends Error {
  constructor(message, { kind = 'api', status = 0, code = '' } = {}) {
    super(message)
    this.name = 'LipSyncError'
    this.kind = kind
    this.status = status
    this.code = code
  }
}

export const SYNC_LABS_DEFAULT_BASE = 'https://api.sync.so'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function endpoint(baseUrl, suffix) {
  return `${String(baseUrl || SYNC_LABS_DEFAULT_BASE).replace(/\/+$/, '')}${suffix}`
}

function assetIdOf(value) {
  return (
    value?.assetId ||
    value?.asset_id ||
    value?.id ||
    value?.data?.assetId ||
    value?.data?.asset_id ||
    value?.data?.id ||
    ''
  )
}

function jobIdOf(value) {
  return value?.id || value?.generationId || value?.data?.id || ''
}

function statusOf(value) {
  return String(value?.status || value?.data?.status || '').toUpperCase()
}

function outputUrlOf(value) {
  return value?.outputUrl || value?.output_url || value?.data?.outputUrl || value?.data?.output_url || ''
}

async function readError(r) {
  let text = ''
  try {
    text = await r.text()
  } catch {
    /* ignore */
  }
  return text.slice(0, 400)
}

async function uploadAsset({ baseUrl, apiKey, file, contentType, fetchImpl, timeoutMs }) {
  if (!fs.existsSync(file)) throw new LipSyncError(`口型输入文件不存在：${file}`, { kind: 'config' })
  const data = await fs.promises.readFile(file)
  const blob = new Blob([data], { type: contentType })
  const form = new FormData()
  form.append('file', blob, path.basename(file))
  const r = await fetchImpl(endpoint(baseUrl, '/v2/assets/upload'), {
    method: 'POST',
    headers: { 'x-api-key': apiKey },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) {
    const body = await readError(r)
    throw new LipSyncError(
      r.status === 401 || r.status === 403
        ? 'Sync Labs 鉴权失败，请检查 Key'
        : `Sync Labs 上传失败 ${r.status}：${body}`,
      { kind: r.status === 401 || r.status === 403 ? 'auth' : 'api', status: r.status },
    )
  }
  const json = await r.json()
  const id = assetIdOf(json)
  if (!id) throw new LipSyncError('Sync Labs 上传成功但没有返回 assetId', { kind: 'protocol' })
  return id
}

async function submitGeneration({
  baseUrl,
  apiKey,
  videoAssetId,
  audioAssetId,
  model,
  fetchImpl,
  timeoutMs,
}) {
  const r = await fetchImpl(endpoint(baseUrl, '/v2/generate'), {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'lipsync-2',
      input: [
        { type: 'video', assetId: videoAssetId },
        { type: 'audio', assetId: audioAssetId },
      ],
      options: {
        sync_mode: 'cut_off',
        active_speaker_detection: { auto_detect: true },
      },
      outputFileName: `lipsync_${Date.now()}`,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!r.ok) {
    const body = await readError(r)
    const kind = r.status === 401 || r.status === 403 ? 'auth' : r.status === 429 ? 'quota' : 'api'
    throw new LipSyncError(
      kind === 'auth'
        ? 'Sync Labs 鉴权失败，请检查 Key'
        : kind === 'quota'
          ? `Sync Labs 额度/并发不足：${body}`
          : `Sync Labs 提交失败 ${r.status}：${body}`,
      { kind, status: r.status },
    )
  }
  const json = await r.json()
  const id = jobIdOf(json)
  if (!id) throw new LipSyncError('Sync Labs 提交成功但没有返回任务 ID', { kind: 'protocol' })
  return id
}

async function pollGeneration({
  baseUrl,
  apiKey,
  jobId,
  fetchImpl,
  timeoutMs,
  pollMs,
  sleep,
}) {
  const started = Date.now()
  for (;;) {
    const r = await fetchImpl(endpoint(baseUrl, `/v2/generate/${encodeURIComponent(jobId)}`), {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) {
      const body = await readError(r)
      throw new LipSyncError(`Sync Labs 查询失败 ${r.status}：${body}`, {
        kind: r.status === 401 || r.status === 403 ? 'auth' : 'api',
        status: r.status,
      })
    }
    const json = await r.json()
    const status = statusOf(json)
    if (status === 'COMPLETED') {
      const url = outputUrlOf(json)
      if (!url) throw new LipSyncError('Sync Labs 任务完成但没有输出地址', { kind: 'protocol' })
      return { url, raw: json }
    }
    if (status === 'FAILED' || status === 'REJECTED') {
      const message = json?.error?.message || json?.message || status
      throw new LipSyncError(`Sync Labs 任务失败：${message}`, { kind: 'provider', code: status })
    }
    if (Date.now() - started > timeoutMs) {
      throw new LipSyncError('Sync Labs 轮询超时，任务可能仍在运行', { kind: 'timeout', code: status })
    }
    await sleep(pollMs)
  }
}

async function downloadOutput({ url, file, fetchImpl, timeoutMs }) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok) throw new LipSyncError(`下载口型结果失败 ${r.status}`, { status: r.status })
  const bytes = Buffer.from(await r.arrayBuffer())
  if (!bytes.length) throw new LipSyncError('口型结果为空', { kind: 'protocol' })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, bytes)
  return file
}

/**
 * 完整跑一次：上传视频/音频 → 提交 → 轮询 → 下载。
 * 所有外部调用都走 fetchImpl，测试可完全 mock。
 */
export async function runSyncLabs({
  baseUrl = SYNC_LABS_DEFAULT_BASE,
  apiKey,
  videoFile,
  audioFile,
  outputFile,
  model = 'lipsync-2',
  timeoutMs = 15 * 60_000,
  pollMs = 3000,
  fetchImpl = fetch,
  sleep = wait,
  onProgress,
}) {
  if (!apiKey) throw new LipSyncError('没有配置 Sync Labs Key', { kind: 'config' })
  onProgress?.('upload-video')
  const videoAssetId = await uploadAsset({
    baseUrl,
    apiKey,
    file: videoFile,
    contentType: 'video/mp4',
    fetchImpl,
    timeoutMs,
  })
  onProgress?.('upload-audio')
  const audioAssetId = await uploadAsset({
    baseUrl,
    apiKey,
    file: audioFile,
    contentType: 'audio/mpeg',
    fetchImpl,
    timeoutMs,
  })
  onProgress?.('submit')
  const jobId = await submitGeneration({
    baseUrl,
    apiKey,
    videoAssetId,
    audioAssetId,
    model,
    fetchImpl,
    timeoutMs,
  })
  onProgress?.('poll')
  const { url } = await pollGeneration({
    baseUrl,
    apiKey,
    jobId,
    fetchImpl,
    timeoutMs,
    pollMs,
    sleep,
  })
  onProgress?.('download')
  await downloadOutput({ url, file: outputFile, fetchImpl, timeoutMs })
  return { outputFile, jobId, videoAssetId, audioAssetId, provider: 'sync-labs' }
}
