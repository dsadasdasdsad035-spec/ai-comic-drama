/** server/ingest.mjs 的类型声明（摄取适配器：上传 / 直链 / yt-dlp / DTK） */

export declare const MAX_SOURCE_BYTES: number
export declare const DOWNLOAD_TIMEOUT_MS: number

export interface IngestAdapterInfo {
  id: string
  label: string
  needsConfig: boolean
  ok: boolean
  reason: string
}

export interface IngestResult {
  adapter: string
  adapterLabel: string
  file: string
  bytes: number
  meta: Record<string, unknown>
  warnings: string[]
}

export declare function isVideoFile(name: unknown): boolean
export declare function assertPublicUrl(raw: unknown): Promise<URL>
export declare function listAdapters(config?: unknown): IngestAdapterInfo[]
export declare function ingestSource(
  input: { url?: string; data?: string; name?: string; adapter?: string },
  ctx: { sessionId: string; sourceId: string; sourcesDir: string },
  config?: unknown,
): Promise<IngestResult>
