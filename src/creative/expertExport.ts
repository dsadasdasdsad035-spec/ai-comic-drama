import { strToU8, zipSync } from 'fflate'
import type { CreativeExpert } from './expertTypes'

export type ExpertExportBundle = {
  version: 1
  exportedAt: string
  experts: Array<{
    id: string
    name: string
    description: string
    iconUrl?: string
    imageDescription?: string
    soul: string
    skillIds: string[]
    toolIds: string[]
  }>
}

export function buildExpertExportBundle(customExperts: CreativeExpert[]): ExpertExportBundle {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    experts: customExperts.map(
      ({ id, name, description, iconUrl, imageDescription, soul, skillIds, toolIds }) => ({
        id,
        name,
        description,
        iconUrl: iconUrl || '',
        imageDescription: imageDescription || '',
        soul,
        skillIds: [...skillIds],
        toolIds: [...toolIds],
      }),
    ),
  }
}

export function downloadExpertBundle(bundle: ExpertExportBundle, fileName = 'creative-experts.json') {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

const ID_RE = /^[a-z][a-z0-9-]{0,47}$/

export function parseExpertImportBundle(raw: unknown): ExpertExportBundle['experts'] {
  if (!raw || typeof raw !== 'object') throw new Error('导入文件不是合法 JSON 对象')
  const o = raw as Record<string, unknown>
  let rows = o.experts
  if (!Array.isArray(rows) && Array.isArray(raw)) rows = raw
  if (!Array.isArray(rows)) throw new Error('缺少 experts 数组')
  const out: ExpertExportBundle['experts'] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = String(r.id || '').trim()
    if (!ID_RE.test(id)) throw new Error(`专家 id 不合法：${id || '(空)'}`)
    out.push({
      id,
      name: String(r.name || id).slice(0, 120),
      description: String(r.description || '').slice(0, 500),
      iconUrl: String(r.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(r.imageDescription || '').slice(0, 500),
      soul: String(r.soul || ''),
      skillIds: Array.isArray(r.skillIds) ? r.skillIds.map(String) : [],
      toolIds: Array.isArray(r.toolIds) ? r.toolIds.map(String) : [],
    })
  }
  if (!out.length) throw new Error('未解析到任何专家')
  return out
}

export function mergeCustomExpertRows(
  existing: CreativeExpert[],
  incoming: ExpertExportBundle['experts'],
  mode: 'merge' | 'replace',
): CreativeExpert[] {
  if (mode === 'replace') {
    return incoming.map((r) => ({ ...r, source: 'custom' as const }))
  }
  const byId = new Map(existing.filter((e) => e.source === 'custom').map((e) => [e.id, e]))
  for (const r of incoming) {
    byId.set(r.id, { ...r, source: 'custom' })
  }
  return [...byId.values()]
}

function expertZipFileEntries(expert: CreativeExpert): Record<string, Uint8Array> {
  const id = expert.id
  const manifest = JSON.stringify(
    {
      id,
      name: expert.name,
      description: expert.description,
      iconUrl: expert.iconUrl || '',
      imageDescription: expert.imageDescription || '',
      skillIds: expert.skillIds,
      toolIds: expert.toolIds,
    },
    null,
    2,
  )
  return {
    [`${id}/manifest.json`]: strToU8(manifest),
    [`${id}/soul.md`]: strToU8(expert.soul),
  }
}

/** 浏览器侧打包多个自定义专家为一个 zip */
export function downloadExpertsZipBundle(experts: CreativeExpert[], fileName = 'creative-experts.zip') {
  const files: Record<string, Uint8Array> = {}
  for (const e of experts) Object.assign(files, expertZipFileEntries(e))
  const blob = new Blob([new Uint8Array(zipSync(files))], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadExpertZipFromUrl(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.click()
}

export function notifyCreativeExpertsChanged() {
  try {
    window.dispatchEvent(new Event('creative-experts-changed'))
  } catch {
    /* SSR */
  }
}

export function cloneExpertAsCustom(
  src: CreativeExpert,
  existing: CreativeExpert[],
  newId?: string,
): CreativeExpert {
  let base = (newId?.trim() || `${src.id}-custom`).slice(0, 48)
  if (!ID_RE.test(base)) base = `expert-${Date.now()}`
  const taken = new Set(existing.map((e) => e.id))
  let id = base
  let n = 2
  while (taken.has(id)) {
    const suffix = `-${n++}`
    id = `${base.slice(0, Math.max(1, 48 - suffix.length))}${suffix}`
  }
  return {
    id,
    name: `${src.name}（自定义）`,
    description: src.description,
    iconUrl: src.iconUrl,
    imageDescription: src.imageDescription,
    soul: src.soul,
    skillIds: [...src.skillIds],
    toolIds: [...src.toolIds],
    source: 'custom',
  }
}