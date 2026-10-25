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

export type BlenderJobSnapshot = {
  id: string
  tier: 'trial' | 'proxy' | 'final'
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

export type BlenderRenderInput = {
  code: string
  assets?: BlenderAsset[]
  width: number
  height: number
  fps: number
  duration: number
  tier?: 'trial' | 'proxy' | 'final'
  engine?: string
  samples?: number
  mode?: 'clean' | 'review'
  shot?: Record<string, unknown>
  times?: number[]
  keyTimes?: number[]
}

export const BLENDER_DEFAULTS: BlenderHealth['defaults']
export const BLENDER_CONCURRENCY: number
export function resolveBlenderBin(): string | null
export function resolveFfmpeg(): string
export function resolveAssetFile(appRoot: string, url: string): string
export function blenderHealth(opts?: { refresh?: boolean }): Promise<BlenderHealth>
export function submitRenderJob(input: BlenderRenderInput, appRoot: string): Promise<BlenderJobSnapshot>
export function getRenderJob(id: string): BlenderJobSnapshot | null
export function listRenderJobs(): BlenderJobSnapshot[]
export function cancelRenderJob(id: string, reason?: string): BlenderJobSnapshot | null
export function cleanupStaleJobs(appRoot: string, maxAgeMs?: number): number
export function shutdownRenderJobs(): void
