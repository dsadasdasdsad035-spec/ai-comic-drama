export type WhiteboxCheckResult = {
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
  checks: Record<string, WhiteboxCheckResult>
  missing: string[]
  installHint?: string
  message?: string
  stateRoot?: string
}

export type WhiteboxJobStats = {
  frames: number
  integrated: number
  triangles: number
  vertices: number
  bbox: number[]
  bboxMaxEdge: number
  bytes: number
  seconds: number
}

export type WhiteboxJobSnapshot = {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  phase: string
  progress: number
  error: string | null
  errorCode: string | null
  sourceLabel: string
  glbUrl: string
  assetTitle: string
  stats: WhiteboxJobStats | null
  frames: number | null
  /** 抽帧间隔（秒）。重建质量主要由它决定 */
  interval?: number
  device: string | null
  startedAt: number | null
  finishedAt: number | null
  elapsedMs: number
}

export function whiteboxHealth(
  appRoot: string,
  opts?: { refresh?: boolean },
): Promise<WhiteboxHealth>

export function submitWhiteboxJob(input: unknown, appRoot: string): Promise<WhiteboxJobSnapshot>

export function getWhiteboxJob(id: string): WhiteboxJobSnapshot | null

export function listWhiteboxJobs(): WhiteboxJobSnapshot[]

export function cancelWhiteboxJob(id: string): WhiteboxJobSnapshot | null

export function cleanupStaleWhiteboxJobs(appRoot: string, maxAgeMs?: number): number

export function shutdownWhiteboxJobs(): void

export function venvPython(appRoot: string): string

export const WHITEBOX_CONCURRENCY: number
export const HARD_MAX_FRAMES: number
export const MIN_FRAMES: number
