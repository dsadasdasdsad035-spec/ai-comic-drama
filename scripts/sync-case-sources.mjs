/**
 * 把外部提示词案例全量同步进本地案例库，摆脱「每次浏览都要连外网」。
 *
 * 两个来源，同一个目标表 `prompt_cases`：
 *
 * - **vflow**：13,665 条。索引是位置数组（`index-all.json`），逐条正文要再抓
 *   `prompt-sources/v1/<id>.json`。媒体仍只存外链。
 * - **apiko**：11 个模型页，每页 90-140 条，服务端渲染，直接解析。
 *
 * 为什么是脚本而不是运行时：`public/` 在桌面端是只读资产根，而且导入量级是
 * 万级，不该让用户点一下等四分钟。脚本跑一次把数据落进本地 SQLite，之后浏览
 * 全部走本地。
 *
 * 断点续传：vflow 的逐条抓取会写 journal（`.case-sync/vflow.json`）。中断后重跑
 * 会跳过已抓的 id，不必从零开始。这是万级抓取的必需品——4 分钟里任何一次网络
 * 抖动都不该让进度归零。
 *
 * 跑法：
 *   node scripts/sync-case-sources.mjs --source vflow      # 全量 vflow
 *   node scripts/sync-case-sources.mjs --source apiko      # apiko 全部模型页
 *   node scripts/sync-case-sources.mjs --source all
 *   node scripts/sync-case-sources.mjs --source vflow --limit 200   # 试跑
 *   node scripts/sync-case-sources.mjs --status            # 只看进度
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPublicUrl } from '../server/ingest.mjs'
import { getExternalFetch } from '../server/apimart-network.mjs'
import { applyDefaultProjectsDir } from '../server/default-projects-dir.mjs'
import { parseVflowIndex, saveCases, refreshCaseFacets, listCases } from '../server/prompt-cases.mjs'
import { loadDefaultTaxonomy } from '../server/prompt-taxonomy.mjs'
import { parseApikoPrompts, slug } from './lib/parse-apiko-prompts.mjs'
import { parseHiggsfieldArticle } from './lib/parse-higgsfield-blog.mjs'
import { createHash } from 'node:crypto'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JOURNAL_DIR = path.join(ROOT, '.case-sync')
/**
 * 目标库目录。
 *
 * 顺序：显式 SB_PROJECTS_DIR → 桌面端 userData（应用真实库）→ 仓库内 projects。
 * 必须复用 `applyDefaultProjectsDir()`：开发机上的真实数据在
 * `~/Library/Application Support/storyboard-canvas/projects`，直接拼 `./projects`
 * 会把一万多条导进一个应用根本不会读的空库。
 */
const PROJECTS_DIR = applyDefaultProjectsDir() || path.join(ROOT, 'projects')

const VFLOW_INDEX = 'https://www.vflow.live/data/daily159-successor-20261111/index-all.json'
const VFLOW_ITEM = (id) => `https://www.vflow.live/data/prompt-sources/v1/${encodeURIComponent(id)}.json`

/**
 * apiko 的模型页。
 *
 * **只收视频模型。** apiko 是多模型提示词站，实测 11 页里 3 页是图像模型
 * （gpt-image-2/2-5/2-6 共 1,344 条、seedream 51、nano-banana 119），内容是
 * 「生成一张海报 / 网页 / 商品图」，进视频案例库会被用户当成「能出片的写法」，
 * 语义是错的。图像提示词要收就另开能力，不混在这里。
 *
 * 剩下 7 页是视频模型。claude-* 两页虽然页名带 video-prompts，实测内容是
 * 「用 Claude 写视频提示词」的对话记录，也保留——它给的是完整可用提示词。
 */
const APIKO_PAGES = [
  { id: 'claude-fable-5-2', url: 'https://apiko.app/claude-fable-5-2-video-prompts', model: 'claude-fable-5-2' },
  { id: 'claude-opus-5-5', url: 'https://apiko.app/claude-opus-5-5-video-prompts', model: 'claude-opus-5-5' },
  { id: 'kling-4-0', url: 'https://apiko.app/kling-4-0-prompts', model: 'kling-4-0' },
  { id: 'seedance-2-0', url: 'https://apiko.app/seedance-2-0-prompts', model: 'seedance-2-0' },
  { id: 'seedance-2-5', url: 'https://apiko.app/seedance-2-5-prompts', model: 'seedance-2-5' },
  { id: 'wan-3-0', url: 'https://apiko.app/wan-3-0-prompts', model: 'wan-3-0' },
]

/**
 * higgsfield 的候选文章（由 `scan-higgsfield-blog.mjs` 全量扫描得出）。
 *
 * 只收**成品型**：拆解 / 案例 / 实操（`-breakdown`、`case4k`、`cinematic_*`）。
 * 方法论型（Settings / Bad vs Good / Why this combination）留在「写作指南」Tab，
 * 两边不重复——同一段内容在案例列表和指南里各出现一次会让用户以为是两条东西。
 *
 * `maxPromptLen` 用来过滤：低于 200 字符的文章只给一句话示例，没有复用价值。
 */
const HIGGSFIELD_ARTICLES = [
  'ai-car-commercial-youtube-guide',
  'cinematic_headphones',
  'Santiago-breakdown',
  'cinematic',
  'case4k',
  'most-reliable-ai-video-generators-2026',
  'vfx_4k',
  'guide-animation-seedance2.0',
  'make-game-trailer-with-ai',
  'how-to-make-ai-avatar-2026',
  'ai-ecommerce-ads-2026',
  'best-ai-filmmaking-tools-short-films-2026',
  'how-to-master-ai-filmmaking',
]
/** 方法论型：这些文章的内容在指南 Tab，不进案例库 */
const HIGGSFIELD_GUIDE_ONLY = new Set([
  'seedance-2-5-prompting-guide',
  'seedance-prompting-guide',
  'ai-video-prompt-mistakes',
])

/** 内容指纹：取正文前 400 字的 sha256，用于跨文章去重 */
function promptFingerprint(prompt) {
  return createHash('sha256').update(String(prompt || '').slice(0, 400)).digest('hex').slice(0, 16)
}

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const SOURCE = opt('source', 'all')
const LIMIT = Number(opt('limit', '0')) || 0
/** 并发：实测 8 时单条 127ms；再高容易触发来源限流 */
const CONCURRENCY = Number(opt('concurrency', '8')) || 8

// ---------------------------------------------------------------- 抓取工具

function ensureJournalDir() {
  fs.mkdirSync(JOURNAL_DIR, { recursive: true })
}

function journalPath(name) {
  return path.join(JOURNAL_DIR, `${name}.json`)
}

function readJournal(name) {
  try {
    return JSON.parse(fs.readFileSync(journalPath(name), 'utf8'))
  } catch {
    return { done: [] }
  }
}

function writeJournal(name, data) {
  ensureJournalDir()
  fs.writeFileSync(journalPath(name), JSON.stringify(data))
}

/** 带超时 + 体积上限 + 重定向二次校验的抓取 */
async function fetchOk(url, { timeoutMs = 25_000, maxBytes = 8 * 1024 * 1024, retries = 2 } = {}) {
  const doFetch = getExternalFetch()
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const u = await assertPublicUrl(url)
      const res = await doFetch(u, { signal: ctrl.signal, redirect: 'follow' })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const finalUrl = String(res.url || '')
      if (finalUrl && finalUrl !== String(u)) await assertPublicUrl(finalUrl)
      const text = await res.text()
      if (text.length > maxBytes) throw new Error(`响应过大 ${text.length}`)
      return text
    } catch (e) {
      lastErr = e
      if (attempt < retries) await sleep(400 * (attempt + 1))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr || new Error('抓取失败')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 固定并发跑一个列表，逐条回调 */
async function runPool(items, concurrency, worker, onProgress) {
  let cursor = 0
  let done = 0
  const total = items.length
  const runners = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (cursor < total) {
      const idx = cursor
      cursor += 1
      await worker(items[idx], idx)
      done += 1
      if (onProgress && done % 100 === 0) onProgress(done, total)
    }
  })
  await Promise.all(runners)
  if (onProgress && done % 100 !== 0) onProgress(done, total)
}

// ---------------------------------------------------------------- vflow

async function syncVflow(taxonomy) {
  console.log('[sync:vflow] 读取索引…')
  const raw = await fetchOk(VFLOW_INDEX, { timeoutMs: 40_000, maxBytes: 16 * 1024 * 1024 })
  const index = parseVflowIndex(raw)
  const rows = index.items
  console.log(`[sync:vflow] 索引 ${rows.length} 条`)

  const journal = readJournal('vflow')
  const doneSet = new Set(journal.done)
  let wanted = rows.filter((r) => !doneSet.has(r.id))
  if (LIMIT > 0) wanted = wanted.slice(0, LIMIT)
  console.log(`[sync:vflow] 待抓 ${wanted.length}（已完成 ${doneSet.size}）`)

  const byId = new Map(rows.map((r) => [r.id, r]))
  let fetched = 0
  let failed = 0
  const batch = []

  const flush = () => {
    if (!batch.length) return
    saveCases(PROJECTS_DIR, batch.splice(0, batch.length))
  }

  await runPool(
    wanted,
    CONCURRENCY,
    async (row) => {
      try {
        const txt = await fetchOk(VFLOW_ITEM(row.id), { timeoutMs: 12_000, maxBytes: 600 * 1024 })
        const doc = JSON.parse(txt)
        const prompt = String(doc.prompt || '').trim()
        if (!prompt) throw new Error('empty prompt')
        const idxRow = byId.get(row.id) || row
        batch.push({
          source: 'vflow',
          sourceId: row.id,
          title: String(doc.title || idxRow.title || row.title || '').trim(),
          prompt,
          model: String(doc.referenceModel || idxRow.model || '').trim(),
          category: String(idxRow.category || '').trim(),
          categories: Array.isArray(idxRow.categories) ? idxRow.categories : [],
          tags: Array.isArray(idxRow.tags) ? idxRow.tags : [],
          videoUrl: String(doc.videoUrl || idxRow.videoUrl || '').trim(),
          posterUrl: String(doc.thumbnailUrl || idxRow.posterUrl || '').trim(),
          author: String(idxRow.author || '').trim(),
          sourceUrl: String(doc.sourceUrl || idxRow.sourceUrl || '').trim(),
        })
        journal.done.push(row.id)
        doneSet.add(row.id)
        fetched += 1
        // 每 200 条落一次盘：既写数据也写 journal，中断损失最小
        if (fetched % 200 === 0) {
          flush()
          writeJournal('vflow', journal)
        }
      } catch (e) {
        failed += 1
        if (failed <= 5) console.warn(`[sync:vflow] ${row.id} 失败：${e?.message || e}`)
      }
    },
    (d, total) => console.log(`[sync:vflow] ${d}/${total}`),
  )

  flush()
  writeJournal('vflow', journal)
  console.log(`[sync:vflow] 完成：抓取 ${fetched}，失败 ${failed}，累计已入库 ${journal.done.length}`)
  return { fetched, failed }
}

// ---------------------------------------------------------------- apiko

async function syncApiko(taxonomy) {
  let total = 0
  let failedPages = 0
  for (const page of APIKO_PAGES) {
    process.stdout.write(`[sync:apiko] ${page.id} … `)
    try {
      const html = await fetchOk(page.url, { timeoutMs: 30_000, maxBytes: 4 * 1024 * 1024 })
      const parsed = parseApikoPrompts(html)
      if (!parsed.items.length) {
        console.log('0 条（跳过）')
        continue
      }
      const cases = parsed.items.map((it, i) => ({
        source: 'apiko',
        // 用 页面 id + 标题 slug + 序号：标题可能重复，序号保证唯一
        sourceId: `${page.id}/${slug(it.title) || 'item'}-${i + 1}`,
        title: it.title,
        prompt: it.prompt,
        model: page.model,
        category: it.category,
        categories: it.category ? [it.category] : [],
        tags: it.category ? [it.category] : [],
        videoUrl: page.url,
        posterUrl: parsed.poster || '',
        author: '',
        sourceUrl: page.url,
      }))
      saveCases(PROJECTS_DIR, cases)
      console.log(`${cases.length} 条`)
      total += cases.length
    } catch (e) {
      failedPages += 1
      console.log(`失败：${e?.message || e}`)
    }
  }
  console.log(`[sync:apiko] 完成：${total} 条，${failedPages} 页失败`)
  return { total, failedPages }
}

// ---------------------------------------------------------------- higgsfield

/**
 * 抓 higgsfield 的成品型文章，每条提示词入库为一条案例。
 *
 * 与 apiko 的差别：一篇文章里有多个条目（一篇 20+ 条），每条有自己的小标题；
 * 提示词可能是 font-mono 块、`— PROMPT —` 分隔的正文流、或 em 段落。
 * 解析交给 `parse-higgsfield-blog.mjs`，这里只负责落库与去重。
 */
async function syncHiggsfield(taxonomy) {
  let total = 0
  let dup = 0
  let failed = 0
  /** 跨文章去重：同一段人物设定常在多篇文章里重复出现 */
  const seen = new Set()

  for (const slugName of HIGGSFIELD_ARTICLES) {
    if (HIGGSFIELD_GUIDE_ONLY.has(slugName)) continue
    const url = `https://higgsfield.ai/blog/${slugName}`
    process.stdout.write(`[sync:higgsfield] ${slugName} … `)
    try {
      const html = await fetchOk(url, { timeoutMs: 30_000, maxBytes: 6 * 1024 * 1024 })
      const parsed = parseHiggsfieldArticle(html, { id: `hf-${slugName}`, url })
      /** 只留真有长提示词的条目 */
      const usable = parsed.guides.filter((g) => (g.prompt || '').length >= 200)
      if (!usable.length) {
        console.log('0 条（跳过）')
        continue
      }
      const cases = []
      for (const [i, g] of usable.entries()) {
        const fp = promptFingerprint(g.prompt)
        if (seen.has(fp)) {
          dup += 1
          continue
        }
        seen.add(fp)
        // 文章的 Settings 字段本身就是轴线索，拼进 tag 便于分面推导
        const tagBits = [g.settings?.genre, g.settings?.lighting, g.settings?.camera].filter(Boolean)
        cases.push({
          source: 'higgsfield',
          sourceId: `${slugName}/${slug(g.title) || 'item'}-${i + 1}`,
          title: g.title,
          prompt: g.prompt,
          model: 'seedance-2-5',
          category: tagBits[0] ? String(tagBits[0]).slice(0, 60) : '',
          categories: tagBits.map((x) => String(x)),
          tags: tagBits.map((x) => String(x).slice(0, 40)),
          // 文章页本身作为出处；媒体不在正文里（higgsfield 的图是 CDN 相对路径）
          videoUrl: url,
          posterUrl: '',
          author: 'higgsfield',
          sourceUrl: url,
        })
      }
      saveCases(PROJECTS_DIR, cases)
      console.log(`${cases.length} 条`)
      total += cases.length
    } catch (e) {
      failed += 1
      console.log(`失败：${e?.message || e}`)
    }
  }
  console.log(`[sync:higgsfield] 完成：${total} 条，去重 ${dup}，${failed} 篇失败`)
  return { total, dup, failed }
}

// ---------------------------------------------------------------- 分面回填

async function backfillFacets(onlySources = ['vflow', 'apiko', 'higgsfield']) {
  console.log('[sync] 回填分面…')
  const taxonomy = loadDefaultTaxonomy()
  let scanned = 0
  let updated = 0
  let page = 1
  const PAGE = 96
  for (;;) {
    const r = listCases(PROJECTS_DIR, { page, pageSize: PAGE })
    if (!r.cases.length) break
    for (const c of r.cases) {
      if (!onlySources.includes(c.source)) continue
      scanned += 1
      if (c.taxonomyVersion === taxonomy.version) continue
      try {
        refreshCaseFacets(PROJECTS_DIR, c.id, { taxonomy })
        updated += 1
      } catch (e) {
        if (updated < 3) console.warn(`[sync] 分面失败 ${c.id}：${e?.message || e}`)
      }
    }
    if (page >= r.totalPages) break
    page += 1
    if (scanned % 500 === 0) console.log(`[sync] 分面进度 ${scanned}`)
  }
  console.log(`[sync] 分面回填完成：扫描 ${scanned}，更新 ${updated}`)
}

// ---------------------------------------------------------------- 状态

function status() {
  ensureJournalDir()
  const vf = readJournal('vflow')
  console.log(`vflow journal：已完成 ${vf.done.length} 条`)
  for (const s of ['vflow', 'apiko', 'higgsfield']) {
    const r = listCases(PROJECTS_DIR, { source: s, pageSize: 1 })
    console.log(`库里 ${s}：${r.total} 条`)
  }
  const all = listCases(PROJECTS_DIR, { pageSize: 1 })
  console.log(`案例库合计：${all.total} 条`)
}

// ---------------------------------------------------------------- 入口

const taxonomy = loadDefaultTaxonomy()
console.log(`[sync] 目标库：${PROJECTS_DIR}`)
if (flag('status')) {
  status()
} else {
  if (SOURCE === 'all' || SOURCE === 'vflow') await syncVflow(taxonomy)
  if (SOURCE === 'all' || SOURCE === 'apiko') await syncApiko(taxonomy)
  if (SOURCE === 'all' || SOURCE === 'higgsfield') await syncHiggsfield(taxonomy)
  await backfillFacets()
  status()
}
