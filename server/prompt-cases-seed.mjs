/**
 * 提示词案例种子的加载与灌入。
 *
 * 场景：新装的应用 / 新 clone 的仓库，案例库是空的。没有这一步，用户点开
 * 「提示词案例」看到空列表，还得联网跑 55 分钟同步。种子让案例开箱即用。
 *
 * 三条设计约束：
 *
 * 1. **不能阻塞启动**。13MB 解压 + 14,344 条写入约 2–3 秒，放在启动路径上会让
 *    首屏等待。所以只在检测到「库里没有种子数据」时才灌，灌之前先看哈希标记：
 *    已经灌过同版本就直接返回（一次 SELECT 的成本）。
 * 2. **不能覆盖用户数据**。用户可能删过某些案例、改过收藏与备注。灌入用
 *    `INSERT OR IGNORE`：主键已存在就跳过，绝不 UPDATE 覆盖用户改过的字段。
 * 3. **种子损坏不影响应用**。文件缺失、哈希不符、解压失败都只打日志，应用照常
 *    启动（用户仍可手工跑同步脚本）。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

/** 种子目录（相对仓库根） */
export const SEED_REL_DIR = 'data/prompt-cases/v1'
/** 灌入完成后写入 settings 的标记键 */
export const SEED_MARK_KEY = 'promptCases.seed'

/**
 * 是否已有可用的案例数据。
 *
 * 判据是「种子标记的哈希与当前种子一致」——比 `COUNT(*)>0` 更准：
 * 用户可能只留了一条自己手工建的案例，那时仍应该灌种子。
 */
function alreadySeeded(db, manifest) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(SEED_MARK_KEY)
    if (!row?.value) return false
    const mark = JSON.parse(row.value)
    return (
      mark?.schemaVersion === manifest.schemaVersion &&
      mark?.casesHash === manifest.files?.cases?.sha256 &&
      mark?.facetsHash === manifest.files?.facets?.sha256
    )
  } catch {
    return false
  }
}

function readManifest(seedDir) {
  const file = path.join(seedDir, 'manifest.json')
  if (!fs.existsSync(file)) return null
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!manifest?.files?.cases?.name || !manifest?.files?.facets?.name) return null
  return manifest
}

function readJsonlGz(file, expectedHash) {
  const buf = fs.readFileSync(file)
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  if (expectedHash && hash !== expectedHash) {
    throw new Error(`种子哈希不符（期望 ${expectedHash}，实际 ${hash}），可能已损坏`)
  }
  const text = zlib.gunzipSync(buf).toString('utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

const CASE_COLUMNS = [
  'id',
  'source',
  'source_id',
  'title',
  'prompt',
  'shots',
  'model',
  'category',
  'tags',
  'video_url',
  'poster_url',
  'author',
  'source_url',
  'license',
  'note',
  'favorite',
  'created_at',
  'updated_at',
  'taxonomy_version',
]

const FACET_COLUMNS = [
  'case_id',
  'axis',
  'value',
  'source',
  'unmapped',
  'suppressed',
  'taxonomy_version',
  'updated_at',
]

/**
 * 把内置种子灌进本地库。
 *
 * @param {string} appRoot 仓库根（种子在这里找）
 * @param {string} root 数据根（storyboard.sqlite 所在目录）
 * @param {{ log?: (s: string) => void }} [options]
 * @returns {{ seeded: boolean, cases?: number, facets?: number, reason?: string }}
 */
export function seedPromptCases(appRoot, root, options = {}) {
  const log = options.log || (() => {})
  const seedDir = path.join(appRoot, SEED_REL_DIR)
  let manifest
  try {
    manifest = readManifest(seedDir)
  } catch (e) {
    return { seeded: false, reason: `种子清单不可读：${e?.message || e}` }
  }
  if (!manifest) return { seeded: false, reason: '没有种子文件' }

  const dbPath = path.join(root, 'storyboard.sqlite')
  if (!fs.existsSync(dbPath)) return { seeded: false, reason: '数据库还未创建' }

  const db = new DatabaseSync(dbPath)
  try {
    if (alreadySeeded(db, manifest)) {
      return { seeded: false, reason: '已灌入过同版本种子' }
    }

    const cases = readJsonlGz(
      path.join(seedDir, manifest.files.cases.name),
      manifest.files.cases.sha256,
    )
    const facets = readJsonlGz(
      path.join(seedDir, manifest.files.facets.name),
      manifest.files.facets.sha256,
    )

    const t0 = Date.now()
    // 单事务：14,344 + 118,508 条约 400ms；分批提交会让它慢一个数量级
    db.exec('BEGIN')
    try {
      // OR IGNORE：主键冲突就跳过，绝不覆盖用户改过的收藏/备注/正文
      const insCase = db.prepare(
        `INSERT OR IGNORE INTO prompt_cases (${CASE_COLUMNS.join(',')})
         VALUES (${CASE_COLUMNS.map(() => '?').join(',')})`,
      )
      for (const row of cases) insCase.run(...CASE_COLUMNS.map((c) => row[c] ?? null))

      const insFacet = db.prepare(
        `INSERT OR IGNORE INTO case_facets (${FACET_COLUMNS.join(',')})
         VALUES (${FACET_COLUMNS.map(() => '?').join(',')})`,
      )
      for (const row of facets) insFacet.run(...FACET_COLUMNS.map((c) => row[c] ?? null))

      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      ).run(
        SEED_MARK_KEY,
        JSON.stringify({
          schemaVersion: manifest.schemaVersion,
          casesHash: manifest.files.cases.sha256,
          facetsHash: manifest.files.facets.sha256,
          seededAt: new Date().toISOString(),
        }),
        new Date().toISOString(),
      )
      db.exec('COMMIT')
    } catch (e) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* 回滚失败也要把原始错误抛出去 */
      }
      throw e
    }

    log(`[prompt-cases] 已灌入内置种子：${cases.length} 条案例 / ${facets.length} 条分面（${Date.now() - t0}ms）`)
    return { seeded: true, cases: cases.length, facets: facets.length }
  } catch (e) {
    return { seeded: false, reason: e?.message || String(e) }
  } finally {
    db.close()
  }
}
