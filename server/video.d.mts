/** server/video.mjs 的类型声明（方舟视频任务客户端） */

export interface VideoCaps {
  minDuration: number
  maxDuration: number
  resolutions: string[]
}

export declare class VideoParamError extends Error {
  kind: 'bad-request'
  details: Record<string, unknown>
  constructor(message: string, details?: Record<string, unknown>)
}

export declare class VideoError extends Error {
  kind: string
  status: number
  code: string
  constructor(message: string, opts?: { kind?: string; status?: number; code?: string })
}

export declare function videoCapsFor(model: string): VideoCaps | null

export interface VideoPayloadOptions {
  model: string
  prompt: string
  ratio?: string
  seconds: number | string
  resolution?: string
  cameraFixed?: boolean
  returnLastFrame?: boolean
  firstFrame?: string
  lastFrame?: string
  referenceImages?: string[]
  /** Seedance 2.0/2.5 的参考视频；非空时进入全模态参考模式 */
  referenceVideos?: string[]
  /** 2.5 传 'reference' 显式指定参考生视频；2.0 留空 */
  videoRefTaskType?: 'reference' | ''
}

export declare function buildVideoPayload(opts: VideoPayloadOptions): Record<string, unknown>

export declare function submitVideoTask(opts: {
  baseUrl: string
  apiKey: string
  payload: Record<string, unknown>
  fetchImpl?: typeof fetch
}): Promise<{ taskId: string; response: any }>

export declare function fetchVideoTask(opts: {
  baseUrl: string
  apiKey: string
  taskId: string
  fetchImpl?: typeof fetch
}): Promise<any>

export declare function pollVideoTask(opts: {
  baseUrl: string
  apiKey: string
  taskId: string
  intervalMs?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}): Promise<{
  status: string
  taskId: string
  videoUrl: string
  lastFrameUrl: string
  raw: any
}>

export declare function downloadVideoArtifacts(opts: {
  videoUrl: string
  lastFrameUrl?: string
  videoDir: string
  frameDir: string
  fetchImpl?: typeof fetch
}): Promise<{ url: string; tail: string }>
