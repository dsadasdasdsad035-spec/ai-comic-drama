/**
 * 把本地案例库导出成可入库的种子文件。
 *
 * 为什么要进仓库：案例库是「开箱即用」的产品价值之一。如果只有代码没有数据，
 * 新装的应用点开提示词案例 Tab 看到的是空列表，还得联网跑 55 分钟同步。
 *
 * 格式选择：
 * - **JSONL + gzip**，不是 JSON 数组。同一份数据两种格式压缩后体积一样（11.9MB），
 *   但 JSONL 解析快 10 倍（56ms vs 618ms），因为不必先拼成一个巨大的字符串再整体解析。
 * - **案例与分面分开两个文件**。分面压缩率极高（21.8MB → 1.1MB，因为 axis/value 大量重复），
 *   分开存可以让「只要案例不要分面」的场景少读 1MB。
 * - **manifest.json 记账**：条数、哈希、生成时间、许可口径。加载时先比对哈希，
 *   数据没变就不重复导入。
 *
 * 跑法：
 *   node scripts/export-case-seed.mjs              # 导出到 data/prompt-cases/v1/
 *   node scripts/export-case-seed.mjs --check      # 只校验现有种子与库是否一致
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { applyDefaultProjectsDir } from '../server/default-projects-dir.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SEED_DIR = path.join(ROOT, 'data', 'prompt-cases', 'v1')
export const SEED_SCHEMA_VERSION = 1

/** 导出顺序：先按 id 排序，让 diff 稳定（同一份数据两次导出字节一致） */
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

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)

function readAll(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const cases = db.prepare(`SELECT ${CASE_COLUMNS.join(',')} FROM prompt_cases ORDER BY id`).all()
    const facets = db
      .prepare(
        `SELECT ${FACET_COLUMNS.join(',')} FROM case_facets ORDER BY case_id, axis, value, source`,
      )
      .all()
    const bySource = Object.fromEntries(
      db
        .prepare('SELECT source, COUNT(*) c FROM prompt_cases GROUP BY source ORDER BY source')
        .all()
        .map((r) => [r.source, Number(r.c)]),
    )
    const taxVersion = db.prepare("SELECT value FROM settings WHERE key='schema'").get()?.value || ''
    return { cases, facets, bySource, taxVersion }
  } finally {
    db.close()
  }
}

function exportSeed() {
  const dir = applyDefaultProjectsDir()
  if (!dir) {
    console.error('[seed] 找不到应用数据目录')
    process.exit(1)
  }
  const dbPath = path.join(dir, 'storyboard.sqlite')
  if (!fs.existsSync(dbPath)) {
    console.error(`[seed] 数据库不存在：${dbPath}`)
    process.exit(1)
  }
  console.log(`[seed] 源库：${dbPath}`)
  const { cases, facets, bySource } = readAll(dbPath)
  if (!cases.length) {
    console.error('[seed] 案例库为空，没什么可导出')
    process.exit(1)
  }

  fs.mkdirSync(SEED_DIR, { recursive: true })

  const casesText = cases.map((r) => JSON.stringify(r)).join('\n')
  const facetsText = facets.map((r) => JSON.stringify(r)).join('\n')
  const casesGz = zlib.gzipSync(Buffer.from(casesText, 'utf8'), { level: 9 })
  const facetsGz = zlib.gzipSync(Buffer.from(facetsText, 'utf8'), { level: 9 })

  fs.writeFileSync(path.join(SEED_DIR, 'cases.jsonl.gz'), casesGz)
  fs.writeFileSync(path.join(SEED_DIR, 'facets.jsonl.gz'), facetsGz)

  const taxonomy = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public/presets/prompt-taxonomy/v1.json'), 'utf8'),
  )
  const manifest = {
    schemaVersion: SEED_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    license: 'reference-only',
    note:
      '提示词案例种子。内容来自 vflow.live / apiko.app / higgsfield.ai 的公开数据，' +
      '一律 reference-only：界面必须显示出处，不得当作本项目产物发布。' +
      '媒体只存外链，不下载。',
    taxonomyVersion: String(taxonomy.version || ''),
    counts: { cases: cases.length, facets: facets.length, bySource },
    files: {
      cases: { name: 'cases.jsonl.gz', bytes: casesGz.length, sha256: sha256(casesGz) },
      facets: { name: 'facets.jsonl.gz', bytes: facetsGz.length, sha256: sha256(facetsGz) },
    },
  }
  fs.writeFileSync(path.join(SEED_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`
  console.log(`[seed] cases.jsonl.gz   ${mb(casesGz.length)}  ${cases.length} 条`)
  console.log(`[seed] facets.jsonl.gz  ${mb(facetsGz.length)}  ${facets.length} 条`)
  console.log(`[seed] 来源：${JSON.stringify(bySource)}`)
  console.log(`[seed] 词表版本：${manifest.taxonomyVersion}`)
  console.log(`[seed] 输出：${path.relative(ROOT, SEED_DIR)}`)
}

function checkSeed() {
  const manPath = path.join(SEED_DIR, 'manifest.json')
  if (!fs.existsSync(manPath)) {
    console.error('[seed] 没有种子文件，先跑 node scripts/export-case-seed.mjs')
    process.exit(1)
  }
  const manifest = JSON.parse(fs.readFileSync(manPath, 'utf8'))
  const problems = []

  for (const key of ['cases', 'facets']) {
    const meta = manifest.files?.[key]
    if (!meta) {
      problems.push(`manifest 缺 ${key} 元数据`)
      continue
    }
    const file = path.join(SEED_DIR, meta.name)
    if (!fs.existsSync(file)) {
      problems.push(`文件不存在：${meta.name}`)
      continue
    }
    const buf = fs.readFileSync(file)
    if (buf.length !== meta.bytes) problems.push(`${meta.name} 字节数不符`)
    if (sha256(buf) !== meta.sha256) problems.push(`${meta.name} 哈希不符`)
    // 能解压且行数对得上
    let lines = []
    try {
      lines = zlib
        .gunzipSync(buf)
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
    } catch (e) {
      problems.push(`${meta.name} 解压失败：${e?.message || e}`)
    }
    const expect = key === 'cases' ? manifest.counts?.cases : manifest.counts?.facets
    if (expect && lines.length !== expect) {
      problems.push(`${meta.name} 行数 ${lines.length} ≠ manifest ${expect}`)
    }
  }

  // 与当前库对照（有库时）
  const dir = applyDefaultProjectsDir()
  if (dir) {
    const dbPath = path.join(dir, 'storyboard.sqlite')
    if (fs.existsSync(dbPath)) {
      const db = new DatabaseSync(dbPath, { readOnly: true })
      try {
        const n = Number(db.prepare('SELECT COUNT(*) c FROM prompt_cases').get()?.c) || 0
        if (n !== manifest.counts?.cases) {
          problems.push(`当前库 ${n} 条 ≠ 种子 ${manifest.counts?.cases} 条（种子可能过期）`)
        }
      } finally {
        db.close()
      }
    }
  }

  if (problems.length) {
    console.error('[seed] ❌ 校验失败：')
    for (const p of problems) console.error(`   - ${p}`)
    process.exit(1)
  }
  console.log(
    `[seed] ✅ ${manifest.counts.cases} 条案例 / ${manifest.counts.facets} 条分面 · 词表 ${manifest.taxonomyVersion}`,
  )
  console.log(`[seed] 来源：${JSON.stringify(manifest.counts.bySource)}`)
}

if (process.argv.includes('--check')) checkSeed()
else exportSeed()
