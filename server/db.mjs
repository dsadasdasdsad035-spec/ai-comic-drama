/**
 * 项目数据层（SQLite 版）：node:sqlite 单文件库，替代逐个 project.json。
 *
 * 为什么用内置 node:sqlite：零依赖（不用装 better-sqlite3），Node 22.13+ 自带，
 * 同步 API 足够本项目单用户场景；实验性警告无害。
 *
 * 关键设计：
 * 1. **首次启动自动迁移**：扫描各项目目录下的 project.json 灌库；原 json 文件保留不删，
 *    作为迁移前的冷备份（之后不再回读，真相源切到 DB）。
 * 2. **对外 API 与 data.mjs 完全同形**：listProjects / readProject / writeProject /
 *    createProject / mergeShots，路由层零改动。
 * 3. **shots.extra JSON 列兜底未知字段**：画布的 marks / candidates 等不建列，
 *    原样收进 extra，读时展开 —— 结构演进不丢数据。
 * 4. writeProject 合并语义不变：只更新传入的顶层字段，没传的一律保留。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/
const SCHEMA_VERSION = 1

/** 项目名只允许字母数字下划线短横，挡掉 ../ 之类的路径穿越 */
export function safeProjectName(name) {
  const v = String(name ?? '').trim()
  if (!NAME_RE.test(v)) throw new Error(`项目名不合法：${v}`)
  return v
}

/** 项目根目录（与 data.mjs 相同的解析顺序），DB 文件就放这个目录下 */
export function resolveRoot(appRoot) {
  const env = process.env.SB_PROJECTS_DIR
  if (env) return path.resolve(env)
  const sibling = path.resolve(appRoot, '..', 'manga-pipeline', 'projects')
  if (fs.existsSync(sibling)) return sibling
  const local = path.resolve(appRoot, 'projects')
  fs.mkdirSync(local, { recursive: true })
  return local
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  title      TEXT DEFAULT '',
  style      TEXT DEFAULT '',
  aspect     TEXT DEFAULT '16:9',
  source     TEXT DEFAULT '',
  logline    TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS characters (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name     TEXT NOT NULL,
  role     TEXT DEFAULT '',
  age      TEXT DEFAULT '',
  look_cn  TEXT DEFAULT '',
  look_en  TEXT DEFAULT '',
  palette  TEXT DEFAULT '',
  keywords TEXT DEFAULT '[]',
  sort     INTEGER DEFAULT 0,
  image    TEXT DEFAULT '',
  candidates TEXT DEFAULT '[]',
  active_idx INTEGER,
  expressions TEXT DEFAULT '',
  expression_sheet TEXT DEFAULT '',
  voice TEXT DEFAULT '',
  voice_provider TEXT DEFAULT '',
  voice_model_key TEXT DEFAULT '',
  voice_sample TEXT DEFAULT '',
  UNIQUE(project_id, name)
);
CREATE TABLE IF NOT EXISTS assets (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  kind     TEXT DEFAULT 'image',
  title    TEXT DEFAULT '',
  url      TEXT DEFAULT '',
  note     TEXT DEFAULT '',
  tags     TEXT DEFAULT '[]',
  design_id TEXT DEFAULT '',
  sort     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS designs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  design_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  refs       TEXT DEFAULT '[]',
  summary_cn TEXT DEFAULT '',
  prompt_en  TEXT DEFAULT '',
  keywords   TEXT DEFAULT '[]',
  image      TEXT DEFAULT '',
  candidates TEXT DEFAULT '[]',
  active_idx INTEGER,
  sort       INTEGER DEFAULT 0,
  UNIQUE(project_id, design_id)
);
CREATE TABLE IF NOT EXISTS scene_layouts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  layout_id  TEXT NOT NULL,
  episode    INTEGER,
  scene_no   INTEGER,
  layout     TEXT NOT NULL,
  sort       INTEGER DEFAULT 0,
  updated_at TEXT,
  UNIQUE(project_id, layout_id)
);
CREATE TABLE IF NOT EXISTS episodes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  no       INTEGER NOT NULL,
  title    TEXT DEFAULT '',
  hook     TEXT DEFAULT '',
  sort     INTEGER DEFAULT 0,
  UNIQUE(project_id, no)
);
CREATE TABLE IF NOT EXISTS scenes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  ep_no    INTEGER NOT NULL,
  no       INTEGER,
  slug     TEXT DEFAULT '',
  place    TEXT DEFAULT '',
  time     TEXT DEFAULT '',
  beats    TEXT DEFAULT '',
  characters TEXT DEFAULT '[]',
  intensity INTEGER,
  tone     TEXT DEFAULT '',
  sort     INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  shot_id   TEXT NOT NULL,
  episode   INTEGER,
  no        TEXT DEFAULT '',
  seconds   REAL,
  size      TEXT DEFAULT '',
  move      TEXT DEFAULT '',
  desc      TEXT DEFAULT '',
  dialogue  TEXT DEFAULT '[]',
  cast      TEXT DEFAULT '[]',
  keyframe_prompt TEXT DEFAULT '',
  keyframe  TEXT DEFAULT '',
  video_prompt TEXT DEFAULT '',
  clip      TEXT DEFAULT '',
  hand_edited TEXT DEFAULT '[]',
  extra     TEXT DEFAULT '{}',
  sort      INTEGER DEFAULT 0,
  updated_at TEXT,
  UNIQUE(project_id, shot_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS skill_overrides (
  skill_id     TEXT PRIMARY KEY,
  body         TEXT NOT NULL,
  base_version INTEGER,
  updated_at   TEXT
);
CREATE TABLE IF NOT EXISTS chat_threads (
  project       TEXT NOT NULL,
  surface       TEXT NOT NULL,
  episode       INTEGER NOT NULL DEFAULT 0,
  shot_id       TEXT NOT NULL DEFAULT '',
  messages      TEXT NOT NULL DEFAULT '[]',
  active_skills TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (project, surface, episode, shot_id)
);
-- 创意会话：不属于任何项目，独立存储与清理
CREATE TABLE IF NOT EXISTS creative_sessions (
  id         TEXT PRIMARY KEY,
  title      TEXT DEFAULT '',
  mode       TEXT DEFAULT 'plan',
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS creative_threads (
  session_id    TEXT PRIMARY KEY,
  messages      TEXT NOT NULL DEFAULT '[]',
  active_skills TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creative_sources (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  kind        TEXT DEFAULT 'video',
  platform    TEXT DEFAULT '',
  platform_id TEXT DEFAULT '',
  author      TEXT DEFAULT '',
  title       TEXT DEFAULT '',
  url         TEXT DEFAULT '',
  cover       TEXT DEFAULT '',
  file        TEXT DEFAULT '',
  bytes       INTEGER DEFAULT 0,
  duration    REAL,
  width       INTEGER,
  height      INTEGER,
  fps         REAL,
  bitrate     INTEGER,
  vcodec      TEXT DEFAULT '',
  acodec      TEXT DEFAULT '',
  has_audio   INTEGER DEFAULT 0,
  meta        TEXT DEFAULT '{}',
  created_at  TEXT
);
CREATE TABLE IF NOT EXISTS creative_shots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  start      REAL NOT NULL,
  end        REAL NOT NULL,
  frames     TEXT DEFAULT '[]',
  status     TEXT DEFAULT 'pending',
  analysis   TEXT DEFAULT '',
  updated_at TEXT,
  UNIQUE(source_id, idx)
);
CREATE TABLE IF NOT EXISTS creative_artifacts (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  source_id   TEXT DEFAULT '',
  kind        TEXT DEFAULT 'reverse',
  title       TEXT DEFAULT '',
  payload     TEXT DEFAULT '{}',
  model_label TEXT DEFAULT '',
  created_at  TEXT
);
-- 成片版本：导出成功即落库，发布台以它为唯一发布对象
CREATE TABLE IF NOT EXISTS deliverables (
  id         TEXT PRIMARY KEY,
  project    TEXT NOT NULL,
  episode    INTEGER NOT NULL DEFAULT 0,
  version    INTEGER NOT NULL,
  title      TEXT DEFAULT '',
  url        TEXT NOT NULL,
  srt_url    TEXT DEFAULT '',
  width      INTEGER,
  height     INTEGER,
  duration   REAL,
  bytes      INTEGER,
  source     TEXT DEFAULT 'export',
  config     TEXT DEFAULT '{}',
  auto_draft_note TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(project, episode, version)
);
-- 平台账号：只存 profile 目录与状态，不存 cookie/token
CREATE TABLE IF NOT EXISTS publish_accounts (
  id              TEXT PRIMARY KEY,
  platform        TEXT NOT NULL,
  label           TEXT DEFAULT '',
  profile_dir     TEXT NOT NULL,
  status          TEXT DEFAULT 'unknown',
  last_checked_at TEXT,
  auto_draft      INTEGER DEFAULT 0,
  created_at      TEXT,
  updated_at      TEXT
);
-- 一次平台目标执行；同一幂等键可有多轮 run_no
CREATE TABLE IF NOT EXISTS publish_jobs (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  run_no          INTEGER DEFAULT 1,
  deliverable_id  TEXT NOT NULL,
  project         TEXT NOT NULL,
  episode         INTEGER DEFAULT 0,
  platform        TEXT NOT NULL,
  account_id      TEXT DEFAULT '',
  mode            TEXT NOT NULL,
  state           TEXT NOT NULL,
  stage           TEXT DEFAULT '',
  error_code      TEXT DEFAULT '',
  error_message   TEXT DEFAULT '',
  work_url        TEXT DEFAULT '',
  deliverable_url TEXT DEFAULT '',
  payload         TEXT DEFAULT '{}',
  created_at      TEXT,
  started_at      TEXT,
  ended_at        TEXT
);
CREATE TABLE IF NOT EXISTS publish_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT NOT NULL,
  state      TEXT DEFAULT '',
  stage      TEXT DEFAULT '',
  message    TEXT DEFAULT '',
  created_at TEXT
);
-- 暂存提交意图：助手只能生成这张卡，用户确认后才建任务。
-- config 存的是确认时的唯一依据，不接受确认请求里再传一份配置。
CREATE TABLE IF NOT EXISTS publish_intents (
  id             TEXT PRIMARY KEY,
  deliverable_id TEXT NOT NULL,
  project        TEXT NOT NULL,
  episode        INTEGER DEFAULT 0,
  source         TEXT DEFAULT 'assistant',
  config_hash    TEXT NOT NULL,
  config         TEXT DEFAULT '{}',
  targets        TEXT DEFAULT '[]',
  preflight      TEXT DEFAULT '{}',
  state          TEXT DEFAULT 'staged',
  job_ids        TEXT DEFAULT '[]',
  reason         TEXT DEFAULT '',
  created_at     TEXT,
  expires_at     TEXT,
  confirmed_at   TEXT
);
-- 在线素材来源留档：不放 assets 表，因为画布同步会整表替换 assets
CREATE TABLE IF NOT EXISTS stock_imports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  provider    TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  asset_url   TEXT NOT NULL,
  media_type  TEXT DEFAULT '',
  title       TEXT DEFAULT '',
  author      TEXT DEFAULT '',
  author_url  TEXT DEFAULT '',
  source_url  TEXT DEFAULT '',
  license     TEXT DEFAULT '',
  license_url TEXT DEFAULT '',
  attribution TEXT DEFAULT '',
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  bytes       INTEGER,
  created_at  TEXT,
  UNIQUE(project_id, provider, item_id)
);
CREATE INDEX IF NOT EXISTS idx_stock_imports_url ON stock_imports(project_id, asset_url);
CREATE INDEX IF NOT EXISTS idx_deliverables_project ON deliverables(project, episode);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_key ON publish_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_project ON publish_jobs(project, episode);
CREATE INDEX IF NOT EXISTS idx_publish_events_job ON publish_events(job_id);
CREATE INDEX IF NOT EXISTS idx_publish_intents_state ON publish_intents(state, expires_at);
`

/** 固定列之外的 shot 字段全部收进 extra，读写时展开合并 */
const SHOT_COLS = [
  'shot_id', 'episode', 'no', 'seconds', 'size', 'move', 'desc',
  'dialogue', 'cast', 'keyframe_prompt', 'keyframe', 'video_prompt',
  'clip', 'hand_edited', 'extra',
]

let db = null
let dbFile = ''

function open(root) {
  if (db) return db
  fs.mkdirSync(root, { recursive: true })
  dbFile = path.join(root, 'storyboard.sqlite')
  const firstTime = !fs.existsSync(dbFile)
  db = new DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  ensureColumns()
  if (firstTime) migrateFromJson(root)
  return db
}

/**
 * 给成片/发布模块用的独立连接：不参与 open() 的单例切换，
 * 这样验证脚本用临时项目根时不会误用主库。
 */
export function openDatabase(root) {
  fs.mkdirSync(root, { recursive: true })
  const file = path.join(root, 'storyboard.sqlite')
  const d = new DatabaseSync(file)
  d.exec('PRAGMA journal_mode = WAL;')
  d.exec('PRAGMA busy_timeout = 5000;')
  d.exec(SCHEMA)
  return d
}

/** 老库补列：SCHEMA 只在新建时生效，已有库缺列就走 ALTER */
function ensureColumns() {
  const ensure = (table, need) => {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name))
    for (const [name, def] of need) {
      if (!cols.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`)
    }
  }
  ensure('characters', [
    ['image', "TEXT DEFAULT ''"],
    ['candidates', "TEXT DEFAULT '[]'"],
    ['active_idx', 'INTEGER'],
    ['expressions', "TEXT DEFAULT ''"],
    ['expression_sheet', "TEXT DEFAULT ''"],
    ['voice', "TEXT DEFAULT ''"],
    ['voice_provider', "TEXT DEFAULT ''"],
    ['voice_model_key', "TEXT DEFAULT ''"],
    ['voice_sample', "TEXT DEFAULT ''"],
  ])
  ensure('assets', [['design_id', "TEXT DEFAULT ''"]])
}

export function dbPath(root) {
  open(root)
  return dbFile
}

// ---------------------------------------------------------------- 迁移

function migrateFromJson(root) {
  const done = getSetting('schema')
  if (done) return
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
    .map((d) => d.name)
  let migrated = 0
  for (const name of dirs) {
    const file = path.join(root, name, 'project.json')
    if (!fs.existsSync(file)) continue
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      importProject(db, name, d)
      migrated++
    } catch (e) {
      console.warn(`[db] 迁移失败 ${name}: ${e.message}`)
    }
  }
  setSetting('schema', { v: SCHEMA_VERSION, at: new Date().toISOString(), migrated })
  console.log(`[db] 已迁移 ${migrated}/${dirs.length} 个项目 → ${dbFile}`)
}

function importProject(d, name, data) {
  const now = new Date().toISOString()
  const r = d
    .prepare(
      `INSERT INTO projects (name,title,style,aspect,source,logline,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      name,
      String(data.name || name),
      String(data.style || ''),
      String(data.aspect || '16:9'),
      String(data.source || ''),
      String(data.logline || ''),
      String(data.created_at || now),
      String(data.updated_at || now),
    )
  const pid = Number(r.lastInsertRowid)
  for (const [i, c] of (data.characters || []).entries()) {
    d.prepare(
      `INSERT INTO characters
       (project_id,name,role,age,look_cn,look_en,palette,keywords,sort,image,candidates,active_idx,
        expressions,expression_sheet,voice,voice_provider,voice_model_key,voice_sample)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      pid, String(c.name || ''), String(c.role || ''), String(c.age || ''),
      String(c.look_cn || ''), String(c.look_en || ''), String(c.palette || ''),
      JSON.stringify(c.keywords ?? []), i,
      String(c.image || ''), JSON.stringify(c.candidates ?? []),
      typeof c.activeIdx === 'number' ? c.activeIdx : null,
      jsonColumn(c.expressions), jsonColumn(c.expression_sheet),
      String(c.voice || ''), String(c.voice_provider || ''), String(c.voice_model_key || ''),
      jsonColumn(c.voice_sample),
    )
  }
  for (const [i, ep] of (data.episodes || []).entries()) {
    const no = Number(ep.no) || i + 1
    d.prepare(`INSERT INTO episodes (project_id,no,title,hook,sort) VALUES (?,?,?,?,?)`).run(
      pid, no, String(ep.title || ''), String(ep.hook || ''), i,
    )
    for (const [si, sc] of (ep.scenes || []).entries()) {
      d.prepare(
        `INSERT INTO scenes (project_id,ep_no,no,slug,place,time,beats,characters,intensity,tone,sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        pid, no, sc.no == null ? si + 1 : Number(sc.no),
        String(sc.slug || ''), String(sc.place || ''), String(sc.time || ''),
        String(sc.beats || ''), JSON.stringify(sc.characters ?? []),
        sc.intensity == null ? null : Number(sc.intensity),
        String(sc.tone || ''), si,
      )
    }
  }
  for (const [i, s] of (data.shots || []).entries()) {
    insertShot(d, pid, s, i, String(data.updated_at || now))
  }
}

function insertShot(d, pid, s, sort, updatedAt) {
  if (!s || !s.id) return
  const extra = {}
  for (const [k, v] of Object.entries(s)) {
    if (k === 'id' || SHOT_COLS.includes(k === 'id' ? 'shot_id' : k)) continue
    extra[k] = v
  }
  // 'id' 映射成 shot_id；注意 SHOT_COLS 里没有 'id'
  d.prepare(
    `INSERT INTO shots (project_id,shot_id,episode,no,seconds,size,move,desc,dialogue,cast,
                        keyframe_prompt,keyframe,video_prompt,clip,hand_edited,extra,sort,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    pid, String(s.id), s.episode == null ? null : Number(s.episode), String(s.no || ''),
    Number(s.seconds) || 0, String(s.size || ''), String(s.move || ''), String(s.desc || ''),
    JSON.stringify(s.dialogue ?? []), JSON.stringify(s.cast ?? []),
    String(s.keyframe_prompt || ''), String(s.keyframe || ''), String(s.video_prompt || ''),
    String(s.clip || ''), JSON.stringify(s.handEdited ?? s.hand_edited ?? []),
    JSON.stringify(extra), sort, updatedAt,
  )
}

// ---------------------------------------------------------------- settings

function getSettingRaw(d, key) {
  const row = d.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row?.value
}

export function getSetting(key) {
  if (!db) return undefined
  const v = getSettingRaw(db, key)
  return v === undefined ? undefined : JSON.parse(v)
}

export function setSetting(key, value) {
  if (!db) throw new Error('DB 未打开')
  db.prepare(
    `INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString())
}

// ---------------------------------------------------------------- 技能覆盖

export function listSkillOverrides() {
  if (!db) return {}
  const rows = db.prepare('SELECT skill_id, body, base_version, updated_at FROM skill_overrides').all()
  const out = {}
  for (const row of rows) {
    out[row.skill_id] = {
      body: String(row.body || ''),
      baseVersion: Number(row.base_version) || 1,
      updatedAt: String(row.updated_at || ''),
    }
  }
  return out
}

export function getSkillOverride(id) {
  if (!db) return undefined
  const row = db.prepare('SELECT body, base_version, updated_at FROM skill_overrides WHERE skill_id = ?').get(String(id))
  if (!row) return undefined
  return {
    body: String(row.body || ''),
    baseVersion: Number(row.base_version) || 1,
    updatedAt: String(row.updated_at || ''),
  }
}

export function setSkillOverride(id, body, baseVersion = 1) {
  if (!db) throw new Error('DB 未打开')
  db.prepare(
    `INSERT INTO skill_overrides (skill_id, body, base_version, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(skill_id) DO UPDATE SET body=excluded.body, base_version=excluded.base_version, updated_at=excluded.updated_at`,
  ).run(String(id), String(body), Number(baseVersion) || 1, new Date().toISOString())
}

export function deleteSkillOverride(id) {
  if (!db) throw new Error('DB 未打开')
  db.prepare('DELETE FROM skill_overrides WHERE skill_id = ?').run(String(id))
}

// ---------------------------------------------------------------- 在线素材来源

/** 项目名 → projects.id；项目不存在时抛错，避免把来源记录挂到不存在的项目上 */
function stockProjectId(d, name) {
  const n = safeProjectName(name)
  const row = d.prepare('SELECT id FROM projects WHERE name = ?').get(n)
  if (!row) throw new Error(`项目不存在：${n}`)
  return row.id
}

function rowToStockImport(r) {
  if (!r) return undefined
  return {
    provider: r.provider,
    itemId: r.item_id,
    url: r.asset_url,
    mediaType: r.media_type || '',
    title: r.title || '',
    author: r.author || '',
    authorUrl: r.author_url || '',
    sourceUrl: r.source_url || '',
    license: r.license || '',
    licenseUrl: r.license_url || '',
    attribution: r.attribution || '',
    ...(r.width == null ? {} : { width: Number(r.width) }),
    ...(r.height == null ? {} : { height: Number(r.height) }),
    ...(r.duration == null ? {} : { duration: Number(r.duration) }),
    ...(r.bytes == null ? {} : { bytes: Number(r.bytes) }),
    createdAt: r.created_at || '',
  }
}

/** 导入成功后写来源记录；同一项目 + 来源 + 条目只保留一条 */
export function upsertStockImport(root, project, entry = {}) {
  open(root)
  const pid = stockProjectId(db, project)
  const provider = String(entry.provider || '').trim()
  const itemId = String(entry.itemId || '').trim()
  if (!provider || !itemId) throw new Error('来源记录缺少 provider 或 itemId')
  const created = String(entry.createdAt || new Date().toISOString())
  db.prepare(
    `INSERT INTO stock_imports
       (project_id,provider,item_id,asset_url,media_type,title,author,author_url,source_url,
        license,license_url,attribution,width,height,duration,bytes,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(project_id,provider,item_id) DO UPDATE SET
       asset_url=excluded.asset_url, media_type=excluded.media_type, title=excluded.title,
       author=excluded.author, author_url=excluded.author_url, source_url=excluded.source_url,
       license=excluded.license, license_url=excluded.license_url, attribution=excluded.attribution,
       width=excluded.width, height=excluded.height, duration=excluded.duration, bytes=excluded.bytes,
       created_at=excluded.created_at`,
  ).run(
    pid,
    provider,
    itemId,
    String(entry.url || ''),
    String(entry.mediaType || ''),
    String(entry.title || ''),
    String(entry.author || ''),
    String(entry.authorUrl || ''),
    String(entry.sourceUrl || ''),
    String(entry.license || ''),
    String(entry.licenseUrl || ''),
    String(entry.attribution || ''),
    entry.width == null ? null : Math.round(Number(entry.width)),
    entry.height == null ? null : Math.round(Number(entry.height)),
    entry.duration == null ? null : Number(entry.duration),
    entry.bytes == null ? null : Math.round(Number(entry.bytes)),
    created,
  )
  return getStockImportByItem(root, project, provider, itemId)
}

export function getStockImportByItem(root, project, provider, itemId) {
  open(root)
  const pid = stockProjectId(db, project)
  const row = db
    .prepare('SELECT * FROM stock_imports WHERE project_id=? AND provider=? AND item_id=?')
    .get(pid, String(provider), String(itemId))
  return rowToStockImport(row)
}

/** 按站内地址反查来源，供素材卡详情显示；普通素材返回 undefined */
export function findStockImportByUrl(root, project, url) {
  open(root)
  const pid = stockProjectId(db, project)
  const row = db
    .prepare('SELECT * FROM stock_imports WHERE project_id=? AND asset_url=?')
    .get(pid, String(url || ''))
  return rowToStockImport(row)
}

export function listStockImports(root, project, limit = 200) {
  open(root)
  const pid = stockProjectId(db, project)
  return db
    .prepare('SELECT * FROM stock_imports WHERE project_id=? ORDER BY id DESC LIMIT ?')
    .all(pid, Math.max(1, Math.min(1000, Number(limit) || 200)))
    .map(rowToStockImport)
}

// ---------------------------------------------------------------- 聊天线程

function threadKey(k = {}) {
  return {
    project: String(k.project || ''),
    surface: String(k.surface || ''),
    episode: Number.isFinite(Number(k.episode)) ? Math.max(0, Math.floor(Number(k.episode))) : 0,
    shotId: String(k.shotId || ''),
  }
}

export function getChatThread(key) {
  if (!db) return undefined
  const k = threadKey(key)
  const row = db
    .prepare(
      `SELECT messages, active_skills, updated_at FROM chat_threads
       WHERE project=? AND surface=? AND episode=? AND shot_id=?`,
    )
    .get(k.project, k.surface, k.episode, k.shotId)
  if (!row) return undefined
  let messages = []
  let activeSkills = []
  try {
    messages = JSON.parse(row.messages || '[]')
  } catch {
    messages = []
  }
  try {
    activeSkills = JSON.parse(row.active_skills || '[]')
  } catch {
    activeSkills = []
  }
  return { ...k, messages, activeSkills, updatedAt: row.updated_at }
}

export function saveChatThread(key, messages, activeSkills = []) {
  if (!db) throw new Error('DB 未打开')
  const k = threadKey(key)
  if (!Array.isArray(messages)) throw new Error('messages 必须是数组')
  const payload = JSON.stringify(messages)
  if (Buffer.byteLength(payload, 'utf8') > 1024 * 1024) throw new Error('线程超过 1MB，请清理会话后重试')
  db.prepare(
    `INSERT INTO chat_threads (project, surface, episode, shot_id, messages, active_skills, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(project, surface, episode, shot_id)
     DO UPDATE SET messages=excluded.messages, active_skills=excluded.active_skills, updated_at=excluded.updated_at`,
  ).run(
    k.project,
    k.surface,
    k.episode,
    k.shotId,
    payload,
    JSON.stringify(Array.isArray(activeSkills) ? activeSkills : []),
    new Date().toISOString(),
  )
  return getChatThread(k)
}

export function deleteChatThread(key) {
  if (!db) throw new Error('DB 未打开')
  const k = threadKey(key)
  db.prepare('DELETE FROM chat_threads WHERE project=? AND surface=? AND episode=? AND shot_id=?').run(
    k.project,
    k.surface,
    k.episode,
    k.shotId,
  )
}

// ---------------------------------------------------------------- 项目 CRUD

export function listProjects(root) {
  open(root)
  const rows = db
    .prepare(
      `SELECT p.name, p.title, p.style, p.aspect,
              (SELECT COUNT(*) FROM episodes e WHERE e.project_id=p.id) AS episodes,
              (SELECT COUNT(*) FROM shots s WHERE s.project_id=p.id) AS shots,
              (SELECT SUM(s.seconds) FROM shots s WHERE s.project_id=p.id) AS seconds
       FROM projects p ORDER BY p.name`,
    )
    .all()
  return rows.map((r) => ({
    name: r.name,
    title: r.title || r.name,
    style: r.style || '',
    aspect: r.aspect || '16:9',
    episodes: Number(r.episodes) || 0,
    shots: Number(r.shots) || 0,
    seconds: Math.round((Number(r.seconds) || 0) * 10) / 10,
  }))
}

function rowToShot(r) {
  const s = {
    id: r.shot_id,
    episode: r.episode == null ? undefined : Number(r.episode),
    no: r.no,
    seconds: r.seconds == null ? undefined : Number(r.seconds),
    size: r.size,
    move: r.move,
    desc: r.desc,
    dialogue: JSON.parse(r.dialogue || '[]'),
    cast: JSON.parse(r.cast || '[]'),
    keyframe_prompt: r.keyframe_prompt,
    keyframe: r.keyframe,
    video_prompt: r.video_prompt,
    clip: r.clip,
    handEdited: JSON.parse(r.hand_edited || '[]'),
  }
  try {
    Object.assign(s, JSON.parse(r.extra || '{}'))
  } catch {
    /* extra 损坏不致命 */
  }
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k]
  return s
}

function readProjectRow(d, n) {
  return d.prepare('SELECT * FROM projects WHERE name = ?').get(n)
}

export function readProject(root, name) {
  open(root)
  const n = safeProjectName(name)
  const p = readProjectRow(db, n)
  if (!p) throw new Error(`项目不存在：${n}`)
  return assemble(p)
}

/** 服务端只做结构性 sanitize：畸形布局拒绝入库，几何细节由客户端几何层负责 */
function sanitizeStoredSceneLayout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const id = String(raw.id || '').trim()
  const episode = Number(raw.episode)
  const sceneNo = Number(raw.sceneNo)
  const w = Number(raw.w)
  const h = Number(raw.h)
  if (!id || !Number.isFinite(episode) || !Number.isFinite(sceneNo) || episode < 1 || sceneNo < 1) return null
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2 || w > 80 || h > 80) return null
  const cleanList = (v, max) =>
    (Array.isArray(v) ? v : [])
      .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
      .slice(0, max)
  const source = raw.source === 'ai' || raw.source === 'fallback' || raw.source === 'legacy' ? raw.source : 'manual'
  return {
    ...raw,
    id,
    episode: Math.round(episode),
    sceneNo: Math.round(sceneNo),
    w,
    h,
    walls: cleanList(raw.walls, 24),
    props: cleanList(raw.props, 32),
    zones: cleanList(raw.zones, 12),
    ...(raw.axis && typeof raw.axis === 'object' ? { axis: raw.axis } : { axis: undefined }),
    source,
  }
}

/** 旧库/坏行容错：解析不出来就当没有，不让一条脏 JSON 打挂整个项目读取 */
function parseJsonColumn(raw, fallback = undefined) {
  if (raw == null || raw === '') return fallback
  try {
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function jsonColumn(value) {
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

function assemble(p) {
  const pid = p.id
  const characters = db
    .prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort, id')
    .all(pid)
    .map((c) => {
      const expressions = parseJsonColumn(c.expressions)
      const expressionSheet = parseJsonColumn(c.expression_sheet)
      const voiceSample = parseJsonColumn(c.voice_sample)
      return {
        name: c.name,
        role: c.role,
        age: c.age,
        look_cn: c.look_cn,
        look_en: c.look_en,
        palette: c.palette,
        keywords: JSON.parse(c.keywords || '[]'),
        ...(c.voice ? { voice: c.voice } : {}),
        ...(c.voice_provider ? { voice_provider: c.voice_provider } : {}),
        ...(c.voice_model_key ? { voice_model_key: c.voice_model_key } : {}),
        ...(c.image ? { image: c.image } : {}),
        ...(c.candidates && c.candidates !== '[]' ? { candidates: JSON.parse(c.candidates || '[]') } : {}),
        ...(c.active_idx == null ? {} : { activeIdx: Number(c.active_idx) }),
        ...(expressions && typeof expressions === 'object' ? { expressions } : {}),
        ...(expressionSheet && typeof expressionSheet === 'object' ? { expression_sheet: expressionSheet } : {}),
        ...(voiceSample && typeof voiceSample === 'object' ? { voice_sample: voiceSample } : {}),
      }
    })
  const assets = db
    .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY sort, id')
    .all(pid)
    .map((a) => ({
      kind: a.kind || 'image',
      title: a.title || '',
      url: a.url || '',
      note: a.note || '',
      tags: JSON.parse(a.tags || '[]'),
      ...(a.design_id ? { designId: a.design_id } : {}),
    }))
  const designs = db
    .prepare('SELECT * FROM designs WHERE project_id = ? ORDER BY sort, id')
    .all(pid)
    .map((d) => ({
      id: d.design_id,
      kind: d.kind || 'scene',
      name: d.name || '',
      refs: JSON.parse(d.refs || '[]'),
      summaryCn: d.summary_cn || '',
      promptEn: d.prompt_en || '',
      keywords: JSON.parse(d.keywords || '[]'),
      ...(d.image ? { image: d.image } : {}),
      ...(d.candidates && d.candidates !== '[]' ? { candidates: JSON.parse(d.candidates || '[]') } : {}),
      ...(d.active_idx == null ? {} : { activeIdx: Number(d.active_idx) }),
    }))
  const episodes = db
    .prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY sort, no')
    .all(pid)
    .map((e) => ({
      no: Number(e.no),
      title: e.title,
      hook: e.hook,
      scenes: db
        .prepare('SELECT * FROM scenes WHERE project_id = ? AND ep_no = ? ORDER BY sort, id')
        .all(pid, e.no)
        .map((sc) => ({
          no: sc.no == null ? undefined : Number(sc.no),
          slug: sc.slug,
          place: sc.place,
          time: sc.time,
          beats: sc.beats,
          characters: JSON.parse(sc.characters || '[]'),
          ...(sc.intensity == null ? {} : { intensity: Number(sc.intensity) }),
          ...(sc.tone ? { tone: sc.tone } : {}),
        })),
    }))
  const sceneLayouts = db
    .prepare('SELECT * FROM scene_layouts WHERE project_id = ? ORDER BY sort, id')
    .all(pid)
    .map((row) => {
      try {
        return sanitizeStoredSceneLayout(JSON.parse(row.layout || '{}'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
  const shots = db
    .prepare('SELECT * FROM shots WHERE project_id = ? ORDER BY sort, id')
    .all(pid)
    .map(rowToShot)
  return {
    schema: 1,
    name: p.title || p.name,
    style: p.style,
    aspect: p.aspect,
    source: p.source,
    logline: p.logline,
    created_at: p.created_at,
    updated_at: p.updated_at,
    characters,
    assets,
    designs,
    sceneLayouts,
    episodes,
    shots,
  }
}

/**
 * 落库。合并语义与旧版一致：
 *   只更新传入的顶层字段，没传的一律保留；
 *   shots / characters / episodes 传入即全量替换（调用方在 POST 路由里先做 mergeShots）。
 */
export function writeProject(root, name, data = {}) {
  open(root)
  const n = safeProjectName(name)
  const now = new Date().toISOString()
  const cur = readProjectRow(db, n)
  if (!cur) {
    // 与旧版行为对齐：写不存在的项目 = 隐式创建骨架
    db.prepare(
      `INSERT INTO projects (name,title,style,aspect,source,logline,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(n, String(data.name || n), '', '16:9', '', '', now, now)
    return writeProject(root, n, data)
  }
  const pid = cur.id
  const cols = {
    title: 'name',
    style: 'style',
    aspect: 'aspect',
    source: 'source',
    logline: 'logline',
  }
  const sets = []
  const vals = []
  for (const [k, col] of Object.entries(cols)) {
    if (data[k] === undefined) continue
    if (typeof data[k] !== 'string') throw new Error(`${k} 必须是字符串`)
    sets.push(`${col} = ?`)
    vals.push(data[k])
  }
  if (sets.length) {
    db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now, pid)
  }

  if (data.shots !== undefined) {
    if (!Array.isArray(data.shots)) throw new Error('shots 必须是数组 —— 拒绝写入会丢掉镜头列表的内容')
    db.prepare('DELETE FROM shots WHERE project_id = ?').run(pid)
    for (const [i, s] of data.shots.entries()) insertShot(db, pid, s, i, now)
  }

  if (data.assets !== undefined) {
    if (!Array.isArray(data.assets)) throw new Error('assets 必须是数组')
    db.prepare('DELETE FROM assets WHERE project_id = ?').run(pid)
    for (const [i, a] of data.assets.entries()) {
      db.prepare(
        'INSERT INTO assets (project_id,kind,title,url,note,tags,design_id,sort) VALUES (?,?,?,?,?,?,?,?)',
      ).run(
        pid,
        String(a?.kind || 'image'),
        String(a?.title || ''),
        String(a?.url || ''),
        String(a?.note || ''),
        JSON.stringify(a?.tags ?? []),
        String(a?.designId || ''),
        i,
      )
    }
  }

  if (data.designs !== undefined) {
    if (!Array.isArray(data.designs)) throw new Error('designs 必须是数组')
    db.prepare('DELETE FROM designs WHERE project_id = ?').run(pid)
    for (const [i, d] of data.designs.entries()) {
      db.prepare(
        `INSERT INTO designs
         (project_id,design_id,kind,name,refs,summary_cn,prompt_en,keywords,image,candidates,active_idx,sort)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        pid,
        String(d?.id || ''),
        String(d?.kind || 'scene'),
        String(d?.name || ''),
        JSON.stringify(d?.refs ?? []),
        String(d?.summaryCn || ''),
        String(d?.promptEn || ''),
        JSON.stringify(d?.keywords ?? []),
        String(d?.image || ''),
        JSON.stringify(d?.candidates ?? []),
        typeof d?.activeIdx === 'number' ? d.activeIdx : null,
        i,
      )
    }
  }

  if (data.sceneLayouts !== undefined) {
    if (!Array.isArray(data.sceneLayouts)) throw new Error('sceneLayouts 必须是数组')
    const clean = data.sceneLayouts.map((d, i) => {
      const one = sanitizeStoredSceneLayout(d)
      if (!one) throw new Error(`场景布局第 ${i + 1} 项无效（需要 id/episode/sceneNo/w/h）`)
      if (JSON.stringify(one).length > 1_000_000) throw new Error(`场景布局 ${one.id} 过大`)
      return one
    })
    db.prepare('DELETE FROM scene_layouts WHERE project_id = ?').run(pid)
    for (const [i, d] of clean.entries()) {
      db.prepare(
        `INSERT INTO scene_layouts (project_id,layout_id,episode,scene_no,layout,sort,updated_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(pid, d.id, d.episode, d.sceneNo, JSON.stringify(d), i, now)
    }
  }

  if (data.characters !== undefined) {
    if (!Array.isArray(data.characters)) throw new Error('characters 必须是数组')
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(pid)
    for (const [i, c] of data.characters.entries()) {
      db.prepare(
        `INSERT INTO characters
         (project_id,name,role,age,look_cn,look_en,palette,keywords,sort,image,candidates,active_idx,
          expressions,expression_sheet,voice,voice_provider,voice_model_key,voice_sample)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        pid, String(c?.name || ''), String(c?.role || ''), String(c?.age || ''),
        String(c?.look_cn || ''), String(c?.look_en || ''), String(c?.palette || ''),
        JSON.stringify(c?.keywords ?? []), i,
        String(c?.image || ''), JSON.stringify(c?.candidates ?? []),
        typeof c?.activeIdx === 'number' ? c.activeIdx : null,
        jsonColumn(c?.expressions), jsonColumn(c?.expression_sheet),
        String(c?.voice || ''), String(c?.voice_provider || ''), String(c?.voice_model_key || ''),
        jsonColumn(c?.voice_sample),
      )
    }
  }

  if (data.episodes !== undefined) {
    if (!Array.isArray(data.episodes)) throw new Error('episodes 必须是数组')
    db.prepare('DELETE FROM episodes WHERE project_id = ?').run(pid)
    db.prepare('DELETE FROM scenes WHERE project_id = ?').run(pid)
    for (const [i, ep] of data.episodes.entries()) {
      const no = Number(ep?.no) || i + 1
      db.prepare(`INSERT INTO episodes (project_id,no,title,hook,sort) VALUES (?,?,?,?,?)`).run(
        pid, no, String(ep?.title || ''), String(ep?.hook || ''), i,
      )
      for (const [si, sc] of (ep?.scenes || []).entries()) {
        db.prepare(
          `INSERT INTO scenes (project_id,ep_no,no,slug,place,time,beats,characters,intensity,tone,sort)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          pid, no, sc?.no == null ? si + 1 : Number(sc.no),
          String(sc?.slug || ''), String(sc?.place || ''), String(sc?.time || ''),
          String(sc?.beats || ''), JSON.stringify(sc?.characters ?? []),
          sc?.intensity == null ? null : Number(sc.intensity),
          String(sc?.tone || ''), si,
        )
      }
    }
  }

  const p = readProjectRow(db, n)
  db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, pid)
  return assemble({ ...p, updated_at: now })
}

/** 新建项目。已存在则报错（不覆盖） */
export function createProject(root, name, init = {}) {
  open(root)
  const n = safeProjectName(name)
  if (readProjectRow(db, n)) throw new Error(`项目已存在：${n}`)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO projects (name,title,style,aspect,source,logline,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(n, String(init.title || n), String(init.style || ''), String(init.aspect || '16:9'), '', '', now, now)
  return { name: n, created: true }
}

/**
 * 字段级合并：只更新 incoming 里出现的字段，未出现的保持原样。
 * 不在 incoming 里的现有镜头**保留并标 orphan**，不静默删。
 * handEdited 的手改保护不在这里做（保存是人的意图；保护在生成时）。
 */
export function mergeShots(existing = [], incoming = []) {
  const byId = new Map()
  for (const s of existing) if (s && s.id) byId.set(s.id, s)
  const out = []
  const touched = new Set()

  for (const inc of incoming) {
    if (!inc || !inc.id) continue
    const old = byId.get(inc.id)
    touched.add(inc.id)
    if (!old) {
      out.push({ ...inc })
      continue
    }
    const merged = { ...old }
    for (const [k, v] of Object.entries(inc)) {
      if (k === 'handEdited') continue
      if (v === undefined) continue
      merged[k] = v
    }
    // handEdited 只增不减：一旦手改过就永久留痕
    const hand = new Set([...(old.handEdited || []), ...(Array.isArray(inc.handEdited) ? inc.handEdited : [])])
    if (hand.size) merged.handEdited = [...hand]
    delete merged.orphan
    out.push(merged)
  }

  for (const s of existing) {
    if (!s || !s.id || touched.has(s.id)) continue
    out.push({ ...s, orphan: true })
  }
  return out
}
