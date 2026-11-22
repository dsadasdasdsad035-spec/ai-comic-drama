/** server/rea-video.mjs 的类型声明（rea-video 拆解作业宿主） */

export interface ReverseTier {
  id: string
  label: string
  hint: string
  downloads: Array<{ name: string; mb: number }>
  downloadMb: number
}

export type ReverseLabelKey =
  | 'live_action'
  | 'ai_video'
  | 'avatar'
  | 'cg_3d'
  | 'code_render'
  | 'screen_capture'
  | 'still_motion'
  | 'static_hold'
  | 'anim_2d'
  | 'stop_motion'
  | 'film_footage'

export interface ReverseShot {
  index: number
  start: number
  end: number
  duration: number
  kind: string
  kindLabel: string
  unknownKind: boolean
  confidence: number | null
  decidedBy: string
  evidence: string[]
  keyframePrompt: string
  videoPrompt: string
  videoPromptEn: string
  promptMissing: boolean
  remakeRoute: string[]
  remakeExecutor: string
  remakeNote: string
  remakeRule: string
  evidenceFrames: string[]
  evidenceMissing: boolean
  assets: { sheet: string; firstFrame: string; lastFrame: string }
}

export interface ParsedBreakdown {
  shots: ReverseShot[]
  vlmStatus: string
  vlmNote: string
  duration: number
  engine: string
  globalStyle: string
  aspect: string
  width: number
  height: number
  fps: number
  storyboardUrl?: string
  mediaDir?: string
}

export interface ReaHealth {
  ok: boolean
  path: string | null
  reason: string
  message: string
  version: string
}

export interface ReverseJobSnapshot {
  id: string
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled'
  reason: string
  phase: string
  tier: string
  title: string
  videoUrl: string
  elapsedMs: number
  timeoutMs: number
  tail: string[]
  error: string | null
  vlm: string
  result: {
    shots: number
    vlmStatus: string
    vlmNote: string
    duration: number
    engine: string
    storyboardUrl: string
    reportUrl: string
    vlmModel: string
  } | null
}

export declare const REVERSE_TIERS: Record<string, ReverseTier>
export declare const REVERSE_LABELS: Record<ReverseLabelKey, string>
export declare const REA_CONCURRENCY: number
export declare const REA_INSTALL_HINT: string

export declare function listReverseTiers(): ReverseTier[]
export declare function normalizeTier(raw: unknown): string
export declare function resolveReaBin(): string | null
export declare function reaHealth(opts?: { bin?: string; force?: boolean }): Promise<ReaHealth>
export declare function getReverseJob(id: string): ReverseJobSnapshot | null
export declare function listReverseJobs(limit?: number): ReverseJobSnapshot[]
export declare function cancelReverseJob(id: string, reason?: string): ReverseJobSnapshot | null
export declare function vlmEnvFrom(
  entry: { model?: string } | null | undefined,
  provider: { baseUrl?: string; apiKey?: string; key?: string } | null | undefined,
  opts?: { localProxy?: string; internalToken?: string },
): { env: Record<string, string>; configured: boolean; viaProxy?: boolean }
export declare function createReverseJob(
  appRoot: string,
  input?: Record<string, unknown>,
): Promise<ReverseJobSnapshot>
export declare function parseBreakdown(doc: unknown): ParsedBreakdown
export declare function parseJobArtifacts(job: unknown, appRoot: string): ParsedBreakdown
export declare function cleanupStaleReverseJobs(appRoot: string, maxAgeMs?: number): number
export declare function shutdownReverseJobs(): void
export declare function resetReverseState(): void
export declare function adoptReverseJob(
  jobOrId: string | unknown,
  input?: { title?: string; project?: string },
): Record<string, unknown>
