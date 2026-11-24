/**
 * 生成提示词写作指南快照：抓 higgsfield 博客 → 解析 → 落
 * `public/presets/prompt-guides/v1.json`。
 *
 * 为什么是一次性脚本、产物入库，而不是运行时抓取：
 * 1. `public/` 是**只读资产根**（`server/paths.mjs` 的 `resolveStaticRoot`），
 *    桌面端安装包里的代码目录不可写，运行时抓取根本没地方落。
 * 2. 抓取依赖外网与别人的站点结构；这两件事都不该成为「打开案例库」的前置条件。
 * 3. 产物进 git，改版可 diff、可回滚、可离线复现。
 *
 * 跑法：
 *   node scripts/fetch-prompt-guides.mjs                    # 联网抓取并写盘
 *   node scripts/fetch-prompt-guides.mjs --from ./fixtures  # 离线：读本地 html
 *   node scripts/fetch-prompt-guides.mjs --check            # 只校验现有产物，不联网
 *
 * 许可：一律 reference-only。higgsfield 的 robots 允许 /blog/（/flow/、/library/
 * 被 disallow），但站点未声明 ai-train 政策，因此快照只作「写作参考」用途，
 * 界面必须显示出处，不得当作本项目产物发布。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPublicUrl } from '../server/ingest.mjs'
import { parseHiggsfieldArticle } from './lib/parse-higgsfield-blog.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'public/presets/prompt-guides/v1.json')
const TAXONOMY = path.join(ROOT, 'public/presets/prompt-taxonomy/v1.json')

/**
 * 要抓的文章。
 *
 * 只收录实测能解析出结构化指南的页面；`faceless-channel-one-prompt` 是流程教程、
 * `Higgsfield-SOUL-...` 是产品介绍，都没有可复用的提示词配方，不收。
 */
const SOURCES = [
  {
    id: 'hf-seedance-25',
    url: 'https://higgsfield.ai/blog/seedance-2-5-prompting-guide',
    title: 'Seedance 2.5: Complete Prompting Guide',
  },
  {
    id: 'hf-seedance',
    url: 'https://higgsfield.ai/blog/seedance-prompting-guide',
    title: 'Seedance 2.0: Formats That Go Viral',
  },
  {
    id: 'hf-mistakes',
    url: 'https://higgsfield.ai/blog/ai-video-prompt-mistakes',
    title: 'AI Video Prompt Mistakes (And How to Fix Them)',
  },
]

const args = process.argv.slice(2)
const fromDir = (() => {
  const i = args.indexOf('--from')
  return i >= 0 ? args[i + 1] : ''
})()
const checkOnly = args.includes('--check')

/** 抓一页；带超时与体积上限 */
async function fetchPage(url) {
  const u = await assertPublicUrl(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  try {
    const res = await fetch(u, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    // 重定向后二次校验：来源不能把请求引到内网
    const finalUrl = String(res.url || '')
    if (finalUrl && finalUrl !== String(u)) await assertPublicUrl(finalUrl)
    const text = await res.text()
    if (text.length > 8 * 1024 * 1024) throw new Error(`响应过大：${text.length} 字节`)
    return text
  } finally {
    clearTimeout(timer)
  }
}

/** 词表索引：`axis:value` → 该值的全部可命中词（含 token/en/aliases） */
function buildTermIndex(taxonomy) {
  const byTerm = new Map()
  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  for (const axis of taxonomy.axes) {
    for (const v of axis.values) {
      const terms = [v.en, v.token, ...(Array.isArray(v.aliases) ? v.aliases : [])]
      for (const t of terms) {
        const k = norm(t)
        if (!k) continue
        if (!byTerm.has(k)) byTerm.set(k, new Set())
        byTerm.get(k).add(`${axis.id}:${v.id}`)
      }
    }
  }
  return byTerm
}

/**
 * 把一条指南的文字映射到 18 轴。
 *
 * 只做**词表内**匹配，不猜、不造值：
 * 1. `settings` 的结构化字段直接查词表（genre/lighting/camera/color/...）
 * 2. `settingsText`、`whatItDoes`、`rationale`、`diagnosis` 里出现的词表短语
 *
 * 命中后按轴去重（同一轴最多 3 个值），保持 18 轴的筛选可用性。
 */
function mapFacets(guide, taxonomy, termIndex) {
  const norm = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  const hits = new Set()

  // 1) settings 里每个字段值直接当短语查
  const settingsText = [guide.settingsText, ...Object.values(guide.settings || {})].join(' \n ')
  // 2) 叙述性文字
  const prose = [guide.whatItDoes, guide.rationale, guide.diagnosis, guide.proTip, guide.title]
    .filter(Boolean)
    .join(' \n ')

  for (const [term, targets] of termIndex) {
    // 词表里的短语按词边界出现才算命中；短词（<4 字符）跳过，避免 "pan" 命中 "company"
    if (term.length < 4) continue
    const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i')
    if (re.test(settingsText) || re.test(prose)) {
      for (const t of targets) hits.add(t)
    }
  }

  // 每轴最多 3 个，防止一条指南把某轴刷满
  const perAxis = new Map()
  const out = []
  for (const key of hits) {
    const axis = key.split(':')[0]
    const n = perAxis.get(axis) || 0
    if (n >= 3) continue
    perAxis.set(axis, n + 1)
    out.push(key)
  }
  // 轴序跟词表走，前端展示稳定
  const axisOrder = new Map(taxonomy.axes.map((a, i) => [a.id, i]))
  out.sort((a, b) => (axisOrder.get(a.split(':')[0]) ?? 99) - (axisOrder.get(b.split(':')[0]) ?? 99))
  return out
}

async function main() {
  if (checkOnly) return checkExisting()

  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY, 'utf8'))
  const termIndex = buildTermIndex(taxonomy)

  const sources = []
  const guides = []
  for (const src of SOURCES) {
    let html = ''
    if (fromDir) {
      const file = path.join(fromDir, `${src.id}.html`)
      if (!fs.existsSync(file)) {
        console.warn(`[guides] 跳过 ${src.id}：本地文件不存在 ${file}`)
        continue
      }
      html = fs.readFileSync(file, 'utf8')
    } else {
      process.stdout.write(`[guides] 抓取 ${src.id} … `)
      try {
        html = await fetchPage(src.url)
        console.log(`${Math.round(html.length / 1024)} KB`)
      } catch (e) {
        console.error(`失败：${e?.message || e}`)
        continue
      }
    }
    const parsed = parseHiggsfieldArticle(html, src)
    console.log(`[guides] ${src.id}: ${parsed.guides.length} 篇（共 ${parsed.sections} 节）`)
    if (!parsed.guides.length) continue
    sources.push({ id: src.id, url: src.url, title: src.title, fetchedAt: new Date().toISOString() })
    for (const g of parsed.guides) {
      guides.push({ ...g, facets: mapFacets(g, taxonomy, termIndex) })
    }
  }

  if (!guides.length) {
    console.error('[guides] 没有解析出任何指南，未写盘')
    process.exit(1)
  }

  const doc = {
    schemaVersion: 1,
    // 内容指纹版本：抓取时间 + 条数，便于排查「这份快照是哪次生成的」
    version: `2026-11-24.1`,
    license: 'reference-only',
    note:
      '提示词写作指南快照。内容来自 higgsfield.ai/blog（robots 允许 /blog/）。' +
      '一律 reference-only：只作写作参考，界面必须显示出处，不得当作本项目产物发布。',
    generatedBy: 'scripts/fetch-prompt-guides.mjs',
    taxonomyVersion: String(taxonomy.version || ''),
    sources,
    guides,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

  const withFacets = guides.filter((g) => g.facets.length).length
  const covered = new Set()
  for (const g of guides) for (const f of g.facets) covered.add(f)
  console.log(`[guides] 写入 ${path.relative(ROOT, OUT)}`)
  console.log(`[guides] ${guides.length} 篇 · ${withFacets} 篇挂上轴 · 覆盖 ${covered.size} 个轴值`)
}

/** --check：只校验现有产物，不联网 */
function checkExisting() {
  if (!fs.existsSync(OUT)) {
    console.error(`[guides] 产物不存在：${path.relative(ROOT, OUT)}`)
    process.exit(1)
  }
  const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'))
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY, 'utf8'))
  const valid = new Set()
  for (const a of taxonomy.axes) for (const v of a.values) valid.add(`${a.id}:${v.id}`)

  const problems = []
  if (!Array.isArray(doc.guides) || !doc.guides.length) problems.push('guides 为空')
  if (doc.license !== 'reference-only') problems.push(`license 应为 reference-only，实际 ${doc.license}`)
  let noFacets = 0
  for (const g of doc.guides || []) {
    if (!g.id || !g.title) problems.push(`指南缺 id/title：${g.id || '(空)'}`)
    if (!Array.isArray(g.facets)) problems.push(`${g.id} 缺 facets 数组`)
    else {
      if (!g.facets.length) noFacets += 1
      for (const f of g.facets) {
        if (!valid.has(f)) problems.push(`${g.id} 的 facet 不在词表内：${f}`)
      }
    }
    // 正文里不应残留 HTML 标签
    if (/<[a-z][^>]*>/i.test(`${g.body}\n${g.prompt}`)) problems.push(`${g.id} 正文疑似残留 HTML`)
  }
  if (noFacets > (doc.guides || []).length * 0.5) {
    problems.push(`超过一半指南没有挂上任何轴（${noFacets}/${doc.guides.length}）`)
  }

  if (problems.length) {
    console.error('[guides] 校验失败：')
    for (const p of problems.slice(0, 30)) console.error(`  - ${p}`)
    process.exit(1)
  }
  const covered = new Set()
  for (const g of doc.guides) for (const f of g.facets) covered.add(f)
  console.log(`[guides] ✅ ${doc.guides.length} 篇 · 覆盖 ${covered.size} 个轴值 · license=${doc.license}`)
}

await main()
