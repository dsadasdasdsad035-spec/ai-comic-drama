/**
 * 外部案例同步验收（不联网，只验本地库与脚本契约）。
 *
 * 覆盖：来源白名单、许可口径、脚本参数、分面完整性、数据规模、
 * 以及「同步脚本能在中断后继续」的 journal 契约。
 *
 * 跑法：node verify-case-sync.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { CASE_SOURCES, LICENSE_BY_SOURCE, CASE_SOURCE_REGISTRY } from './server/prompt-cases.mjs'
import { applyDefaultProjectsDir } from './server/default-projects-dir.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

// ---------------------------------------------------------------- 来源契约

unit('apiko 在来源白名单里', CASE_SOURCES.includes('apiko'), CASE_SOURCES.join(','))
unit('apiko 许可为仅参考', LICENSE_BY_SOURCE.apiko === 'reference-only', LICENSE_BY_SOURCE.apiko)
unit('vflow 许可为仅参考', LICENSE_BY_SOURCE.vflow === 'reference-only')
// 登记表只管外部来源适配器；manual / reverse-own 是内部来源，没有适配器
for (const s of CASE_SOURCES.filter((x) => x === 'vflow' || x === 'apiko')) {
  unit(`来源登记表含 ${s}`, Boolean(CASE_SOURCE_REGISTRY[s]))
}
unit(
  'apiko 不在界面导入列表（万级抓取走脚本）',
  CASE_SOURCE_REGISTRY.apiko?.enabled === false,
  CASE_SOURCE_REGISTRY.apiko?.reason || '',
)
unit(
  'higgsfield 的说明指向写作指南',
  /写作指南/.test(CASE_SOURCE_REGISTRY.higgsfield?.reason || ''),
  CASE_SOURCE_REGISTRY.higgsfield?.reason || '',
)

// ---------------------------------------------------------------- 脚本契约

const scriptPath = path.join(ROOT, 'scripts/sync-case-sources.mjs')
unit('同步脚本存在', fs.existsSync(scriptPath))
const scriptSrc = fs.readFileSync(scriptPath, 'utf8')
unit('脚本支持 --source', /--source/.test(scriptSrc))
unit('脚本支持 --limit 试跑', /--limit/.test(scriptSrc))
unit('脚本支持 --status', /--status/.test(scriptSrc))
unit('脚本有断点续传 journal', /\.case-sync|JOURNAL_DIR/.test(scriptSrc))
unit('脚本复用真实库目录解析', /applyDefaultProjectsDir/.test(scriptSrc))
const apikoPagesBlock = /const APIKO_PAGES = \[([\s\S]*?)\]/.exec(scriptSrc)?.[1] || ''
unit(
  'apiko 只收视频模型页',
  apikoPagesBlock.length > 0 && !/gpt-image|seedream|nano-banana/.test(apikoPagesBlock),
  `页面数 ${(apikoPagesBlock.match(/url:/g) || []).length}`,
)

const apikoParser = path.join(ROOT, 'scripts/lib/parse-apiko-prompts.mjs')
unit('apiko 解析器存在', fs.existsSync(apikoParser))

// ---------------------------------------------------------------- 数据质量

const dir = applyDefaultProjectsDir()
unit('找到应用真实库目录', Boolean(dir), dir || '(无)')

if (dir && fs.existsSync(path.join(dir, 'storyboard.sqlite'))) {
  const db = new DatabaseSync(path.join(dir, 'storyboard.sqlite'), { readOnly: true })
  const all = (sql, ...a) => db.prepare(sql).all(...a)
  const one = (sql, ...a) => db.prepare(sql).get(...a)

  const total = one('SELECT COUNT(*) c FROM prompt_cases').c
  unit('案例库有数据', total > 0, `${total} 条`)

  const bySource = Object.fromEntries(
    all('SELECT source, COUNT(*) c FROM prompt_cases GROUP BY source').map((r) => [r.source, r.c]),
  )
  console.log(`   · 来源分布：${JSON.stringify(bySource)}`)

  for (const [src, n] of Object.entries(bySource)) {
    unit(`${src} 全部有许可`, one('SELECT COUNT(*) c FROM prompt_cases WHERE source=? AND license=?', src, 'reference-only').c === n || src === 'reverse-own', `${n} 条`)
  }

  // 图像模型不该出现在案例库
  const imageLike = one(
    "SELECT COUNT(*) c FROM prompt_cases WHERE model LIKE 'gpt-image%' OR model LIKE 'nano-banana%' OR model LIKE 'seedream%'",
  ).c
  unit('案例库无图像模型条目', imageLike === 0, `${imageLike} 条`)

  // 正文非空率
  const empty = one("SELECT COUNT(*) c FROM prompt_cases WHERE LENGTH(TRIM(prompt))=0").c
  unit('没有空正文', empty === 0, `${empty} 条空正文`)

  // 外链媒体占比（只存外链是明确决策）
  const hasVideo = one("SELECT COUNT(*) c FROM prompt_cases WHERE video_url<>''").c
  unit('媒体以外链保存', hasVideo > 0, `${hasVideo} 条带视频外链`)

  // 分面完整性：有案例必须有分面（至少一部分）
  const withFacets = one('SELECT COUNT(DISTINCT case_id) c FROM case_facets WHERE suppressed=0').c
  unit('分面覆盖过半案例', withFacets >= total * 0.5, `${withFacets}/${total}`)

  // 分面值必须都在词表内
  const tax = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/presets/prompt-taxonomy/v1.json'), 'utf8'))
  const valid = new Set()
  for (const a of tax.axes) for (const v of a.values) valid.add(`${a.id}:${v.id}`)
  const facetRows = all('SELECT DISTINCT axis, value FROM case_facets WHERE unmapped=0')
  const invalid = facetRows.filter((r) => !valid.has(`${r.axis}:${r.value}`))
  unit('分面值全部落在词表内', invalid.length === 0, invalid.slice(0, 3).map((r) => `${r.axis}:${r.value}`).join(', '))

  // 18 轴覆盖度（这是「补齐」的量化指标）
  const covered = new Set(facetRows.map((r) => r.axis))
  const coveredValues = new Set(facetRows.map((r) => `${r.axis}:${r.value}`))
  console.log(`   · 轴覆盖：${covered.size}/18 轴，${coveredValues.size}/${[...valid].length} 个值`)
  unit('轴覆盖 >= 15', covered.size >= 15, `${covered.size}/18`)

  // 索引存在性（万级数据的分页/搜索依赖）
  const idx = all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='prompt_cases'").map((r) => r.name)
  unit('prompt_cases 有索引', idx.length >= 2, idx.join(','))
}

// ---------------------------------------------------------------- journal

const journalDir = path.join(ROOT, '.case-sync')
if (fs.existsSync(journalDir)) {
  const files = fs.readdirSync(journalDir)
  unit('journal 目录可读', true, files.join(','))
} else {
  console.log('   · 无 .case-sync（尚未跑过全量同步，跳过）')
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 案例同步契约全部通过')
process.exit(bad ? 1 : 0)
