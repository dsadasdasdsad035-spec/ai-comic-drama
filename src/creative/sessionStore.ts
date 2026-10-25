import type { AgentMessage } from '../agent/sceneAgentTypes'

export type CreativeMode = 'plan' | 'reverse' | 'remake'

export type CreativeSource = {
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

export type CreativeShot = {
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

export type CreativeArtifact = {
  id: string
  sessionId: string
  sourceId: string
  kind: string
  title: string
  payload: unknown
  modelLabel: string
  createdAt: string
}

export type CreativeSession = {
  id: string
  title: string
  mode: CreativeMode
  createdAt: string
  updatedAt: string
}

export type CreativeSessionSummary = CreativeSession & {
  sourceCount: number
  artifactCount: number
  messageCount: number
  sources: CreativeSource[]
  artifacts: CreativeArtifact[]
  shots: Record<string, CreativeShot[]>
}

export type CreativeThread = {
  sessionId: string
  messages: AgentMessage[]
  activeSkills: unknown[]
  updatedAt: string | null
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  const o = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!res.ok || o.ok === false) {
    const err = new Error(String(o.message || `创意请求失败（HTTP ${res.status}）`)) as Error & {
      kind?: string
    }
    if (typeof o.kind === 'string') err.kind = o.kind
    throw err
  }
  return o
}

export async function listCreativeSessions(limit = 100): Promise<CreativeSession[]> {
  const res = await fetch(`/api/creative/sessions?limit=${encodeURIComponent(String(limit))}`)
  const j = await readJson(res)
  return Array.isArray(j.sessions) ? (j.sessions as CreativeSession[]) : []
}

export async function createCreativeSession(init: {
  title?: string
  mode?: CreativeMode
} = {}): Promise<CreativeSession> {
  const res = await fetch('/api/creative/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(init),
  })
  const j = await readJson(res)
  if (!j.session) throw new Error('创建会话失败：响应缺少 session')
  return j.session as CreativeSession
}

export async function getCreativeSession(id: string): Promise<CreativeSessionSummary> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(id)}`)
  const j = await readJson(res)
  if (!j.session) throw new Error('读取会话失败：响应缺少 session')
  return j.session as CreativeSessionSummary
}

export async function patchCreativeSession(
  id: string,
  patch: { title?: string; mode?: CreativeMode },
): Promise<CreativeSession> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const j = await readJson(res)
  if (!j.session) throw new Error('更新会话失败：响应缺少 session')
  return j.session as CreativeSession
}

export async function deleteCreativeSession(id: string): Promise<boolean> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const j = await readJson(res)
  return Boolean(j.removed)
}

export async function loadCreativeThread(id: string): Promise<CreativeThread> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(id)}/thread`)
  const j = await readJson(res)
  const thread = j.thread as CreativeThread | undefined
  return {
    sessionId: id,
    messages: Array.isArray(thread?.messages) ? thread!.messages : [],
    activeSkills: Array.isArray(thread?.activeSkills) ? thread!.activeSkills : [],
    updatedAt: thread?.updatedAt ?? null,
  }
}

export async function saveCreativeThread(
  id: string,
  messages: AgentMessage[],
  activeSkills: unknown[] = [],
): Promise<CreativeThread> {
  const res = await fetch(`/api/creative/sessions/${encodeURIComponent(id)}/thread`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, activeSkills }),
  })
  const j = await readJson(res)
  return (j.thread as CreativeThread) ?? { sessionId: id, messages, activeSkills, updatedAt: null }
}

/** 会话标题：空标题时取首条用户消息的可读摘要 */
export function autoTitle(text: string, max = 24): string {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/https?:\/\/\S+/g, '')
    .trim()
  if (!clean) return ''
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}
