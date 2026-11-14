import type { CreativeExpert } from './expertTypes'

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j.ok === false) throw new Error(String(j.message || `HTTP ${res.status}`))
  return j as Record<string, unknown>
}

export async function fetchExperts(): Promise<CreativeExpert[]> {
  const j = await readJson(await fetch('/api/experts'))
  return Array.isArray(j.experts) ? (j.experts as CreativeExpert[]) : []
}

export async function fetchExpert(id: string): Promise<CreativeExpert> {
  const j = await readJson(await fetch(`/api/experts/${encodeURIComponent(id)}`))
  if (!j.expert) throw new Error('专家不存在')
  return j.expert as CreativeExpert
}

export function expertExportZipUrl(id: string): string {
  return `/api/experts/${encodeURIComponent(id)}/export-zip`
}

export async function importExpertsZip(file: File): Promise<CreativeExpert[]> {
  const res = await fetch('/api/experts/import-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: await file.arrayBuffer(),
  })
  const j = await readJson(res)
  return Array.isArray(j.experts) ? (j.experts as CreativeExpert[]) : []
}

export async function saveCustomExperts(experts: CreativeExpert[]): Promise<CreativeExpert[]> {
  const j = await readJson(
    await fetch('/api/experts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        experts: experts
          .filter((e) => e.source === 'custom')
          .map(({ id, name, description, soul, skillIds, toolIds }) => ({
            id,
            name,
            description,
            soul,
            skillIds,
            toolIds,
          })),
      }),
    }),
  )
  return Array.isArray(j.experts) ? (j.experts as CreativeExpert[]) : []
}