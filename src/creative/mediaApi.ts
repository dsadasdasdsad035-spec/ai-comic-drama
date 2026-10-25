import type { CreativeArtifact, CreativeSessionSummary, CreativeShot, CreativeSource } from './sessionStore'

export type IngestResponse = {
  adapter: string
  adapterLabel: string
  warnings: string[]
  probeError?: string
  source: CreativeSource
}

export type ProbeResponse = {
  probe: {
    duration: number | null
    width: number | null
    height: number | null
    fps: number | null
    bitrate: number | null
    vcodec: string
    acodec: string
    hasAudio: boolean
  }
  source: CreativeSource
}

export type SplitResponse = {
  duration: number
  threshold: number
  shots: CreativeShot[]
  staleCount: number
}

export type FramesResponse = {
  framesPerShot: number
  shots: Array<{ index: number; frames: string[]; times: number[]; errors?: string[]; shot?: CreativeShot }>
}

export type AdapterInfo = {
  id: string
  label: string
  needsConfig: boolean
  ok: boolean
  reason: string
}

export type AdaptersResponse = {
  adapters: AdapterInfo[]
  ffmpeg: { ok: boolean; ffmpeg: string; ffprobe: string }
  analysis: { depth?: string; threshold?: number; minShotSeconds?: number; framesPerShot?: number }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON */
  }
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!res.ok || o.ok === false) {
    const err = new Error(String(o.message || `请求失败（HTTP ${res.status}）`)) as Error & { kind?: string }
    if (typeof o.kind === 'string') err.kind = o.kind
    throw err
  }
  return o
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
  return readJson(res)
}

export async function listCreativeAdapters(): Promise<AdaptersResponse> {
  const res = await fetch('/api/creative/adapters')
  const j = await readJson(res)
  return {
    adapters: Array.isArray(j.adapters) ? (j.adapters as AdapterInfo[]) : [],
    ffmpeg: (j.ffmpeg as AdaptersResponse['ffmpeg']) ?? { ok: false, ffmpeg: '', ffprobe: '' },
    analysis: (j.analysis as AdaptersResponse['analysis']) ?? {},
  }
}

export async function ingestCreative(input: {
  sessionId: string
  url?: string
  data?: string
  name?: string
  adapter?: string
}): Promise<IngestResponse> {
  const j = await postJson('/api/creative/ingest', input)
  return {
    adapter: String(j.adapter || ''),
    adapterLabel: String(j.adapterLabel || ''),
    warnings: Array.isArray(j.warnings) ? (j.warnings as string[]) : [],
    ...(j.probeError ? { probeError: String(j.probeError) } : {}),
    source: j.source as CreativeSource,
  }
}

export async function probeCreativeSource(sourceId: string): Promise<ProbeResponse> {
  const j = await postJson('/api/creative/analyze', { sourceId, action: 'probe' })
  return { probe: j.probe as ProbeResponse['probe'], source: j.source as CreativeSource }
}

export async function splitCreativeSource(sourceId: string, threshold?: number): Promise<SplitResponse> {
  const j = await postJson('/api/creative/analyze', { sourceId, action: 'split', threshold })
  return {
    duration: Number(j.duration) || 0,
    threshold: Number(j.threshold) || 0,
    shots: Array.isArray(j.shots) ? (j.shots as CreativeShot[]) : [],
    staleCount: Number(j.staleCount) || 0,
  }
}

export async function extractFrames(
  sourceId: string,
  opts: { shotIndexes?: number[]; framesPerShot?: number; overwrite?: boolean } = {},
): Promise<FramesResponse> {
  const j = await postJson('/api/creative/analyze', { sourceId, action: 'frames', ...opts })
  return {
    framesPerShot: Number(j.framesPerShot) || 1,
    shots: Array.isArray(j.shots) ? (j.shots as FramesResponse['shots']) : [],
  }
}

export async function analyzeCreative(
  sourceId: string,
  action: 'probe' | 'split' | 'frames',
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return postJson('/api/creative/analyze', { sourceId, action, ...extra })
}

/** 直接保存反推产物（工具内部用；服务端会二次校验 reverse-v1） */
export async function saveReverseArtifact(
  sessionId: string,
  payload: Record<string, unknown>,
  opts: { sourceId?: string; title?: string; modelLabel?: string } = {},
): Promise<CreativeArtifact> {
  const j = await postJson('/api/creative/artifacts', {
    sessionId,
    kind: 'reverse',
    title: opts.title || '',
    sourceId: opts.sourceId || '',
    modelLabel: opts.modelLabel || '',
    payload,
  })
  return j.artifact as CreativeArtifact
}

export async function listCreativeArtifacts(sessionId: string): Promise<CreativeArtifact[]> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(sessionId)}/artifacts`)
  const j = await readJson(res)
  return Array.isArray(j.artifacts) ? (j.artifacts as CreativeArtifact[]) : []
}

export type PromoteResult = {
  projectName: string
  created: boolean
  shots: number
  updated?: number
  newShots?: number
  kept?: number
  savedShots: number
}

export async function promoteCreativeArtifact(input: {
  artifactId: string
  target: 'new' | 'existing'
  projectName?: string
  title?: string
  style?: string
  aspect?: string
  episode?: number
  sourceUrl?: string
}): Promise<PromoteResult> {
  const j = await postJson('/api/creative/promote', input)
  return j as unknown as PromoteResult
}

export type ExportResult = {
  format: 'json'
  title: string
  payload: Record<string, unknown>
  text: string
}

export async function downloadCreativeExport(artifactId: string): Promise<ExportResult> {
  const j = await postJson('/api/creative/export', { artifactId })
  return {
    format: 'json',
    title: String(j.title || ''),
    payload: (j.payload as Record<string, unknown>) ?? {},
    text: String(j.text || ''),
  }
}

/** 会话恢复时一次性拿到源、镜头与产物 */
export async function loadCreativeSession(sessionId: string): Promise<CreativeSessionSummary> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(sessionId)}`)
  const j = await readJson(res)
  return j.session as CreativeSessionSummary
}
