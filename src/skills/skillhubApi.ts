import type { SkillTextRecord } from './types'

export type SkillHubListItem = {
  slug: string
  namespace: string
  name: string
  description: string
  category: string
  version: string
  iconUrl?: string
  downloads: number
  stars: number
  verified?: boolean
  homepage: string
}

export type SkillHubDetail = {
  slug: string
  namespace: string
  name: string
  summary: string
  category: string
  iconUrl?: string
  downloads: number
  stars: number
  homepage: string
  latestVersion: string
  changelog: string
}

type JsonOut = { ok?: boolean; message?: string }

async function readJson<T>(res: Response): Promise<T & JsonOut> {
  const j = (await res.json().catch(() => ({}))) as T & JsonOut
  if (!res.ok || j.ok === false) throw new Error(j.message || `请求失败（HTTP ${res.status}）`)
  return j
}

export async function fetchSkillhubCategories(): Promise<Array<{ key: string; name: string }>> {
  const res = await fetch('/api/skillhub/categories')
  const j = await readJson<{ items?: Array<{ key: string; name: string }> }>(res)
  return j.items || []
}

export async function fetchSkillhubDetail(slug: string, namespace?: string): Promise<SkillHubDetail> {
  const q = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
  const res = await fetch(`/api/skillhub/skills/${encodeURIComponent(slug)}${q}`)
  const j = await readJson<{ detail?: SkillHubDetail }>(res)
  if (!j.detail) throw new Error('SkillHub 未返回技能详情')
  return j.detail
}

export async function searchSkillhubMarket(params: {
  keyword?: string
  category?: string
  page?: number
  pageSize?: number
}): Promise<{ total: number; page: number; pageSize: number; items: SkillHubListItem[] }> {
  const q = new URLSearchParams()
  if (params.keyword) q.set('keyword', params.keyword)
  if (params.category) q.set('category', params.category)
  q.set('page', String(params.page ?? 1))
  q.set('pageSize', String(params.pageSize ?? 24))
  const res = await fetch(`/api/skillhub/skills?${q}`)
  const j = await readJson<{
    total?: number
    page?: number
    pageSize?: number
    items?: SkillHubListItem[]
  }>(res)
  return {
    total: j.total ?? 0,
    page: j.page ?? 1,
    pageSize: j.pageSize ?? 24,
    items: j.items || [],
  }
}

export async function installSkillFromSkillhub(input: {
  slug: string
  namespace?: string
  version?: string
  id?: string
}): Promise<SkillTextRecord> {
  const res = await fetch('/api/skillhub/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const j = await readJson<{ skill?: SkillTextRecord }>(res)
  if (!j.skill) throw new Error('安装响应缺少 skill')
  return j.skill
}

export async function uninstallSkill(id: string): Promise<void> {
  const res = await fetch(`/api/skill-installs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await readJson(res)
}

export async function uploadSkillZip(file: File): Promise<SkillTextRecord> {
  const buf = await file.arrayBuffer()
  const res = await fetch('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: buf,
  })
  const j = await readJson<{ skill?: SkillTextRecord }>(res)
  if (!j.skill) throw new Error('上传响应缺少 skill')
  return j.skill
}
