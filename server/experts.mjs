/**
 * 创意专家：仓库 experts/<id>/（内置）+ 宿主配置目录（自定义）。
 *
 * 自定义专家的权威来源是 `<状态根>/dsh/experts/<id>/manifest.json + soul.md`：
 * 宿主配置目录就是专家真正的「家」，本应用与 dsh 读的是同一份文件。
 * 早期版本把自定义专家存在设置库的 `creativeExperts` 里，首次读取时自动搬迁，
 * 搬迁后设置里的那份只当备份，不再回写。
 */
import fs from 'node:fs'
import path from 'node:path'
import { getSetting, setSetting } from './db.mjs'
import { statePath } from './paths.mjs'

const ID_RE = /^[a-z][a-z0-9-]{0,47}$/
const BUILTIN_ICON_NAMES = ['icon.svg', 'icon.png', 'icon.webp', 'icon.jpg', 'icon.jpeg']
/** 迁移完成标记：搬迁只做一次 */
const MIGRATED_KEY = 'creativeExpertsMigrated'

/** 自定义专家根：宿主配置目录下的 experts/ */
function customExpertsDir() {
  return statePath(process.cwd(), 'dsh', 'experts')
}

/** 快照/技能等派生目录不能当专家读，否则会被当成一个「没有 soul 的专家」 */
const RESERVED_DIRS = new Set(['compiled', 'skills'])

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

/** 把旧设置里的自定义专家搬到宿主配置目录；只做一次，失败不阻断读取 */
function migrateLegacyCustomExperts(log = () => {}) {
  try {
    if (getSetting(MIGRATED_KEY)) return
    const legacy = getSetting('creativeExperts')
    if (Array.isArray(legacy) && legacy.length) {
      const builtinIds = new Set(listBuiltinExperts().map((b) => b.id))
      for (const row of legacy) {
        if (!row || typeof row !== 'object') continue
        const id = String(row.id || '').trim()
        if (!ID_RE.test(id) || builtinIds.has(id)) continue
        writeExpertFiles({
          id,
          name: row.name,
          description: row.description,
          skillIds: row.skillIds,
          toolIds: row.toolIds,
          soul: row.soul,
        })
      }
      log(`[experts] 已把 ${legacy.length} 个旧自定义专家搬迁到宿主配置目录`)
    }
    setSetting(MIGRATED_KEY, true)
  } catch (e) {
    const message = e?.message || String(e)
    // 读设置不需要库（例如纯编译器测试）时静默跳过，不当成故障
    if (!/DB 未打开/.test(message)) {
      log(`[experts] 旧自定义专家搬迁失败（保留设置库原值）：${message}`)
    }
  }
}

/** 写一个自定义专家到宿主配置目录 */
function writeExpertFiles(expert) {
  const id = safeExpertId(expert.id)
  const dir = path.join(customExpertsDir(), id)
  fs.mkdirSync(dir, { recursive: true })
  const manifest = {
    id,
    name: String(expert.name || id).slice(0, 120),
    description: String(expert.description || '').slice(0, 500),
    skillIds: Array.isArray(expert.skillIds) ? expert.skillIds.map(String) : [],
    toolIds: Array.isArray(expert.toolIds) ? expert.toolIds.map(String) : [],
    source: 'custom',
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(dir, 'soul.md'), String(expert.soul || ''), 'utf8')
  return { id, dir }
}

function readCustomExperts() {
  const root = customExpertsDir()
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const builtinIds = new Set(listBuiltinExperts().map((b) => b.id))
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_DIRS.has(entry.name)) continue
    const id = entry.name
    if (!ID_RE.test(id) || builtinIds.has(id)) continue
    const dir = path.join(root, id)
    const manifestPath = path.join(dir, 'manifest.json')
    const soulPath = path.join(dir, 'soul.md')
    // 只有半套文件说明是写坏的目录：跳过而不是抛错，避免一个坏专家拖垮整个列表
    if (!fs.existsSync(manifestPath) || !fs.existsSync(soulPath)) continue
    let manifest = {}
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    out.push({
      id,
      name: String(manifest.name || id),
      description: String(manifest.description || ''),
      iconUrl: String(manifest.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(manifest.imageDescription || '').slice(0, 500),
      soul: fs.readFileSync(soulPath, 'utf8'),
      skillIds: Array.isArray(manifest.skillIds) ? manifest.skillIds.map(String) : [],
      toolIds: Array.isArray(manifest.toolIds) ? manifest.toolIds.map(String) : [],
      source: 'custom',
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
}

/** 内置 + 自定义；同 id 时自定义覆盖内置（不推荐，内置 id 应唯一） */
export function listAllExperts() {
  // 先搬迁再读：老用户第一次打开时设置库里的专家就出现在宿主配置目录里
  migrateLegacyCustomExperts((line) => console.log(line))
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
  const byId = new Map(base.map((e) => [e.id, e]))
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
  // 合并结果同样落盘：调用方不该关心「是新增还是覆盖」
  for (const row of byId.values()) writeExpertFiles(row)
  if (replace) removeExpertsNotIn(new Set(byId.keys()))
  return listAllExperts()
}

/** 删掉不在保留集合里的自定义专家目录（只动顶层 id 目录） */
function removeExpertsNotIn(keep) {
  const root = customExpertsDir()
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_DIRS.has(entry.name) || keep.has(entry.name)) continue
    if (!ID_RE.test(entry.name)) continue
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true })
  }
}

export function saveCustomExperts(experts) {
  if (!Array.isArray(experts)) throw new Error('experts 须为数组')
  const builtinIds = new Set(listBuiltinExperts().map((e) => e.id))
  const normalized = []
  for (const row of experts) {
    if (!row || typeof row !== 'object') continue
    const id = safeExpertId(row.id)
    if (builtinIds.has(id)) throw new Error(`不能覆盖内置专家「${id}」`)
    const next = {
      id,
      name: String(row.name || id).slice(0, 120),
      description: String(row.description || '').slice(0, 500),
      iconUrl: String(row.iconUrl || '').trim().slice(0, 2000),
      imageDescription: String(row.imageDescription || '').slice(0, 500),
      soul: String(row.soul || ''),
      skillIds: Array.isArray(row.skillIds) ? row.skillIds.map(String) : [],
      toolIds: Array.isArray(row.toolIds) ? row.toolIds.map(String) : [],
    }
    writeExpertFiles(next)
    normalized.push(next)
  }
  removeExpertsNotIn(new Set(normalized.map((e) => e.id)))
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