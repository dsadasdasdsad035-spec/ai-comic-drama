#!/usr/bin/env node
/**
 * 只读对账：磁盘 project.json（含 .bak） vs storyboard.sqlite 中的素材字段。
 * 不调用 readProject，不会触发 json 回补写库。
 *
 * 用法：
 *   node scripts/check-project-materials.mjs <项目名>
 *   node scripts/check-project-materials.mjs --all
 *   SB_PROJECTS_DIR=/path node scripts/check-project-materials.mjs demo
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

function resolveProjectsRoot() {
  const env = process.env.SB_PROJECTS_DIR
  if (env) return path.resolve(env)
  const sibling = path.resolve(ROOT, '..', 'manga-pipeline', 'projects')
  if (fs.existsSync(sibling)) return sibling
  return path.resolve(ROOT, 'projects')
}

function safeName(name) {
  const v = String(name ?? '').trim()
  if (!NAME_RE.test(v)) throw new Error(`项目名不合法：${v}`)
  return v
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return { __error: (e).message }
  }
}

function legacyScenePropCount(assets) {
  if (!Array.isArray(assets)) return 0
  return assets.filter((a) => {
    const k = String(a?.kind || '')
    return (k === 'scene' || k === 'prop') && (String(a?.title || '').trim() || String(a?.url || '').trim())
  }).length
}

function fmtJsonRow(label, data) {
  if (!data) return `${label}: （无文件）`
  if (data.__error) return `${label}: 解析失败 — ${data.__error}`
  const designs = Array.isArray(data.designs) ? data.designs.length : 0
  const assets = Array.isArray(data.assets) ? data.assets.length : 0
  const legacy = legacyScenePropCount(data.assets)
  const lx = Array.isArray(data.lexiconWhitebox) ? data.lexiconWhitebox.length : 0
  const sl = Array.isArray(data.sceneLayouts) ? data.sceneLayouts.length : 0
  return (
    `${label}: designs ${designs} · assets ${assets}（其中 scene/prop ${legacy}）` +
    ` · lexiconWhitebox ${lx} · sceneLayouts ${sl}`
  )
}

function dbCounts(db, pid) {
  const one = (table) => {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE project_id = ?`).get(pid)
    return Number(row?.c) || 0
  }
  return {
    designs: one('designs'),
    assets: one('assets'),
    lexicon_whitebox: one('lexicon_whitebox'),
    scene_layouts: one('scene_layouts'),
  }
}

function auditOne(db, projectsRoot, name) {
  const n = safeName(name)
  const dir = path.join(projectsRoot, n)
  const json = readJsonFile(path.join(dir, 'project.json'))
  const bak = readJsonFile(path.join(dir, 'project.json.bak'))

  const row = db.prepare('SELECT id, name FROM projects WHERE name = ?').get(n)
  const lines = [`\n=== 项目：${n} ===`]
  lines.push(fmtJsonRow('project.json', json))
  lines.push(fmtJsonRow('project.json.bak', bak))

  if (!row) {
    lines.push('SQLite: 无此项目行（未入库或名称不一致）')
    return lines.join('\n')
  }

  const c = dbCounts(db, row.id)
  lines.push(
    `SQLite: designs ${c.designs} · assets ${c.assets} · lexicon_whitebox ${c.lexicon_whitebox} · scene_layouts ${c.scene_layouts}`,
  )

  const jsonDesigns = Array.isArray(json?.designs) ? json.designs.length : 0
  const jsonLegacy = json ? legacyScenePropCount(json.assets) : 0
  const recoverable =
    (c.designs === 0 && (jsonDesigns > 0 || jsonLegacy > 0)) ||
    (c.assets === 0 && Array.isArray(json?.assets) && json.assets.length > 0)

  if (c.designs === 0 && jsonDesigns === 0 && jsonLegacy > 0) {
    lines.push('提示: JSON 无 designs，但有 assets 型场景/道具 — 打开项目会按 legacy 规则补设定卡。')
  }
  if (c.designs < jsonDesigns) {
    lines.push(`差异: DB designs 少于 project.json（差 ${jsonDesigns - c.designs}）— 重启服务后打开该项目可触发回补。`)
  }
  if (bak && !bak.__error) {
    const bakD = Array.isArray(bak.designs) ? bak.designs.length : 0
    if (c.designs === 0 && bakD > 0 && jsonDesigns === 0) {
      lines.push(`恢复: project.json 已无 designs，但 .bak 仍有 ${bakD} 张 — 可手动从 .bak 拷回 project.json 再打开项目。`)
    }
  }
  if (recoverable) {
    lines.push('建议: 重启 dev 服务 → 在应用里打开该项目（readProject 只补空表，不覆盖已有 DB）。')
  } else if (c.designs > 0) {
    lines.push('状态: DB 已有设定卡；若页面仍空，检查是否选错项目或前端未刷新。')
  }

  return lines.join('\n')
}

function listDbProjects(db) {
  return db
    .prepare('SELECT name FROM projects ORDER BY name')
    .all()
    .map((r) => String(r.name))
}

function main() {
  const projectsRoot = resolveProjectsRoot()
  const dbFile = path.join(projectsRoot, 'storyboard.sqlite')
  const args = process.argv.slice(2).filter(Boolean)

  console.log(`项目根: ${projectsRoot}`)
  console.log(`数据库: ${fs.existsSync(dbFile) ? dbFile : '（不存在）'}`)

  if (!fs.existsSync(dbFile)) {
    console.error('没有 storyboard.sqlite，请先在本机启动过一次应用。')
    process.exit(1)
  }

  const db = new DatabaseSync(dbFile, { readonly: true })
  let names = []
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log('\n用法: node scripts/check-project-materials.mjs <项目名> | --all')
    names = listDbProjects(db).slice(0, 20)
    if (names.length) console.log('\n库内项目（前 20）：', names.join(', '))
    process.exit(0)
  }
  if (args[0] === '--all') {
    names = listDbProjects(db)
  } else {
    names = args.map(safeName)
  }

  for (const n of names) {
    console.log(auditOne(db, projectsRoot, n))
  }
}

main()