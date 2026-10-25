/** server/lipsync.mjs 的类型声明 */
export declare class LipSyncError extends Error {
  kind: string
  status: number
  code: string
  constructor(message: string, opts?: { kind?: string; status?: number; code?: string })
}

export declare const SYNC_LABS_DEFAULT_BASE: string

export declare function runSyncLabs(opts: {
  baseUrl?: string
  apiKey: string
  videoFile: string
  audioFile: string
  outputFile: string
  model?: string
  timeoutMs?: number
  pollMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  onProgress?: (phase: string) => void
}): Promise<{
  outputFile: string
  jobId: string
  videoAssetId: string
  audioAssetId: string
  provider: string
}>
