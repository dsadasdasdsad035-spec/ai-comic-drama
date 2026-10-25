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
