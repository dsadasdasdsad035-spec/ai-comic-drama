/**
 * 全量扫描 higgsfield 博客，找出所有含可提取提示词的文章。
 *
 * 为什么需要这个脚本：之前只筛了 URL 里带 "prompt" 的 6 篇，漏掉了
 * `ai-car-commercial-youtube-guide` 这种「URL 不含 prompt、但一篇有 23 段提示词」
 * 的文章。靠 URL 猜内容不可靠，必须扫正文。
 *
 * 跑法：
 *   node scripts/scan-higgsfield-blog.mjs                # 全量 347 篇
 *   node scripts/scan-higgsfield-blog.mjs --limit 30     # 抽样
 * 产物：`.case-sync/hf-blog-scan.json`
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPublicUrl } from '../server/ingest.mjs'
import { getExternalFetch } from '../server/apimart-network.mjs'
import { parseHiggsfieldArticle } from './lib/parse-higgsfield-blog.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, '.case-sync', 'hf-blog-scan.json')
const SITEMAP = 'https://higgsfield.ai/blog/sitemap.xml'

const args = process.argv.slice(2)
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 0
const CONCURRENCY = Number(args[args.indexOf('--concurrency') + 1]) || 8

const doFetch = getExternalFetch()

async function fetchText(url, { timeoutMs = 25_000, maxBytes = 8 * 1024 * 1024 } = {}) {
  const u = await assertPublicUrl(url)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await doFetch(u, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    if (text.length > maxBytes) throw new Error('too large')
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function pool(items, n, worker) {
  let cursor = 0
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor
      cursor += 1
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

const xml = await fetchText(SITEMAP)
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter(Boolean)
const targets = LIMIT > 0 ? urls.slice(0, LIMIT) : urls
console.log(`[scan] 待扫 ${targets.length} 篇（共 ${urls.length}）`)

const results = []
let done = 0
let errors = 0

await pool(targets, CONCURRENCY, async (url) => {
  const slug = url.split('/blog/')[1] || url
  try {
    const html = await fetchText(url)
    const parsed = parseHiggsfieldArticle(html, { id: `hf-${slug}`, url })
    results.push({
      url,
      slug,
      sections: parsed.sections,
      guides: parsed.guides.length,
      // 记录识别到的最长提示词，用来判断「这篇值不值得收」
      maxPromptLen: parsed.guides.reduce((m, g) => Math.max(m, (g.prompt || '').length), 0),
      titles: parsed.guides.slice(0, 3).map((g) => g.title),
    })
  } catch (e) {
    errors += 1
    results.push({ url, slug, error: String(e?.message || e) })
  }
  done += 1
  if (done % 50 === 0) console.log(`[scan] ${done}/${targets.length}`)
})

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ scannedAt: new Date().toISOString(), total: targets.length, results }, null, 2))

const hit = results.filter((r) => r.guides > 0)
const rich = hit.filter((r) => r.maxPromptLen >= 200)
console.log(`[scan] 完成：${results.length} 篇，${errors} 篇失败`)
console.log(`[scan] 含可提取提示词：${hit.length} 篇（其中 ${rich.length} 篇有 >=200 字符的完整提示词）`)
console.log(`[scan] 提示词总数：${hit.reduce((s, r) => s + r.guides, 0)} 条`)
console.log('[scan] Top 15（按条数）:')
for (const r of [...hit].sort((a, b) => b.guides - a.guides).slice(0, 15)) {
  console.log(`   ${String(r.guides).padStart(3)} 条  max=${String(r.maxPromptLen).padStart(5)}  ${r.slug.slice(0, 62)}`)
}
console.log(`[scan] 结果 → ${path.relative(ROOT, OUT)}`)
