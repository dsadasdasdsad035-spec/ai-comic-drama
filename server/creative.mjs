/**
 * 创意会话存储：会话 / 线程 / 源视频 / 镜头 / 产物。
 *
 * 为什么单独一套表而不是复用 chat_threads：
 * - chat_threads 的主键要求非空 project，而项目名走 safeProjectName（拒绝空串）；
 *   用占位项目会让项目列表、导出与清理逻辑都变得含糊。
 * - 创意需要会话列表、标题、模式与最近更新时间，这些字段 chat_threads 没有。
 *
 * 源视频与证据帧落 creatives/<sessionId>/，线程里只存引用；
 * 这样 1MB 的线程上限不会因为媒体而提前撞墙。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { dbPath, resolveRoot } from './db.mjs'

/** 单条创意线程的体积上限；与 chat_threads 保持同一量级 */
export const MAX_CREATIVE_THREAD_BYTES = 1024 * 1024
/** 创意目录：与 projects/ 同级，不进仓库 */
const CREATIVES_DIR = 'creatives'

const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
export const CREATIVE_MODES = ['plan', 'reverse', 'remake']

let conn = null
let connFile = ''

function open(root) {
  const file = dbPath(root)
  if (conn && connFile === file) return conn
  conn = new DatabaseSync(file)
  conn.exec('PRAGMA journal_mode = WAL;')
  connFile = file
  return conn
}

export function safeSessionId(id) {
  const v = String(id ?? '').trim()
  if (!SESSION_ID_RE.test(v)) throw new Error(`创意会话 id 不合法：${v || '(空)'}`)
  return v
}

export function newSessionId() {
  return `cs-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

export function normalizeMode(mode) {
  const v = String(mode || '').trim()
  return CREATIVE_MODES.includes(v) ? v : 'plan'
}

// ---------------------------------------------------------------- 目录

export function creativesRoot(appRoot) {
  return path.join(resolveRoot(appRoot), CREATIVES_DIR)
}

export function sessionDir(appRoot, sessionId) {
  return path.join(creativesRoot(appRoot), safeSessionId(sessionId))
}

export function ensureSessionDir(appRoot, sessionId) {
  const dir = sessionDir(appRoot, sessionId)
  for (const sub of ['', 'sources', 'frames', 'artifacts']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  return dir
}

/** 删除会话目录；目录不存在也算成功（幂等） */
export function removeSessionDir(appRoot, sessionId) {
  const dir = sessionDir(appRoot, sessionId)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

/** 站内 URL（/creative/<id>/...）→ 本地绝对路径；拒绝越界与远程地址 */
export function resolveCreativeFile(appRoot, ref) {
  const raw = String(ref || '').split('?')[0]
  const m = raw.match(/^\/creative\/([^/]+)\/(.+)$/)
  if (!m) throw new Error(`不是创意目录文件：${raw.slice(0, 80)}`)
  const id = safeSessionId(decodeURIComponent(m[1]))
  const rel = m[2]
  if (rel.includes('..') || path.isAbsolute(rel)) throw new Error('创意文件路径越界')
  const dir = sessionDir(appRoot, id)
  const full = path.join(dir, rel)
  const inside = path.relative(dir, full)
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new Error('创意文件路径越界')
  return full
}

// ---------------------------------------------------------------- 会话

function nowIso() {
  return new Date().toISOString()
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {}
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw ?? '')
  } catch {
    return fallback
  }
}

export function createSession(appRoot, init = {}) {
  const id = safeSessionId(init.id || newSessionId())
  ensureSessionDir(appRoot, id)
  const d = open(appRoot)
  const at = nowIso()
  d.prepare(
    `INSERT INTO creative_sessions (id, title, mode, created_at, updated_at) VALUES (?,?,?,?,?)`,
  ).run(id, String(init.title || '').slice(0, 200), normalizeMode(init.mode), at, at)
  d.prepare(`INSERT OR IGNORE INTO creative_threads (session_id, messages, active_skills, updated_at) VALUES (?,?,?,?)`)
    .run(id, '[]', '[]', at)
  return getSession(appRoot, id)
}

export function getSession(appRoot, id) {
  const d = open(appRoot)
  const row = d.prepare('SELECT * FROM creative_sessions WHERE id=?').get(safeSessionId(id))
  if (!row) return null
  return {
    id: row.id,
    title: row.title || '',
    mode: normalizeMode(row.mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listSessions(appRoot, limit = 100) {
  const d = open(appRoot)
  const rows = d
    .prepare('SELECT * FROM creative_sessions ORDER BY updated_at DESC LIMIT ?')
    .all(Math.max(1, Math.min(500, Number(limit) || 100)))
  return rows.map((row) => ({
    id: row.id,
    title: row.title || '',
    mode: normalizeMode(row.mode),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export function touchSession(appRoot, id, patch = {}) {
  const d = open(appRoot)
  const safe = safeSessionId(id)
  const sets = []
  const vals = []
  if (patch.title !== undefined) {
    sets.push('title=?')
    vals.push(String(patch.title || '').slice(0, 200))
  }
  if (patch.mode !== undefined) {
    sets.push('mode=?')
    vals.push(normalizeMode(patch.mode))
  }
  sets.push('updated_at=?')
  vals.push(nowIso())
  d.prepare(`UPDATE creative_sessions SET ${sets.join(', ')} WHERE id=?`).run(...vals, safe)
  return getSession(appRoot, safe)
}

/** 删除会话：先删库内子记录，再删磁盘目录；两者都不影响其他会话 */
export function deleteSession(appRoot, id) {
  const safe = safeSessionId(id)
  const d = open(appRoot)
  d.prepare('DELETE FROM creative_threads WHERE session_id=?').run(safe)
  d.prepare('DELETE FROM creative_artifacts WHERE session_id=?').run(safe)
  const sources = d.prepare('SELECT id FROM creative_sources WHERE session_id=?').all(safe)
  for (const s of sources) d.prepare('DELETE FROM creative_shots WHERE source_id=?').run(s.id)
  d.prepare('DELETE FROM creative_sources WHERE session_id=?').run(safe)
  const res = d.prepare('DELETE FROM creative_sessions WHERE id=?').run(safe)
  removeSessionDir(appRoot, safe)
  return Number(res.changes) > 0
}

// ---------------------------------------------------------------- 线程

export function getThread(appRoot, id) {
  const d = open(appRoot)
  const row = d
    .prepare('SELECT messages, active_skills, updated_at FROM creative_threads WHERE session_id=?')
    .get(safeSessionId(id))
  if (!row) return { sessionId: safeSessionId(id), messages: [], activeSkills: [], updatedAt: null }
  return {
    sessionId: safeSessionId(id),
    messages: parseJson(row.messages, []),
    activeSkills: parseJson(row.active_skills, []),
    updatedAt: row.updated_at,
  }
}

export function saveThread(appRoot, id, messages, activeSkills = []) {
  const safe = safeSessionId(id)
  if (!Array.isArray(messages)) throw new Error('messages 必须是数组')
  if (activeSkills !== undefined && !Array.isArray(activeSkills)) throw new Error('activeSkills 必须是数组')
  const payload = JSON.stringify(messages)
  const bytes = Buffer.byteLength(payload, 'utf8')
  if (bytes > MAX_CREATIVE_THREAD_BYTES) {
    const err = new Error(
      `线程超过 ${Math.round(MAX_CREATIVE_THREAD_BYTES / 1024)}KB（当前 ${Math.round(bytes / 1024)}KB），请新建会话或清理旧轮次`,
    )
    err.kind = 'thread-too-large'
    err.bytes = bytes
    throw err
  }
  const d = open(appRoot)
  const at = nowIso()
  d.prepare(
    `INSERT INTO creative_threads (session_id, messages, active_skills, updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       messages=excluded.messages, active_skills=excluded.active_skills, updated_at=excluded.updated_at`,
  ).run(safe, payload, JSON.stringify(activeSkills || []), at)
  d.prepare('UPDATE creative_sessions SET updated_at=? WHERE id=?').run(at, safe)
  return getThread(appRoot, safe)
}

// ---------------------------------------------------------------- 源视频

const SOURCE_FIELDS = [
  'kind', 'platform', 'platform_id', 'author', 'title', 'url', 'cover', 'file',
  'bytes', 'duration', 'width', 'height', 'fps', 'bitrate', 'vcodec', 'acodec',
]

function rowToSource(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind || 'video',
    platform: row.platform || '',
    platformId: row.platform_id || '',
    author: row.author || '',
    title: row.title || '',
    url: row.url || '',
    cover: row.cover || '',
    file: row.file || '',
    bytes: Number(row.bytes) || 0,
    duration: row.duration == null ? null : Number(row.duration),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    fps: row.fps == null ? null : Number(row.fps),
    bitrate: row.bitrate == null ? null : Number(row.bitrate),
    vcodec: row.vcodec || '',
    acodec: row.acodec || '',
    hasAudio: Boolean(row.has_audio),
    meta: asRecord(parseJson(row.meta, {})),
    createdAt: row.created_at,
  }
}

export function insertSource(appRoot, sessionId, source = {}) {
  const safe = safeSessionId(sessionId)
  if (!getSession(appRoot, safe)) throw new Error(`创意会话不存在：${safe}`)
  const id = String(source.id || `src-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`)
  const d = open(appRoot)
  const cols = ['id', 'session_id', ...SOURCE_FIELDS, 'has_audio', 'meta', 'created_at']
  const values = [
    id,
    safe,
    ...SOURCE_FIELDS.map((f) => source[f] ?? null),
    source.hasAudio ? 1 : 0,
    JSON.stringify(asRecord(source.meta)),
    nowIso(),
  ]
  d.prepare(
    `INSERT INTO creative_sources (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).run(...values)
  d.prepare('UPDATE creative_sessions SET updated_at=? WHERE id=?').run(nowIso(), safe)
  return getSource(appRoot, id)
}

export function getSource(appRoot, id) {
  const d = open(appRoot)
  return rowToSource(d.prepare('SELECT * FROM creative_sources WHERE id=?').get(String(id)))
}

export function listSources(appRoot, sessionId) {
  const d = open(appRoot)
  return d
    .prepare('SELECT * FROM creative_sources WHERE session_id=? ORDER BY created_at DESC')
    .all(safeSessionId(sessionId))
    .map(rowToSource)
}

export function patchSource(appRoot, id, patch = {}) {
  const current = getSource(appRoot, id)
  if (!current) return null
  const d = open(appRoot)
  const map = {
    kind: 'kind', platform: 'platform', platformId: 'platform_id', author: 'author',
    title: 'title', url: 'url', cover: 'cover', file: 'file', bytes: 'bytes',
    duration: 'duration', width: 'width', height: 'height', fps: 'fps',
    bitrate: 'bitrate', vcodec: 'vcodec', acodec: 'acodec',
  }
  const sets = []
  const vals = []
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      sets.push(`${col}=?`)
      vals.push(patch[key])
    }
  }
  if (patch.hasAudio !== undefined) {
    sets.push('has_audio=?')
    vals.push(patch.hasAudio ? 1 : 0)
  }
  if (patch.meta !== undefined) {
    sets.push('meta=?')
    vals.push(JSON.stringify(asRecord(patch.meta)))
  }
  if (!sets.length) return current
  d.prepare(`UPDATE creative_sources SET ${sets.join(', ')} WHERE id=?`).run(...vals, String(id))
  return getSource(appRoot, id)
}

export function deleteSource(appRoot, id) {
  const d = open(appRoot)
  const src = getSource(appRoot, id)
  if (!src) return false
  d.prepare('DELETE FROM creative_shots WHERE source_id=?').run(String(id))
  d.prepare('DELETE FROM creative_sources WHERE id=?').run(String(id))
  // 源文件与帧都在会话目录下按 source 前缀命名，删源时一并清掉
  try {
    const dir = sessionDir(appRoot, src.sessionId)
    if (fs.existsSync(dir)) {
      for (const sub of ['sources', 'frames']) {
        const full = path.join(dir, sub)
        if (!fs.existsSync(full)) continue
        for (const f of fs.readdirSync(full)) {
          if (f.startsWith(`${id}-`)) fs.rmSync(path.join(full, f), { force: true })
        }
      }
    }
  } catch {
    /* 文件清理失败不回滚数据库删除：记录已不可用，残留文件不影响正确性 */
  }
  return true
}

// ---------------------------------------------------------------- 镜头

function rowToShot(row) {
  if (!row) return null
  return {
    id: row.id,
    sourceId: row.source_id,
    index: Number(row.idx),
    start: Number(row.start),
    end: Number(row.end),
    frames: parseJson(row.frames, []),
    status: row.status || 'pending',
    analysis: parseJson(row.analysis, null),
    updatedAt: row.updated_at,
  }
}

/** 全量替换某源的镜头段；旧帧引用会随镜头记录一起替换 */
export function replaceShots(appRoot, sourceId, shots = []) {
  const d = open(appRoot)
  const at = nowIso()
  d.prepare('DELETE FROM creative_shots WHERE source_id=?').run(String(sourceId))
  const insert = d.prepare(
    `INSERT INTO creative_shots (source_id, idx, start, end, frames, status, analysis, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  )
  shots.forEach((s, i) => {
    insert.run(
      String(sourceId),
      i,
      Number(s.start) || 0,
      Number(s.end) || 0,
      JSON.stringify(Array.isArray(s.frames) ? s.frames : []),
      String(s.status || 'pending'),
      JSON.stringify(s.analysis ?? null),
      at,
    )
  })
  return listShots(appRoot, sourceId)
}

export function listShots(appRoot, sourceId) {
  const d = open(appRoot)
  return d
    .prepare('SELECT * FROM creative_shots WHERE source_id=? ORDER BY idx')
    .all(String(sourceId))
    .map(rowToShot)
}

/** 只更新一镜：帧、状态或分析结果 */
export function patchShot(appRoot, sourceId, index, patch = {}) {
  const d = open(appRoot)
  const sets = []
  const vals = []
  if (patch.frames !== undefined) {
    sets.push('frames=?')
    vals.push(JSON.stringify(Array.isArray(patch.frames) ? patch.frames : []))
  }
  if (patch.status !== undefined) {
    sets.push('status=?')
    vals.push(String(patch.status))
  }
  if (patch.analysis !== undefined) {
    sets.push('analysis=?')
    vals.push(JSON.stringify(patch.analysis ?? null))
  }
  if (!sets.length) return null
  sets.push('updated_at=?')
  vals.push(nowIso())
  d.prepare(`UPDATE creative_shots SET ${sets.join(', ')} WHERE source_id=? AND idx=?`).run(
    ...vals,
    String(sourceId),
    Number(index),
  )
  return listShots(appRoot, sourceId).find((s) => s.index === Number(index)) ?? null
}

/** 重新切分后把旧结果标为过期，但不删证据帧与已产出的分析 */
export function markShotsStale(appRoot, sourceId) {
  const d = open(appRoot)
  d.prepare("UPDATE creative_shots SET status='stale', updated_at=? WHERE source_id=? AND status='analyzed'")
    .run(nowIso(), String(sourceId))
  return listShots(appRoot, sourceId)
}

// ---------------------------------------------------------------- 产物

function rowToArtifact(row) {
  if (!row) return null
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceId: row.source_id || '',
    kind: row.kind || 'reverse',
    title: row.title || '',
    payload: parseJson(row.payload, {}),
    modelLabel: row.model_label || '',
    createdAt: row.created_at,
  }
}

export function saveArtifact(appRoot, sessionId, artifact = {}) {
  const safe = safeSessionId(sessionId)
  if (!getSession(appRoot, safe)) throw new Error(`创意会话不存在：${safe}`)
  const d = open(appRoot)
  const id = String(artifact.id || `art-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`)
  const at = nowIso()
  d.prepare(
    `INSERT INTO creative_artifacts (id, session_id, source_id, kind, title, payload, model_label, created_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, payload=excluded.payload, model_label=excluded.model_label`,
  ).run(
    id,
    safe,
    String(artifact.sourceId || ''),
    String(artifact.kind || 'reverse'),
    String(artifact.title || '').slice(0, 200),
    JSON.stringify(asRecord(artifact.payload)),
    String(artifact.modelLabel || '').slice(0, 200),
    at,
  )
  d.prepare('UPDATE creative_sessions SET updated_at=? WHERE id=?').run(at, safe)
  return getArtifact(appRoot, id)
}

export function getArtifact(appRoot, id) {
  const d = open(appRoot)
  return rowToArtifact(d.prepare('SELECT * FROM creative_artifacts WHERE id=?').get(String(id)))
}

export function listArtifacts(appRoot, sessionId) {
  const d = open(appRoot)
  return d
    .prepare('SELECT * FROM creative_artifacts WHERE session_id=? ORDER BY created_at DESC')
    .all(safeSessionId(sessionId))
    .map(rowToArtifact)
}

export function deleteArtifact(appRoot, id) {
  const d = open(appRoot)
  return Number(d.prepare('DELETE FROM creative_artifacts WHERE id=?').run(String(id)).changes) > 0
}

/** 会话概览：给列表与恢复用，不返回消息体；shots 按源分组 */
export function sessionSummary(appRoot, sessionId) {
  const session = getSession(appRoot, sessionId)
  if (!session) return null
  const sources = listSources(appRoot, sessionId)
  const artifacts = listArtifacts(appRoot, sessionId)
  const thread = getThread(appRoot, sessionId)
  const shots = {}
  for (const src of sources) shots[src.id] = listShots(appRoot, src.id)
  return {
    ...session,
    sourceCount: sources.length,
    artifactCount: artifacts.length,
    messageCount: thread.messages.length,
    sources,
    artifacts,
    shots,
  }
}
