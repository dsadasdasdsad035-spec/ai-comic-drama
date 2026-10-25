/**
 * 成片版本存储：导出成功或手工导入后写入，发布台以 id 为唯一发布对象。
 *
 * 为什么单独成表而不是塞进 shots.extra：
 * - 一条成片对应一整集，不属于任何单个镜头；
 * - 发布配置（文案/封面/目标平台）要跟着成片版本走，不能随重新导出被覆盖；
 * - 需要按 project + episode 稳定自增 version，供「v1 / v2」选择。
 *
 * 连接策略：用 openDatabase(root) 的独立连接，不参与 db.mjs 的进程级单例，
 * 这样验证脚本用临时目录时不会误用主库。
 */
import crypto from 'node:crypto'
import { openDatabase, safeProjectName } from './db.mjs'

const COVER_ASPECTS = ['9:16', '16:9']

let conn = null
let connRoot = ''

function open(root) {
  const dir = String(root || '')
  if (!dir) throw new Error('缺少项目根目录')
  if (conn && connRoot === dir) return conn
  conn = openDatabase(dir)
  connRoot = dir
  return conn
}

export function newDeliverableId() {
  return `dl-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`
}

function nowIso() {
  return new Date().toISOString()
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw ?? '')
  } catch {
    return fallback
  }
}

function clampText(value, max) {
  const s = String(value ?? '')
  return s.length > max ? s.slice(0, max) : s
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : []
  return list
    .map((t) => clampText(t, 40).trim())
    .filter(Boolean)
    .slice(0, 30)
}

function normalizeOverride(raw) {
  if (!raw || typeof raw !== 'object') return null
  const title = typeof raw.title === 'string' ? clampText(raw.title, 200) : ''
  const description = typeof raw.description === 'string' ? clampText(raw.description, 5000) : ''
  const tags = Array.isArray(raw.tags) ? normalizeTags(raw.tags) : []
  // 三项全空视为没有覆写，回到继承主文案
  if (!title && !description && tags.length === 0) return null
  return { title, description, tags }
}

/** 只接受已知字段，长度做上限；未知字段直接丢弃，避免把任意 JSON 写进库 */
export function normalizeDeliverableConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const master = src.master && typeof src.master === 'object' ? src.master : {}
  const cover = src.cover && typeof src.cover === 'object' ? src.cover : {}
  const targets = src.targets && typeof src.targets === 'object' ? src.targets : {}

  const cleanTargets = {}
  for (const [platform, value] of Object.entries(targets)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(platform)) continue
    const t = value && typeof value === 'object' ? value : {}
    const mode = t.mode === 'publish' || t.mode === 'package' ? t.mode : 'draft'
    cleanTargets[platform] = {
      selected: t.selected === true,
      accountId: clampText(t.accountId, 80),
      mode,
      override: normalizeOverride(t.override),
    }
  }

  const cleanCover = {}
  for (const aspect of COVER_ASPECTS) {
    const v = cover[aspect]
    if (typeof v === 'string' && v.trim()) cleanCover[aspect] = clampText(v.trim(), 500)
  }

  return {
    master: {
      title: clampText(master.title, 200),
      description: clampText(master.description, 5000),
      tags: normalizeTags(master.tags),
      aiGenerated: master.aiGenerated !== false,
    },
    cover: cleanCover,
    targets: cleanTargets,
  }
}

export function emptyDeliverableConfig() {
  return { master: { title: '', description: '', tags: [], aiGenerated: true }, cover: {}, targets: {} }
}

function rowToDeliverable(row) {
  if (!row) return null
  return {
    id: row.id,
    project: row.project,
    episode: Number(row.episode) || 0,
    version: Number(row.version) || 1,
    title: row.title || '',
    url: row.url || '',
    srtUrl: row.srt_url || '',
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    duration: row.duration == null ? null : Number(row.duration),
    bytes: row.bytes == null ? null : Number(row.bytes),
    source: row.source || 'export',
    config: normalizeDeliverableConfig(parseJson(row.config, {})),
    autoDraftNote: row.auto_draft_note || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  }
}

/**
 * 写入一条成片。version 按 project + episode 自增，不受并发影响：
 * 先取 max 再插入；UNIQUE 冲突时重试一次重新取号。
 */
export function createDeliverable(root, input = {}) {
  const d = open(root)
  const project = safeProjectName(input.project)
  const episode = Math.max(0, Math.floor(Number(input.episode) || 0))
  const url = String(input.url || '').trim()
  if (!url) throw new Error('成片地址为空')
  const id = String(input.id || newDeliverableId())
  const at = nowIso()
  const config = normalizeDeliverableConfig(input.config)

  const pickVersion = () =>
    Number(
      d
        .prepare('SELECT MAX(version) AS v FROM deliverables WHERE project = ? AND episode = ?')
        .get(project, episode)?.v || 0,
    ) + 1

  for (let attempt = 0; attempt < 2; attempt++) {
    const version = pickVersion()
    try {
      d.prepare(
        `INSERT INTO deliverables
         (id,project,episode,version,title,url,srt_url,width,height,duration,bytes,source,config,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        project,
        episode,
        version,
        String(input.title || ''),
        url,
        String(input.srtUrl || ''),
        input.width == null ? null : Math.round(Number(input.width) || 0),
        input.height == null ? null : Math.round(Number(input.height) || 0),
        input.duration == null ? null : Number(input.duration),
        input.bytes == null ? null : Number(input.bytes),
        input.source === 'import' ? 'import' : 'export',
        JSON.stringify(config),
        at,
        at,
      )
      return getDeliverable(root, id)
    } catch (e) {
      if (attempt === 1) throw e
    }
  }
  return null
}

export function getDeliverable(root, id) {
  const d = open(root)
  const row = d.prepare('SELECT * FROM deliverables WHERE id = ?').get(String(id || ''))
  return rowToDeliverable(row)
}

export function listDeliverables(root, opts = {}) {
  const d = open(root)
  const project = String(opts.project || '').trim()
  if (!project) return []
  safeProjectName(project)
  const episode = Math.max(0, Math.floor(Number(opts.episode) || 0))
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50))
  const rows = episode > 0
    ? d
        .prepare(
          'SELECT * FROM deliverables WHERE project = ? AND episode = ? ORDER BY version DESC LIMIT ?',
        )
        .all(project, episode, limit)
    : d
        .prepare('SELECT * FROM deliverables WHERE project = ? ORDER BY episode DESC, version DESC LIMIT ?')
        .all(project, limit)
  return rows.map(rowToDeliverable)
}

export function patchDeliverableConfig(root, id, config) {
  const d = open(root)
  const clean = normalizeDeliverableConfig(config)
  const at = nowIso()
  const res = d
    .prepare('UPDATE deliverables SET config = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(clean), at, String(id || ''))
  if (!Number(res.changes)) return null
  return getDeliverable(root, id)
}

export function patchDeliverableMeta(root, id, patch = {}) {
  const d = open(root)
  const cur = getDeliverable(root, id)
  if (!cur) return null
  d.prepare(
    `UPDATE deliverables SET title = ?, url = ?, srt_url = ?, width = ?, height = ?,
       duration = ?, bytes = ?, updated_at = ? WHERE id = ?`,
  ).run(
    patch.title == null ? cur.title : String(patch.title),
    patch.url == null ? cur.url : String(patch.url),
    patch.srtUrl == null ? cur.srtUrl : String(patch.srtUrl),
    patch.width == null ? cur.width : Math.round(Number(patch.width) || 0),
    patch.height == null ? cur.height : Math.round(Number(patch.height) || 0),
    patch.duration == null ? cur.duration : Number(patch.duration),
    patch.bytes == null ? cur.bytes : Number(patch.bytes),
    nowIso(),
    String(id),
  )
  return getDeliverable(root, id)
}

/** 自动草稿未排队原因：写回成片，界面直接显示，不用再查一次 */
export function setAutoDraftNote(root, id, note) {
  const d = open(root)
  d.prepare('UPDATE deliverables SET auto_draft_note = ?, updated_at = ? WHERE id = ?').run(
    String(note || '').slice(0, 300),
    nowIso(),
    String(id || ''),
  )
  return getDeliverable(root, id)
}

export function deleteDeliverable(root, id) {
  const d = open(root)
  const res = d.prepare('DELETE FROM deliverables WHERE id = ?').run(String(id || ''))
  return Number(res.changes) > 0
}
