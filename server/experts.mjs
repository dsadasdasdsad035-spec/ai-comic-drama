/**
 * 创意专家：仓库 experts/<id>/ + 设置库 creativeExperts 自定义项。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getSetting, setSetting } from './db.mjs'

const ID_RE = /^[a-z][a-z0-9-]{0,47}$/
const BUILTIN_ICON_NAMES = ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg', 'icon.jpeg']

function builtinIconPath(dir) {
  for (const name of BUILTIN_ICON_NAMES) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

function resolveExpertIconUrl(id, manifestIconUrl, dir, source) {
  const explicit = String(manifestIconUrl || '').trim()
  if (explicit) return explicit.slice(0, 2000)
  if (source === 'builtin' && dir && builtinIconPath(dir)) {
    return `/api/experts/${id}/icon`
  }
  return ''
}

export function safeExpertId(id) {
  const v = String(id ?? '').trim()
  if (!ID_RE.test(v)) throw new Error(`专家 id 不合法：${v || '(空)'}`)
  return v
}

function repoExpertsDir() {
  return path.join(process.cwd(), 'experts')
}

function readBuiltinExpert(dir, id) {
  const manifestPath = path.join(dir, 'manifest.json')
  const soulPath = path.join(dir, 'soul.md')
  if (!fs.existsSync(manifestPath) || !fs.existsSync(soulPath)) return null
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const soul = fs.readFileSync(soulPath, 'utf8')
  const expertId = String(manifest.id || id).trim()
  if (expertId !== id) return null
  return {
    id: expertId,
    name: String(manifest.name || expertId),
    description: String(manifest.description || ''),
    iconUrl: resolveExpertIconUrl(expertId, manifest.iconUrl, dir, 'builtin'),
    imageDescription: String(manifest.imageDescription || '').slice(0, 500),
    soul,
    skillIds: Array.isArray(manifest.skillIds) ? manifest.skillIds.map(String) : [],
    toolIds: Array.isArray(manifest.toolIds) ? manifest.toolIds.map(String) : [],
    source: 'builtin',
  }
}

export function listBuiltinExperts() {
  const root = repoExpertsDir()
  if (!fs.existsSync(root)) return []
  const out = []
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    if (!ID_RE.test(ent.name)) continue
    const row = readBuiltinExpert(path.join(root, ent.name), ent.name)
    if (row) out.push(row)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function getBuiltinExpert(id) {
  const safe = safeExpertId(id)
  const row = readBuiltinExpert(path.join(repoExpertsDir(), safe), safe)
  if (!row) throw new Error(`内置专家「${safe}」不存在`)
  return row
}

function readCustomExperts() {
  const raw = getSetting('creativeExperts')
  if (!Array.isArray(raw)) return []
  const out = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const id = String(row.id || '').trim()
    if (!ID_RE.test(id)) continue
    if (listBuiltinExperts().some((b) => b.id === id)) continue
    out.push({
      id,
      name: String(row.name || id),
      description: String(row.description || ''),
      iconUrl: String(row.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(row.imageDescription || '').slice(0, 500),
      soul: String(row.soul || ''),
      skillIds: Array.isArray(row.skillIds) ? row.skillIds.map(String) : [],
      toolIds: Array.isArray(row.toolIds) ? row.toolIds.map(String) : [],
      source: 'custom',
    })
  }
  return out
}

/** 内置 + 自定义；同 id 时自定义覆盖内置（不推荐，内置 id 应唯一） */
export function listAllExperts() {
  const byId = new Map(listBuiltinExperts().map((e) => [e.id, e]))
  for (const c of readCustomExperts()) byId.set(c.id, c)
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

export function getExpert(id) {
  const safe = safeExpertId(id)
  const custom = readCustomExperts().find((e) => e.id === safe)
  if (custom) return custom
  return getBuiltinExpert(safe)
}

export function mergeCustomExperts(incoming, { replace = false } = {}) {
  const builtinIds = new Set(listBuiltinExperts().map((e) => e.id))
  const base = replace ? [] : readCustomExperts()
  const byId = new Map(
    base.map((e) => [
      e.id,
      {
        id: e.id,
        name: e.name,
        description: e.description,
        iconUrl: e.iconUrl || '',
        imageDescription: e.imageDescription || '',
        soul: e.soul,
        skillIds: e.skillIds,
        toolIds: e.toolIds,
      },
    ]),
  )
  if (!Array.isArray(incoming)) throw new Error('experts 须为数组')
  for (const row of incoming) {
    if (!row || typeof row !== 'object') continue
    const id = safeExpertId(row.id)
    if (builtinIds.has(id)) throw new Error(`不能覆盖内置专家「${id}」`)
    byId.set(id, {
      id,
      name: String(row.name || id).slice(0, 120),
      description: String(row.description || '').slice(0, 500),
      iconUrl: String(row.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(row.imageDescription || '').slice(0, 500),
      soul: String(row.soul || ''),
      skillIds: Array.isArray(row.skillIds) ? row.skillIds.map(String) : [],
      toolIds: Array.isArray(row.toolIds) ? row.toolIds.map(String) : [],
    })
  }
  setSetting('creativeExperts', [...byId.values()])
  return listAllExperts()
}

export function saveCustomExperts(experts) {
  if (!Array.isArray(experts)) throw new Error('experts 须为数组')
  const builtinIds = new Set(listBuiltinExperts().map((e) => e.id))
  const normalized = []
  for (const row of experts) {
    if (!row || typeof row !== 'object') continue
    const id = safeExpertId(row.id)
    if (builtinIds.has(id)) throw new Error(`不能覆盖内置专家「${id}」`)
    normalized.push({
      id,
      name: String(row.name || id).slice(0, 120),
      description: String(row.description || '').slice(0, 500),
      iconUrl: String(row.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(row.imageDescription || '').slice(0, 500),
      soul: String(row.soul || ''),
      skillIds: Array.isArray(row.skillIds) ? row.skillIds.map(String) : [],
      toolIds: Array.isArray(row.toolIds) ? row.toolIds.map(String) : [],
    })
  }
  setSetting('creativeExperts', normalized)
  return normalized
}

const ICON_MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

/** @param {import('node:http').ServerResponse} res */
export function serveBuiltinExpertIcon(id, res) {
  const safe = safeExpertId(id)
  const dir = path.join(repoExpertsDir(), safe)
  const file = builtinIconPath(dir)
  if (!file) {
    res.statusCode = 404
    res.end()
    return
  }
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', ICON_MIME[ext] || 'application/octet-stream')
  res.setHeader('Cache-Control', 'public, max-age=3600')
  fs.createReadStream(file).pipe(res)
}