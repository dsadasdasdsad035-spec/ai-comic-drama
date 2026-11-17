/**
 * 一次性数据迁移：以磁盘包为权威，清理历史 upload 安装记录。
 *
 * 背景：早期版本把整包只存了 SKILL.md 正文，references/ 之类的文件从未落盘，
 * 于是这些记录的正文引用了不存在的文件（迁移前共 56 处本地链接缺失）。
 * 现在 `skills/<id>/` 里已有完整包，安装记录既过时又会遮蔽磁盘上的新版本。
 *
 * 用法：
 *   node openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs          # 预览（默认不写）
 *   node openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs --apply  # 备份 + 删除
 *   node openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs --restore <备份文件>
 *
 * 回滚：`--restore <备份文件>` 把 JSON 里的行原样写回 skill_installs。
 * 备份路径：`<stateRoot>/skill-installs-backup-<ISO时间戳>.json`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { statePath } from '../../../server/paths.mjs'

const ROOT = process.cwd()
const DB = path.join(ROOT, 'projects', 'storyboard.sqlite')
const APPLY = process.argv.includes('--apply')
const restoreIdx = process.argv.indexOf('--restore')

const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`

function openDb() {
  if (!fs.existsSync(DB)) {
    console.error(`找不到数据库：${DB}`)
    process.exit(1)
  }
  const db = new DatabaseSync(DB)
  db.exec('PRAGMA journal_mode = WAL;')
  return db
}

/** 回滚入口：把备份行原样插回（已存在则跳过，避免覆盖用户新装的东西） */
function restore(file) {
  const rows = JSON.parse(fs.readFileSync(file, 'utf8')).rows
  const db = openDb()
  const exists = db.prepare('SELECT skill_id FROM skill_installs WHERE skill_id = ?')
  const insert = db.prepare(
    `INSERT INTO skill_installs (skill_id, provider, slug, namespace, version, text, meta, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let n = 0
  for (const r of rows) {
    if (exists.get(r.skill_id)) continue
    insert.run(
      r.skill_id,
      r.provider || 'upload',
      r.slug || '',
      r.namespace || '',
      r.version || '',
      r.text || '',
      r.meta || '{}',
      r.installed_at || null,
    )
    n++
  }
  db.close()
  console.log(`已回滚 ${n} 条安装记录（跳过已存在 ${rows.length - n} 条）`)
}

if (restoreIdx >= 0) {
  const file = process.argv[restoreIdx + 1]
  if (!file) {
    console.error('--restore 需要备份文件路径')
    process.exit(1)
  }
  restore(file)
  process.exit(0)
}

const db = openDb()
const rows = db
  .prepare(
    "SELECT skill_id, provider, slug, namespace, version, text, meta, installed_at FROM skill_installs WHERE provider = 'upload' ORDER BY skill_id",
  )
  .all()

if (!rows.length) {
  db.close()
  console.log('没有需要迁移的 upload 安装记录')
  process.exit(0)
}

// 前置校验：每个 id 必须在磁盘上有完整包，否则删记录等于删技能
const missing = rows.filter((r) => !fs.existsSync(path.join(ROOT, 'skills', r.skill_id, 'SKILL.md')))
if (missing.length) {
  db.close()
  console.error(`以下 id 缺少磁盘 SKILL.md，拒绝迁移（先补包再跑）：${missing.map((r) => r.skill_id).join('、')}`)
  process.exit(1)
}

const cmp = ['short-drama', 'short-drama-video-prompts', 'short-drama-assets']
console.log(`待清理 ${rows.length} 条 upload 记录：`)
for (const r of rows) {
  const diskText = fs.readFileSync(path.join(ROOT, 'skills', r.skill_id, 'SKILL.md'), 'utf8')
  const same = diskText === r.text
  const mark = cmp.includes(r.skill_id) ? '  ← 原本不一致' : ''
  console.log(`  ${r.skill_id.padEnd(32)} ${same ? '与磁盘一致' : '与磁盘不一致'}${mark}`)
}

if (!APPLY) {
  db.close()
  console.log('\n预览模式未改动数据库；确认后加 --apply 执行备份 + 删除。')
  process.exit(0)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = statePath(ROOT, `skill-installs-backup-${stamp}.json`)
fs.writeFileSync(
  backup,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      stateRoot: path.relative(ROOT, path.dirname(backup)) || '.',
      note: '早期 upload 安装记录（仅正文、无附件）。回滚：node openspec/changes/archive/2026-11-18-skill-package-files/migrate-upload-installs.mjs --restore <本文件>',
      count: rows.length,
      rows,
    },
    null,
    2,
  ),
)
console.log(`\n已备份到 ${backup}`)

const del = db.prepare('DELETE FROM skill_installs WHERE skill_id = ? AND provider = ?')
let deleted = 0
for (const r of rows) {
  const info = del.run(r.skill_id, 'upload')
  deleted += Number(info.changes || 0)
}
db.close()
console.log(`已删除 ${deleted} 条记录。回滚：--restore ${backup}`)
