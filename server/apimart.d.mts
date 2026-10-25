/** server/apimart.mjs 的类型声明（APIMart/APIB 协议客户端） */

export type ApimartErrorKind =
  | 'auth'
  | 'billing'
  | 'rate-limit'
  | 'not-found'
  | 'bad-request'
  | 'timeout'
  | 'cancelled'
  | 'unsupported'
  | 'download'
  | 'network'
  | 'api'

export declare class ApimartError extends Error {
  kind: ApimartErrorKind
  status: number
  code: string
  taskId: string
  constructor(
    message: string,
    opts?: { kind?: ApimartErrorKind; status?: number; code?: string; taskId?: string },
  )
}

export interface ApimartCatalogEntry {
  id: string
  category: 'chat' | 'image' | 'video' | 'audio' | 'unknown'
  tags: string[]
  suggestedCaps: string[]
  runtime: 'ready' | 'catalog-only'
  reason?: string
  features?: Record<string, unknown>
}

export declare const APIMART_DEFAULT_VOICE: string
export declare const APIMART_VOICES: { id: string; label: string }[]
export declare const APIMART_TTS_MODELS: string[]

export declare function resolveBaseUrl(baseUrl?: string): string
export declare function errorFromResponse(text: string, status: number): ApimartError
export declare function isSupportedVideoModel(model: string): boolean
export declare function videoFamilyFor(model: string): string
export declare function mapCatalogEntry(raw: any): ApimartCatalogEntry | null
export declare function fetchCatalog(opts: {
  baseUrl: string
  apiKey: string
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<ApimartCatalogEntry[]>

export declare function uploadImage(opts: {
  baseUrl: string
  apiKey: string
  filePath?: string
  buffer?: Buffer | Uint8Array
  mime?: string
  filename?: string
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ url: string; filename: string; contentType: string }>

export declare function buildImagePayload(opts: {
  model: string
  prompt: string
  ratio?: string
  size?: string
  refUrls?: string[]
  n?: number
}): Record<string, unknown>

export declare function submitImage(opts: {
  baseUrl: string
  apiKey: string
  payload: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ taskId?: string; url?: string }>

export declare function buildVideoPayload(opts: {
  family: string
  model: string
  prompt: string
  ratio?: string
  seconds: number
  resolution?: string
  firstFrame?: string
  lastFrame?: string
  referenceImages?: string[]
  referenceVideos?: string[]
  audioUrl?: string
  generateAudio?: boolean
}): Record<string, unknown>

export declare function submitVideo(opts: {
  baseUrl: string
  apiKey: string
  payload: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ taskId: string }>

export declare function pollTask(opts: {
  baseUrl: string
  apiKey: string
  taskId: string
  signal?: AbortSignal
  timeoutMs?: number
  intervalMs?: number
  fetchImpl?: typeof fetch
  onProgress?: (p: { status: string; progress: number }) => void
}): Promise<any>

export declare function downloadResult(opts: {
  url: string
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ bytes: Buffer; contentType: string }>

export declare function imageUrlsFromTask(data: any): string[]
export declare function videoUrlFromTask(data: any): string
export declare function normalizeChatPayload(j: any): any
export declare function parseChatBody(raw: string, contentType?: string): any
export declare function normalizeSseChunk(raw: any): any
export declare function normalizeVoice(voice?: string): string

export declare function synthesizeSpeech(opts: {
  baseUrl: string
  apiKey: string
  text: string
  voice?: string
  model?: string
  format?: string
  speed?: number
  instructions?: string
  strictVoice?: boolean
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<{ audio: Buffer; contentType: string; voice: string }>
