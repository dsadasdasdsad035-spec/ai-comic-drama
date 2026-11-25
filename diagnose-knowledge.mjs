/**
 * 知识库「聊天命中」诊断：检查一条提问从本应用打到上游的完整链路。
 *
 * 为什么需要它：用户看到「There is no relevant information...」时，可能是
 * 空库、向量未就绪、阈值过高或模式不对 —— 这些原因在界面上长得一模一样。
 * 这个脚本逐层打印，把「哪一层断了」定位到一步。
 *
 * 跑法：
 *   node diagnose-knowledge.mjs <项目名> ["问题"] [--base http://127.0.0.1:59107]
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const project = String(args[0] || '').trim()
const question = String(args[1] || '这份文档讲了什么？').trim()
const baseIdx = args.indexOf('--base')
const APP = baseIdx >= 0 ? args[baseIdx + 1] : 'http://127.0.0.1:59107'

if (!project) {
  console.error('用法：node diagnose-knowledge.mjs <项目名> ["问题"] [--base <应用地址>]')
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
    const link = db.prepare('SELECT workspace_slug FROM knowledge_links WHERE project_name = ?').get(project)
    return {
      knowledge: row ? JSON.parse(row.value).knowledge || {} : {},
      slug: String(link?.workspace_slug || ''),
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

console.log(`项目：${project}`)
console.log(`应用：${APP}`)
console.log(`问题：${question}`)

// 1. 本应用设置
step(1, '本应用的知识库设置')
const app = readAppSettings()
if (!app) {
  bad('找不到设置库')
  process.exit(1)
}
const kb = app.knowledge
info(`baseUrl = ${kb.baseUrl || '(空)'}`)
info(`enabled = ${kb.enabled}`)
info(`enabled = ${kb.enabled}, hasApiKey = ${Boolean(kb.apiKey)}`)
if (!kb.enabled || !kb.baseUrl) {
  bad('本应用还没配置知识库，视图会显示引导页')
  process.exit(1)
}
ok('本应用已配置')

// 2. 上游连通 + 认证
step(2, '上游连通与认证')
const kbApiKey = String(kb.apiKey || '').trim()
const testR = await j('/api/knowledge/test', { method: 'POST' })
if (!testR.body?.ok) {
  bad(`连接失败：${testR.body?.message || testR.status}`)
  process.exit(1)
}
ok(`认证通过，上游有 ${testR.body.workspaceCount} 个库`)
const llm = testR.body.llm
if (llm) info(`模型推送：${llm.ok ? '成功' : '失败 ' + llm.error}`)

// 3. 项目 → 库映射
step(3, '项目 → 上游库映射')
const docsR = await j(`/api/knowledge/docs?project=${encodeURIComponent(project)}`)
if (!docsR.body?.ok) {
  bad(`取文档清单失败：${docsR.body?.message}`)
  process.exit(1)
}
const slug = docsR.body.slug
const docCount = docsR.body.docCount
info(`slug = ${slug}`)
info(`文档数 = ${docCount}`)
const docs = docsR.body.documents || []
for (const d of docs.slice(0, 8)) info(`   · ${d.title || d.location}${d.wordCount ? ` (${d.wordCount} 词)` : ''}`)
if (!docCount) {
  bad('库是空的 —— 这就是「There is no relevant information」的直接原因')
  console.log('\n结论：先往这个项目上传文档，或确认你打开的是有资料的那个项目。')
  process.exit(1)
}
ok(`库里已有 ${docCount} 份文档`)

// 4. 向量是否真的写入
step(4, '向量索引（上游 LanceDB）')
const vs = await j('/api/knowledge/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, query: question, topN: 4 }),
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
  info(`   · score=${Number(h.score || 0).toFixed(3)} ${h.title || '(无标题)'} :: ${String(h.text || '').slice(0, 60).replace(/\s+/g, ' ')}`)
}
const maxScore = Math.max(...hits.map((h) => Number(h.score) || 0))
if (maxScore < 0.25) {
  console.log(`\n   ⚠️ 最高分 ${maxScore.toFixed(3)} 低于上游默认阈值 0.25 —— 上游可能因此判定「无相关内容」`)
}

// 5. 真实问答
step(5, '真实问答（走本应用 SSE）')
const t0 = Date.now()
const res = await fetch(`${APP}/api/knowledge/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ project, message: question }),
})
const raw = await res.text()
const ms = Date.now() - t0
let answer = ''
let sources = []
for (const frame of raw.split('\n\n')) {
  const line = frame.trim()
  if (!line.startsWith('data:')) continue
  const payload = line.slice(5).trim()
  if (!payload || payload === '[DONE]') continue
  let ev
  try {
    ev = JSON.parse(payload)
  } catch {
    continue
  }
  if (ev.textResponse) answer += ev.textResponse
  if (Array.isArray(ev.sources) && ev.sources.length) sources = ev.sources
}
const cleaned = answer
  .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
  .replace(/<think(?:ing)?>[\s\S]*$/gi, '')
  .trim()
info(`耗时 ${ms}ms`)
info(`原始长度 ${answer.length}，剥掉推理块后 ${cleaned.length}`)
info(`引用 ${sources.length} 段：${sources.map((s) => s.title).join('、') || '(无)'}`)
if (!cleaned) {
  bad('剥掉推理块后回答为空 —— 推理占满了输出预算')
} else if (/no relevant information/i.test(cleaned)) {
  bad('上游判定「库内无相关内容」')
  console.log('   可能原因：文档仍在解析 / 向量化失败 / 相似度低于阈值 / 问题与内容完全不相关')
} else {
  ok('回答：' + cleaned.slice(0, 160).replace(/\s+/g, ' '))
  if (answer.length > cleaned.length * 1.5) {
    console.log(`   ⚠️ 推理块占了 ${Math.round((1 - cleaned.length / answer.length) * 100)}% 的输出，建议换输出更干净的型号`)
  }
}

console.log('\n完成。')
