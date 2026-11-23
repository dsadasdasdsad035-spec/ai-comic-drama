#!/usr/bin/env node
/**
 * 回填提示词案例的分面。
 *
 * 词表升级或新案例来自老版本时，`case_facets` 可能落后于当前词表。这里按当前
 * 词表逐条重推并写入 `taxonomy_version`，让「版本落后」的案例重新变得可筛选。
 *
 * 语义与导入时的推导一致：
 *   - 已有 import/manual 的轴整轴跳过（事实比文本猜测可信）；
 *   - 用户手工隐藏的值不会被写回；
 *   - 旧的 derived 行若不在新结果里会被删除，所以重复执行是幂等的。
 *
 * 用法：
 *   node scripts/backfill-prompt-facets.mjs                 # 回填全部（默认最多 200 条）
 *   node scripts/backfill-prompt-facets.mjs --dry-run       # 只算不写，报告将新增/变更多少
 *   node scripts/backfill-prompt-facets.mjs --limit 50      # 限制条数
 *   node scripts/backfill-prompt-facets.mjs --only-stale    # 只处理词表版本落后的案例
 */
import path from 'node:path'
import { openDatabase, resolveRoot } from '../server/db.mjs'
import {
  listStaleFacetCases,
  refreshCaseFacets,
} from '../server/prompt-cases.mjs'
import { loadTaxonomy, taxonomyVersion } from '../server/prompt-taxonomy.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)

function flag(name) {
  return args.includes(name)
}

function option(name, fallback) {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v && !v.startsWith('--') ? v : fallback
}

const DRY_RUN = flag('--dry-run')
const ONLY_STALE = flag('--only-stale')
const LIMIT = Math.max(1, Math.min(5000, Number(option('--limit', '200')) || 200))

function main() {
  const taxonomy = loadTaxonomy(ROOT)
  const version = taxonomyVersion(taxonomy)
  // 库目录必须解析一次后全流程复用：resolveRoot 会把 SB_PROJECTS_DIR / 旁挂目录
  // 算进来，而 openDatabase 只认传进来的目录，传 ROOT 会写到仓库根下的空库。
  const dbRoot = resolveRoot(ROOT)
  const d = openDatabase(dbRoot)

  const before = Number(d.prepare('SELECT COUNT(*) c FROM case_facets').get()?.c) || 0

  let targets = []
  if (ONLY_STALE) {
    const stale = listStaleFacetCases(dbRoot, version, { limit: LIMIT })
    targets = stale.cases.map((c) => c.id)
    console.log(`词表版本：${version}`)
    console.log(`库根：${dbRoot}`)
    console.log(`版本落后：${stale.total} 条，本次处理 ${targets.length} 条${stale.total > targets.length ? `（上限 ${LIMIT}）` : ''}`)
  } else {
    targets = d
      .prepare('SELECT id FROM prompt_cases ORDER BY created_at DESC LIMIT ?')
      .all(LIMIT)
      .map((r) => r.id)
    console.log(`词表版本：${version}`)
    console.log(`库根：${dbRoot}`)
    console.log(`案例总数：${Number(d.prepare('SELECT COUNT(*) c FROM prompt_cases').get()?.c) || 0}，本次处理 ${targets.length} 条`)
  }

  if (!targets.length) {
    console.log('没有需要回填的案例。')
    return
  }

  console.log(`模式：${DRY_RUN ? '预演（不写库）' : '写入'}`)

  let written = 0
  let skipped = 0
  for (const id of targets) {
    const derived = refreshCaseFacets(dbRoot, id, { taxonomy, dryRun: DRY_RUN })
    if (!Array.isArray(derived)) {
      skipped += 1
      continue
    }
    written += derived.length
  }

  const after = Number(d.prepare('SELECT COUNT(*) c FROM case_facets').get()?.c) || 0
  if (DRY_RUN) {
    console.log(`预演完成：${targets.length} 条案例，将得到 ${written} 个分面（当前库内 ${before} 行）`)
    return
  }
  console.log(
    `回填完成：${targets.length - skipped} 条案例，写入 ${written} 个分面；case_facets ${before} → ${after} 行`,
  )

  // 未映射值单独列出来：它们是词表缺口，不是脏数据，需要人工决定是否补词表
  const unmapped = d
    .prepare(
      "SELECT axis, value, COUNT(*) n FROM case_facets WHERE unmapped=1 AND suppressed=0 GROUP BY axis, value ORDER BY n DESC LIMIT 50",
    )
    .all()
  if (unmapped.length) {
    console.log('\n未映射值（词表缺口，可考虑补充 sourceMappings）：')
    for (const r of unmapped) console.log(`  ${r.axis}:${r.value} × ${r.n}`)
  }
}

main()
