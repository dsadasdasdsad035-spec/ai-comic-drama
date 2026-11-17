import type { SkillTextRecord } from './types'

type SkillsResponse = {
  ok?: boolean
  message?: string
  skills?: SkillTextRecord[]
  errors?: { id: string; message: string }[]
}

async function readJson<T>(res: Response): Promise<T & { ok?: boolean; message?: string }> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  const out = (body && typeof body === 'object' ? body : {}) as T & { ok?: boolean; message?: string }
  if (!res.ok || out.ok === false) {
    throw new Error(out.message || `技能请求失败（HTTP ${res.status}）`)
  }
  return out
}

export async function listSkillTexts(): Promise<SkillTextRecord[]> {
  const res = await fetch('/api/skills')
  const j = await readJson<SkillsResponse>(res)
  if (!Array.isArray(j.skills)) throw new Error('技能响应缺少 skills')
  return j.skills
}

/** 读技能包内单个文件；路径相对技能目录，由服务端做越界与大小校验 */
export async function readSkillFile(
  id: string,
  path: string,
): Promise<{ path: string; bytes: number; source: 'installed' | 'builtin'; text: string }> {
  const q = new URLSearchParams({ path })
  const res = await fetch(`/api/skills/${encodeURIComponent(id)}/files?${q.toString()}`)
  const j = await readJson<{ path?: string; bytes?: number; source?: 'installed' | 'builtin'; text?: string }>(res)
  if (typeof j.text !== 'string') throw new Error('文件响应缺少 text')
  return { path: j.path || path, bytes: Number(j.bytes || 0), source: j.source || 'builtin', text: j.text }
}

export async function saveSkillOverride(id: string, body: string, baseVersion: number): Promise<SkillTextRecord> {
  const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, baseVersion }),
  })
  const j = await readJson<{ skill?: SkillTextRecord }>(res)
  if (!j.skill) throw new Error('保存技能覆盖失败：响应缺少 skill')
  return j.skill
}

export async function resetSkillOverride(id: string): Promise<SkillTextRecord> {
  const res = await fetch(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const j = await readJson<{ skill?: SkillTextRecord }>(res)
  if (!j.skill) throw new Error('恢复默认失败：响应缺少 skill')
  return j.skill
}
