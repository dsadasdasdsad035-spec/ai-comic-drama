/** server/creative.mjs 的类型声明（创意会话、线程、源视频、镜头与产物的存储操作） */

export declare const MAX_CREATIVE_THREAD_BYTES: number
export declare const CREATIVE_MODES: string[]

export type CreativeMode = 'plan' | 'reverse' | 'remake'

export interface CreativeSessionRecord {
  id: string
  title: string
  mode: CreativeMode
  createdAt: string
  updatedAt: string
}

export interface CreativeSourceRecord {
  id: string
  sessionId: string
  kind: string
  platform: string
  platformId: string
  author: string
  title: string
  url: string
  cover: string
  file: string
  bytes: number
  duration: number | null
  width: number | null
  height: number | null
  fps: number | null
  bitrate: number | null
  vcodec: string
  acodec: string
  hasAudio: boolean
  meta: Record<string, unknown>
  createdAt: string
}

export interface CreativeShotRecord {
  id: number
  sourceId: string
  index: number
  start: number
  end: number
  frames: string[]
  status: string
  analysis: unknown
  updatedAt: string
}

export interface CreativeArtifactRecord {
  id: string
  sessionId: string
  sourceId: string
  kind: string
  title: string
  payload: unknown
  modelLabel: string
  createdAt: string
}

export interface CreativeThreadRecord {
  sessionId: string
  messages: unknown[]
  activeSkills: unknown[]
  updatedAt: string | null
}

export interface CreativeSessionSummary extends CreativeSessionRecord {
  sourceCount: number
  artifactCount: number
  messageCount: number
  sources: CreativeSourceRecord[]
  artifacts: CreativeArtifactRecord[]
  shots: Record<string, CreativeShotRecord[]>
}

export declare function safeSessionId(id: unknown): string
export declare function newSessionId(): string
export declare function normalizeMode(mode: unknown): CreativeMode
export declare function creativesRoot(appRoot: string): string
export declare function sessionDir(appRoot: string, sessionId: string): string
export declare function ensureSessionDir(appRoot: string, sessionId: string): string
export declare function removeSessionDir(appRoot: string, sessionId: string): boolean
export declare function resolveCreativeFile(appRoot: string, ref: string): string

export declare function createSession(
  appRoot: string,
  init?: { id?: string; title?: string; mode?: unknown },
): CreativeSessionRecord
export declare function getSession(appRoot: string, id: string): CreativeSessionRecord | null
export declare function listSessions(appRoot: string, limit?: number): CreativeSessionRecord[]
export declare function touchSession(
  appRoot: string,
  id: string,
  patch?: { title?: string; mode?: unknown },
): CreativeSessionRecord | null
export declare function deleteSession(appRoot: string, id: string): boolean

export declare function getThread(appRoot: string, id: string): CreativeThreadRecord
export declare function saveThread(
  appRoot: string,
  id: string,
  messages: unknown[],
  activeSkills?: unknown[],
): CreativeThreadRecord

export declare function insertSource(
  appRoot: string,
  sessionId: string,
  source?: Record<string, unknown>,
): CreativeSourceRecord
export declare function getSource(appRoot: string, id: string): CreativeSourceRecord | null
export declare function listSources(appRoot: string, sessionId: string): CreativeSourceRecord[]
export declare function patchSource(
  appRoot: string,
  id: string,
  patch?: Record<string, unknown>,
): CreativeSourceRecord | null
export declare function deleteSource(appRoot: string, id: string): boolean

export declare function replaceShots(
  appRoot: string,
  sourceId: string,
  shots?: Array<Record<string, unknown>>,
): CreativeShotRecord[]
export declare function listShots(appRoot: string, sourceId: string): CreativeShotRecord[]
export declare function patchShot(
  appRoot: string,
  sourceId: string,
  index: number,
  patch?: Record<string, unknown>,
): CreativeShotRecord | null
export declare function markShotsStale(appRoot: string, sourceId: string): CreativeShotRecord[]

export declare function saveArtifact(
  appRoot: string,
  sessionId: string,
  artifact?: Record<string, unknown>,
): CreativeArtifactRecord
export declare function getArtifact(appRoot: string, id: string): CreativeArtifactRecord | null
export declare function listArtifacts(appRoot: string, sessionId: string): CreativeArtifactRecord[]
export declare function deleteArtifact(appRoot: string, id: string): boolean

export declare function sessionSummary(appRoot: string, sessionId: string): CreativeSessionSummary | null
