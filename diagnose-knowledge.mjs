/**
 * 知识库诊断：检查「检索命中」从本应用到上游的完整链路。
 *
 * 为什么需要它：用户看到「库里查不到内容」时，可能是空库、向量未就绪、
 * 阈值过高或上游没配 embedder —— 这些原因在界面上长得一模一样。
 * 这个脚本逐层打印，把「哪一层断了」定位到一步。
 *
 * 只跑检索，不跑问答：问答已收敛到创意会话（Agent 工具），
 * 因此本脚本零 LLM token 成本。
 *
 * 跑法：
 *   node diagnose-knowledge.mjs <库名或库id> ["查询词"] [--base http://127.0.0.1:59107]
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const kbArg = String(args[0] || '').trim()
const query = String(args[1] || '这份文档讲了什么？').trim()
const baseIdx = args.indexOf('--base')
const APP = baseIdx >= 0 ? args[baseIdx + 1] : 'http://127.0.0.1:59107'

if (!kbArg) {
  console.error('用法：node diagnose-knowledge.mjs <库名或库id> ["查询词"] [--base <应用地址>]')
  process.exit(2)
}

const step = (n, t) => console.log(`\n── ${n}. ${t}`)
const ok = (s) => console.log(`   ✅ ${s}`)
const bad = (s) => console.log(`   ❌ ${s}`)
const info = (s) => console.log(`   · ${s}`)

/** 读本应用的设置库（只读，不写） */
function readAppSettings() {
  const f = `${process.env.HOME}/Library/Application Support/storyboard-canvas/projects/storyboard.sqlite`
  if (!fs.existsSync(f)) return null
  const db = new DatabaseSync(f, { readOnly: true })
  try {
    const row = db.prepare(`SELECT value FROM settings WHERE key='app'`).get()
    const bases = db.prepare('SELECT id, name, upstream_slug FROM knowledge_bases').all()
    return {
      knowledge: row ? JSON.parse(row.value).knowledge || {} : {},
      bases: bases.map((b) => ({ id: b.id, name: b.name, upstreamSlug: b.upstream_slug })),
    }
  } finally {
    db.close()
  }
}

async function j(path, init) {
  const r = await fetch(APP + path, init)
  const t = await r.text()
  try {
    return { status: r.status, body: JSON.parse(t) }
  } catch {
    return { status: r.status, body: t }
  }
}

console.log(`库：${kbArg}`)
console.log(`应用：${APP}`)
console.log(`查询：${query}`)

// 1. 本应用设置
step(1, '本应用的知识库设置')
const app = readAppSettings()
if (!app) {
  bad('找不到设置库')
  process.exit(1)
}
const kb = app.knowledge
info(`baseUrl = ${kb.baseUrl || '(空)'}`)
info(`enabled = ${kb.enabled}, hasApiKey = ${Boolean(kb.apiKey)}`)
if (kb.enabled === false || !kb.baseUrl) {
  bad('本应用还没配置知识库，视图会显示引导页')
  process.exit(1)
}
ok('本应用已配置')

// 2. 上游连通 + 认证
step(2, '上游连通与认证')
const testR = await j('/api/knowledge/test', { method: 'POST' })
if (!testR.body?.ok) {
  bad(`连接失败：${testR.body?.message || testR.status}`)
  process.exit(1)
}
ok(`认证通过，上游有 ${testR.body.workspaceCount} 个 workspace`)

// 3. 库定位（库名或 id 都认）
step(3, '库定位')
const base =
  app.bases.find((b) => b.id === kbArg) || app.bases.find((b) => b.name === kbArg) || null
if (!base) {
  bad(`本地库表里找不到「${kbArg}」`)
  info(`现有库：${app.bases.map((b) => `${b.name}(${b.id})`).join('、') || '(空)'}`)
  process.exit(1)
}
ok(`找到库：${base.name}`)
info(`id = ${base.id}`)
info(`上游 slug = ${base.upstreamSlug || '(空)'}`)

// 4. 文档清单
step(4, '文档清单（上游实时回查）')
const docsR = await j(`/api/knowledge/docs?kbId=${encodeURIComponent(base.id)}`)
if (!docsR.body?.ok) {
  bad(`取文档清单失败：${docsR.body?.message}`)
  process.exit(1)
}
const docCount = docsR.body.docCount
info(`文档数 = ${docCount}`)
const docs = docsR.body.documents || []
for (const d of docs.slice(0, 8)) {
  info(`   · ${d.title || d.location}${d.wordCount ? ` (${d.wordCount} 词)` : ''}`)
}
if (!docCount) {
  bad('库是空的 —— 这就是「查不到内容」的直接原因')
  console.log('\n结论：先往这个库上传文档（知识库页 → 选库 → 上传文档）。')
  process.exit(1)
}
ok(`库里已有 ${docCount} 份文档`)

// 5. 向量是否真的写入
step(5, '向量索引（上游 LanceDB）')
const vs = await j('/api/knowledge/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ kbId: base.id, query, topN: 4 }),
})
if (!vs.body?.ok) {
  bad(`检索失败：${vs.body?.message}`)
  process.exit(1)
}
const hits = vs.body.hits || []
if (!hits.length) {
  bad('检索命中 0 段 —— 文档可能还没解析完，或向量化失败（embedder 未就绪）')
  console.log('\n结论：等 10-30 秒再试；仍为空则检查上游 embedder。')
  process.exit(1)
}
ok(`命中 ${hits.length} 段`)
for (const h of hits.slice(0, 4)) {
  info(
    `   · score=${Number(h.score || 0).toFixed(3)} ${h.title || '(无标题)'} :: ${String(h.text || '').slice(0, 60).replace(/\s+/g, ' ')}`,
  )
}
const maxScore = Math.max(...hits.map((h) => Number(h.score) || 0))
if (maxScore < 0.25) {
  console.log(`\n   ⚠️ 最高分 ${maxScore.toFixed(3)} 低于上游默认阈值 0.25 —— 上游可能因此判定「无相关内容」`)
}
if (hits.some((h) => /<document_metadata>/i.test(String(h.text || '')))) {
  bad('片段里还有 <document_metadata> 头（stripChunkMetadata 没生效）')
} else {
  ok('片段已剥掉上游元数据头')
}

// 6. Agent 工具实际返回什么（模型看到的那一份）
step(6, 'Agent 工具返回（模型可见摘要）')
const snip = (t, max = 600) => (String(t).length > max ? `${String(t).slice(0, max)}…（片段已截断）` : String(t))
for (const h of hits.slice(0, 2)) {
  info(`   摘要长度 ${snip(h.text).length} / 原文 ${String(h.text || '').length}`)
}
if (hits.every((h) => snip(h.text).length <= 620)) ok('摘要已按 600 字截断')
else bad('摘要没有被截断 —— 检查 knowledgeTools 的 SNIPPET_MAX')

console.log('\n完成。要验「模型会不会主动调工具」，用创意会话提问，或跑 verify-knowledge-model-tool.mjs。')
