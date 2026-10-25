import type { PreparedSceneAsset } from './sceneCodeAssets'

/**
 * 浏览器侧的 Blender 作业客户端。
 * 预览、试运行、定稿都走同一套：提交作业 → 轮询进度 → 拿 mp4 / 关键帧。
 */
export type BlenderHealth = {
  ok: boolean
  path: string | null
  version: string | null
  min: string
  max: string
  reason: string | null
  message: string
  defaults: {
    engine: string
    trialFps: number
    proxyFps: number
    finalFps: number
    trialSamples: number
    proxySamples: number
    finalSamples: number
    proxyShortEdge: number
    trialShortEdge: number
  }
}
export type BlenderAsset = {
  key: string
  kind: 'image' | 'video-frame'
  label: string
  url: string
  width?: number
  height?: number
  videoDuration?: number
  frameTime?: number
}

export type BlenderTier = 'trial' | 'proxy' | 'final'

export type BlenderJob = {
  id: string
  tier: BlenderTier
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  phase: string
  engine: string
  progress: number
  frame: number
  total: number
  width: number
  height: number
  fps: number
  duration: number
  videoUrl: string
  frameUrls: string[]
  missingAssets: { key: string; label: string; url: string; reason: string }[]
  error: string | null
  elapsedMs: number
}

export type SubmitRenderOptions = {
  code: string
  assets: PreparedSceneAsset[] | BlenderAsset[]
  width: number
  height: number
  fps: number
  duration: number
  tier: BlenderTier
  engine?: string
  samples?: number
  mode?: 'clean' | 'review'
  shot?: Record<string, unknown>
  times?: number[]
  keyTimes?: number[]
}

export class BlenderJobError extends Error {
  phase: string
  constructor(phase: string, message: string) {
    super(message)
    this.name = 'BlenderJobError'
    this.phase = phase
  }
}

export function abortError(message = '已取消'): Error {
  return typeof DOMException !== 'undefined'
    ? new DOMException(message, 'AbortError')
    : Object.assign(new Error(message), { name: 'AbortError' })
}

const isAbort = (e: unknown) => (e as Error)?.name === 'AbortError'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new BlenderJobError('http', text.slice(0, 300) || `HTTP ${res.status}`)
  }
}

export async function blenderHealth(refresh = false): Promise<BlenderHealth> {
  const res = await fetch(`/api/blender/health${refresh ? '?refresh=1' : ''}`)
  return (await readJson(res)) as unknown as BlenderHealth
}

const ASSET_URL_KEYS = ['url', 'path'] as const

/** PreparedSceneAsset 或裸 BlenderAsset 都归一成宿主需要的清单。 */
function toAsset(asset: PreparedSceneAsset | BlenderAsset): BlenderAsset {
  const any = asset as unknown as Record<string, unknown>
  const payload = (any.payload || any) as Record<string, unknown>
  return {
    key: String(payload.key || ''),
    kind: payload.kind === 'video-frame' ? 'video-frame' : 'image',
    label: String(payload.label || payload.key || ''),
    url: String(ASSET_URL_KEYS.map((k) => payload[k]).find((v) => typeof v === 'string' && v) || ''),
    ...(payload.width != null ? { width: Number(payload.width) || 0 } : {}),
    ...(payload.height != null ? { height: Number(payload.height) || 0 } : {}),
    ...(payload.videoDuration != null ? { videoDuration: Number(payload.videoDuration) } : {}),
    ...(payload.frameTime != null ? { frameTime: Number(payload.frameTime) } : {}),
  }
}

export async function submitRender(opts: SubmitRenderOptions): Promise<BlenderJob> {
  const body = {
    code: opts.code,
    assets: opts.assets.map(toAsset).filter((a) => a.url),
    width: opts.width,
    height: opts.height,
    fps: opts.fps,
    duration: opts.duration,
    tier: opts.tier,
    ...(opts.engine ? { engine: opts.engine } : {}),
    ...(opts.samples ? { samples: opts.samples } : {}),
    mode: opts.mode || 'clean',
    ...(opts.shot ? { shot: opts.shot } : {}),
    ...(opts.times ? { times: opts.times } : {}),
    ...(opts.keyTimes ? { keyTimes: opts.keyTimes } : {}),
  }
  const res = await fetch('/api/blender/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await readJson(res)
  if (!data.ok) throw new BlenderJobError('submit', String(data.message || '提交渲染失败'))
  return data.job as unknown as BlenderJob
}

export async function fetchJob(id: string): Promise<BlenderJob> {
  const res = await fetch(`/api/blender/progress?id=${encodeURIComponent(id)}`)
  const data = await readJson(res)
  if (!data.ok) throw new BlenderJobError('progress', String(data.message || '读取进度失败'))
  return data.job as unknown as BlenderJob
}

export async function cancelRender(id: string): Promise<void> {
  try {
    await fetch('/api/blender/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  } catch {
    /* 取消失败不阻塞 UI */
  }
}

export type PollOptions = {
  signal?: AbortSignal
  onProgress?: (job: BlenderJob) => void
  intervalMs?: number
  timeoutMs?: number
}

/** 轮询到终态；取消时先请求服务端终止作业，再抛 AbortError。 */
export async function pollRender(id: string, opts: PollOptions = {}): Promise<BlenderJob> {
  const interval = Math.max(150, opts.intervalMs || 400)
  const timeout = opts.timeoutMs || 15 * 60 * 1000
  const start = Date.now()
  const onAbort = () => {
    void cancelRender(id)
  }
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    for (;;) {
      if (opts.signal?.aborted) throw abortError()
      const job = await fetchJob(id)
      opts.onProgress?.(job)
      if (job.status === 'done') return job
      if (job.status === 'error') throw new BlenderJobError(job.phase || 'render', job.error || '渲染失败')
      if (job.status === 'cancelled') throw abortError('渲染已取消')
      if (Date.now() - start > timeout) {
        await cancelRender(id)
        throw new BlenderJobError('timeout', '渲染等待超时')
      }
      await sleep(interval)
    }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** 渲染并等待完成；失败抛 BlenderJobError，取消抛 AbortError。 */
export async function renderAndWait(opts: SubmitRenderOptions, poll: PollOptions = {}): Promise<BlenderJob> {
  const job = await submitRender(opts)
  poll.onProgress?.(job)
  return pollRender(job.id, poll)
}

export function blenderErrorText(e: unknown): string {
  if (e instanceof BlenderJobError) return `${e.phase}：${e.message}`
  return (e as Error)?.message || String(e)
}

/** 按短边算渲染尺寸；宽高都取偶数，避免编码器挑尺寸。 */
export function sizeForEdge(aspect: string, shortEdge: number): { width: number; height: number } {
  const m = String(aspect || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  const ratio = m ? Number(m[1]) / Math.max(1e-6, Number(m[2])) : 16 / 9
  const a = ratio > 0 ? ratio : 16 / 9
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const edge = even(shortEdge)
  const long = even(edge * Math.max(a, 1 / a))
  return a >= 1 ? { width: long, height: edge } : { width: edge, height: long }
}

export { isAbort }
