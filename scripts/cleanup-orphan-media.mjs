#!/usr/bin/env node
/**
 * 清理共享产物池里没有任何引用的孤儿文件。
 *
 * 为什么需要单独一个脚本：删项目按规范只删项目目录（`projects/<名>/`），
 * 共享产物池（public/{generated,videos,voices,exports,publish-packages}）不删——
 * 那里是扁平命名，文件可能与已发布内容、成片记录、发布包相关联，删项目时无从判断。
 * 代价是删项目后残留文件会一直堆积，所以用这个脚本按「是否还被引用」来回收。
 *
 * 引用来源（都不命中才视为孤儿）：
 *   - 数据库：characters / assets / designs 的图片与候选、shots 的 extra 字段、
 *     deliverables 的 url 与 srt_url
 *   - 明文：全部项目目录下的 *.json（project.json 及其它散落文件名）
 *   - 发布包：publish-packages 目录整体保留（是交付物，不参与回收）
 *
 * 用法：
 *   node scripts/cleanup-orphan-media.mjs              # 预演，只打印
 *   node scripts/cleanup-orphan-media.mjs --apply      # 真删
 *   node scripts/cleanup-orphan-media.mjs --min-age 7  # 只清理 7 天前未改动的
 *
 * 安全：默认 dry-run；--apply 才删；非空目录不动；只处理三个白名单池。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = path.resolve(import.meta.dirname, '..')
const PROJECTS = path.resolve(process.env.SB_PROJECTS_DIR || path.join(ROOT, 'data', 'projects'))
/** 参与者：这些池子的文件按引用关系回收 */
const POOLS = ['generated', 'videos', 'voices', 'exports']

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const minAgeDays = (() => {
  const i = args.indexOf('--min-age')
  const v = i >= 0 ? Number(args[i + 1]) : 0
  return Number.isFinite(v) && v > 0 ? v : 0
})()

const log = (...a) => console.log(...a)
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`

// ---------------------------------------------------------------- 收集引用

/** 把任意对象里的字符串全部捞出来，比逐字段白名单更不容易漏 */
function collectStrings(value, out) {
  if (typeof value === 'string') out.add(value)
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collectStrings(v, out)
}

const referenced = new Set()
const stats = { jsonFiles: 0, dbRows: 0 }

function addRef(text) {
  if (!text) return
  const s = String(text)
  // 站内 URL 可能带查询串；文件名比对用 basename
  const clean = s.split('?')[0]
  referenced.add(path.basename(clean))
  referenced.add(clean.replace(/^\//, ''))
}

function scanProjectJson(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'assets' || e.name === '.deleted' || e.name === '.publish-profiles') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      scanProjectJson(full)
      continue
    }
    if (!/\.json$/i.test(e.name)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
      const strings = new Set()
      collectStrings(parsed, strings)
      for (const s of strings) addRef(s)
      stats.jsonFiles++
    } catch {
      /* 坏 JSON 跳过，不阻塞清理 */
    }
  }
}

function scanDatabase() {
  const file = path.join(PROJECTS, 'storyboard.sqlite')
  if (!fs.existsSync(file)) return
  const db = new DatabaseSync(file, { readOnly: true })
  const tables = [
    ['characters', ['image', 'candidates', 'expression_sheet']],
    ['assets', ['url']],
    ['designs', ['image', 'candidates', 'refs']],
    ['shots', ['keyframe', 'clip', 'extra']],
    ['deliverables', ['url', 'srt_url']],
  ]
  for (const [table, cols] of tables) {
    let rows
    try {
      rows = db.prepare(`SELECT ${cols.join(',')} FROM ${table}`).all()
    } catch {
      continue
    }
    for (const row of rows) {
      const strings = new Set()
      collectStrings(row, strings)
      for (const s of strings) addRef(s)
      stats.dbRows++
    }
  }
  db.close()
}

// ---------------------------------------------------------------- 扫描池

function listPool(dir) {
  const out = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      // exports/imports、publish-packages 这类子目录整体保留
      continue
    }
    if (!e.isFile()) continue
    try {
      const st = fs.statSync(full)
      out.push({ full, name: e.name, size: st.size, mtimeMs: st.mtimeMs })
    } catch {
      /* ignore */
    }
  }
  return out
}

// ---------------------------------------------------------------- 主流程

function main() {
  log(`项目根：${PROJECTS}`)
  log(`模式：${APPLY ? '删除（--apply）' : '预演（dry-run）'}${minAgeDays ? `，忽略 ${minAgeDays} 天内改动过的文件` : ''}`)

  if (fs.existsSync(PROJECTS)) {
    for (const e of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
      if (e.isDirectory()) scanProjectJson(path.join(PROJECTS, e.name))
    }
  }
  scanDatabase()
  log(`引用来源：${stats.jsonFiles} 个 JSON、${stats.dbRows} 行数据库记录、${referenced.size} 个名字`)

  const appRoot = fs.existsSync(path.join(ROOT, 'data', 'media'))
    ? path.join(ROOT, 'data', 'media')
    : path.join(ROOT, 'public')
  // 未指定 --min-age 时不做年龄过滤；写成 mtimeMs < 0 会把所有文件都当成"太新"
  const cutoff = minAgeDays ? Date.now() - minAgeDays * 86400_000 : null
  const tooRecent = (f) => cutoff !== null && f.mtimeMs >= cutoff

  let totalFiles = 0
  let totalBytes = 0
  for (const pool of POOLS) {
    const dir = path.join(appRoot, pool)
    const files = listPool(dir)
    const orphans = files.filter((f) => !referenced.has(f.name) && !tooRecent(f))
    if (!files.length) {
      log(`\n${pool}/：空`)
      continue
    }
    log(`\n${pool}/：${files.length} 个文件，孤儿 ${orphans.length} 个`)
    for (const f of orphans) {
      totalFiles++
      totalBytes += f.size
      log(`  ${APPLY ? '删除' : '可删'} ${f.name}  ${mb(f.size)}`)
      if (APPLY) {
        try {
          fs.rmSync(f.full, { force: true })
        } catch (e) {
          log(`    ! 删除失败：${e.message}`)
        }
      }
    }
  }

  log(`\n合计：${totalFiles} 个孤儿文件，${mb(totalBytes)}`)
  if (!APPLY && totalFiles) log('确认无误后加 --apply 真删。')
}

main()
