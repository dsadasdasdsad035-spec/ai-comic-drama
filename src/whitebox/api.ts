/**
 * 视频转白模的客户端接口。
 *
 * 作业是异步的：POST 建任务拿 id，然后轮询 progress。轮询间隔 1.2 秒——
 * 实测单次转换 7~31 秒，1.2 秒能让进度条走得够顺又不会把服务端打满。
 */

export type WhiteboxCheck = {
  ok: boolean
  value?: unknown
  required?: string
  reason?: string
}

export type WhiteboxHealth = {
  ok: boolean
  installed?: boolean
  venv?: string
  venvExists?: boolean
  checks: Record<string, WhiteboxCheck>
  missing: string[]
  installHint?: string
  message?: string
  stateRoot?: string
}

export type WhiteboxStats = {
  frames: number
  integrated: number
  triangles: number
  vertices: number
  bbox: number[]
  bboxMaxEdge: number
  bytes: number
  seconds: number
}

export type WhiteboxJob = {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  progress: number
  error: string | null
  errorCode: string | null
  sourceLabel: string
  /** video = 一段视频抽帧；images = 用户挑的多张图 */
  sourceType?: 'video' | 'images'
  imageCount?: number
  glbUrl: string
  assetTitle: string
  stats: WhiteboxStats | null
  frames: number | null
  device: string | null
  startedAt: number | null
  finishedAt: number | null
  elapsedMs: number
}

export type WhiteboxSubmitInput = {
  projectName: string
  /** 视频模式：一段视频的站内 URL（与 imageUrls 二选一） */
  videoUrl?: string
  /** 图片模式：一组图片的站内 URL，建议 8–16 张（与 videoUrl 二选一） */
  imageUrls?: string[]
  /** 抽帧间隔（秒），默认 0.5。决定相邻帧重叠度，比帧数更关键 */
  interval?: number
  maxFrames?: number
  targetSize?: number
  resolution?: number
}

/** 作业失败时抛这个，带上 errorCode 让 UI 能按原因给不同文案。 */
export class WhiteboxError extends Error {
  code: string
  health?: WhiteboxHealth
  constructor(message: string, code = 'error', health?: WhiteboxHealth) {
    super(message)
    this.code = code
    this.health = health
  }
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new WhiteboxError(`服务端返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
}

export async function fetchWhiteboxHealth(refresh = false): Promise<WhiteboxHealth> {
  const res = await fetch(`/api/whitebox/health${refresh ? '?refresh=1' : ''}`)
  const data = await readJson(res)
  // 体检接口在环境不完整时仍返回 200 + ok:false，这是正常结果而非 HTTP 错误
  return data as WhiteboxHealth
}

export async function submitWhiteboxJob(input: WhiteboxSubmitInput): Promise<WhiteboxJob> {
  const res = await fetch('/api/whitebox/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await readJson(res)
  if (!data?.ok) {
    throw new WhiteboxError(data?.message || '提交转换失败', data?.code || 'error', data?.health)
  }
  return data.job as WhiteboxJob
}

export async function fetchWhiteboxJob(id: string): Promise<WhiteboxJob> {
  const res = await fetch(`/api/whitebox/progress?id=${encodeURIComponent(id)}`)
  const data = await readJson(res)
  if (!data?.ok) throw new WhiteboxError(data?.message || '读取进度失败')
  return data.job as WhiteboxJob
}

export async function cancelWhiteboxJob(id: string): Promise<WhiteboxJob> {
  const res = await fetch('/api/whitebox/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  const data = await readJson(res)
  if (!data?.ok) throw new WhiteboxError(data?.message || '取消失败')
  return data.job as WhiteboxJob
}

/** 阶段标签：与服务端的 phase 值一一对应 */
export const PHASE_LABEL: Record<string, string> = {
  queued: '排队中',
  starting: '准备中',
  infer: '抽帧与推理',
  mesh: '网格化',
  publish: '保存产物',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
}

/** 错误码 → 可读文案。spec 要求每种失败都给具体原因，不能只说「失败」。 */
export function whiteboxErrorText(code: string | null, message: string | null): string {
  switch (code) {
    case 'env-missing':
      return `推理环境未就绪：${message || '缺少依赖'}`
    case 'frames-too-few':
      return `素材不足：${message || '可用的帧或图片少于 4 张'}`
    case 'inference-failed':
      return `推理失败：${message || '未知原因'}`
    case 'mesh-failed':
      return `重建失败：${message || '未知原因'}`
    case 'timeout':
      return `转换超时：${message || '已自动中止'}`
    case 'cancelled':
      return '已取消'
    default:
      return message || '转换失败'
  }
}
