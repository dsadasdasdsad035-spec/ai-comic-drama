/** server/files.mjs 的类型声明（方舟 Files API 客户端） */

export declare const MAX_VIDEO_BYTES: number
export declare const MIN_VIDEO_SECONDS: number

export interface ArkFile {
  id: string
  status: string
  download_url: string
  expire_at: number
  error?: { code?: string; message?: string }
  raw: any
}

export declare class FileError extends Error {
  kind: string
  status: number
  fileId: string
  stage: string
  constructor(
    message: string,
    opts?: { kind?: string; status?: number; fileId?: string; stage?: string },
  )
}

export declare function uploadFile(opts: {
  baseUrl: string
  apiKey: string
  filePath: string
  mime?: string
  fetchImpl?: typeof fetch
}): Promise<ArkFile>

export declare function getFile(opts: {
  baseUrl: string
  apiKey: string
  fileId: string
  fetchImpl?: typeof fetch
}): Promise<ArkFile>

export declare function waitFileActive(opts: {
  baseUrl: string
  apiKey: string
  fileId: string
  intervalMs?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  sleepImpl?: (ms: number) => Promise<void>
}): Promise<ArkFile>

export declare function validateVideoFile(opts: {
  filePath: string
  seconds: number
  maxDuration?: number
}): { bytes: number; seconds: number; ext: string }

export declare function fileCacheKey(filePath: string): string
export declare function clearFileCache(): void

export declare function ensureUploadedVideo(opts: {
  baseUrl: string
  apiKey: string
  filePath: string
  seconds: number
  maxDuration?: number
  fetchImpl?: typeof fetch
  intervalMs?: number
  timeoutMs?: number
  sleepImpl?: (ms: number) => Promise<void>
}): Promise<{ fileId: string; downloadUrl: string; reused: boolean }>
