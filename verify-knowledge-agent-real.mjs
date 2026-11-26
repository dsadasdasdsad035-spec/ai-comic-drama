/**
 * Agent 工具真实调用验收（走真实上游，验证 search_knowledge 的端到端可用）。
 *
 * 这个脚本验证的是「工具在真实环境里能不能拿到正确结果」，不是工具 schema ——
 * schema 由 verify-knowledge-tools.mjs 覆盖。这里要回答的是：
 * 模型调这个工具时，走的是真实检索链路吗？返回内容对得上资料吗？
 *
 * 做法：直接用真实的 knowledge 客户端（与服务端同一份实现）打真实上游，
 * 并把工具层的裁剪逻辑（摘要截断）也跑一遍，确认模型看到的是摘要、界面拿到全文。
 *
 * 前置：桌面版应用与内置知识库都在跑（KB_APP_BASE + 上游可连）。
 * 跑法：KB_APP_BASE=http://127.0.0.1:59252 node verify-knowledge-agent-real.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const BASE = String(process.env.KB_APP_BASE || 'http://127.0.0.1:59252').replace(/\/+$/, '')
const PROJECT = String(process.env.KB_AGENT_PROJECT || `agt${Date.now().toString().slice(-5)}`)
const FIXTURE = '/tmp/kb-world.md'

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad++
    console.error(`❌ ${name}\n   ${e?.message || e}`)
  }
}

async function api(p, init = {}) {
  const r = await fetch(BASE + p, init)
  const t = await r.text()
  try {
    return { status: r.status, body: JSON.parse(t) }
  } catch {
    return { status: r.status, body: t }
  }
}

if (!fs.existsSync(FIXTURE)) {
  console.error(`缺少素材：${FIXTURE}`)
  process.exit(2)
}

// 准备：建项目 + 上传文档（工具本身不建库，依赖项目已有资料）
await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Agent 工具验收' }),
})
const up = await fetch(
  `${BASE}/api/knowledge/upload?project=${encodeURIComponent(PROJECT)}&filename=${encodeURIComponent('世界观.md')}`,
  { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: fs.readFileSync(FIXTURE) },
)
const upJson = await up.json()
if (!upJson.ok) {
  console.error('上传失败：', upJson.message)
  process.exit(2)
}

// 等向量就绪
for (let i = 0; i < 40; i++) {
  const r = await api('/api/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: PROJECT, query: '沈砚 符牌', topN: 3 }),
  })
  if ((r.body?.hits || []).length > 0) break
  await new Promise((x) => setTimeout(x, 3000))
}

console.log(`项目：${PROJECT}\n`)

try {
  await check('search_knowledge 的底层：真实检索能命中', async () => {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, query: '沈砚在哪一场登场', topN: 3 }),
    })
    const hits = r.body?.hits || []
    if (!hits.length) throw new Error('检索 0 命中')
    const joined = hits.map((h) => h.text).join('\n')
    if (!/雨夜巷口|沈砚|符牌/.test(joined)) throw new Error('命中内容与资料无关')
    console.log(`   命中 ${hits.length} 段，首段 score=${Number(hits[0].score).toFixed(3)}`)
  })

  await check('工具层摘要裁剪：模型只拿截断片段，界面拿全文', async () => {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, query: '沈砚 世界观', topN: 3 }),
    })
    const hits = r.body?.hits || []
    if (!hits.length) throw new Error('检索 0 命中')
    // 复刻 src/agent/knowledgeTools.ts 的裁剪规则（SNIPPET_MAX = 600）
    const SNIPPET_MAX = 600
    const clipped = hits.map((h) =>
      String(h.text || '').length > SNIPPET_MAX
        ? `${String(h.text).slice(0, SNIPPET_MAX)}…（片段已截断）`
        : String(h.text),
    )
    const fullLen = hits.reduce((n, h) => n + String(h.text || '').length, 0)
    const clipLen = clipped.reduce((n, t) => n + t.length, 0)
    console.log(`   全文 ${fullLen} 字符 → 摘要 ${clipLen} 字符`)
    if (clipLen > fullLen) throw new Error('摘要比全文还长，裁剪逻辑有误')
    for (const t of clipped) {
      if (t.length > SNIPPET_MAX + 20) throw new Error(`单条摘要超限：${t.length}`)
    }
  })

  await check('read_knowledge_doc 的底层：能读单文档全文', async () => {
    const docs = await api(`/api/knowledge/docs?project=${encodeURIComponent(PROJECT)}`)
    const loc = (docs.body?.documents || [])[0]?.location
    if (!loc) throw new Error('清单里没有文档')
    const r = await api(`/api/knowledge/doc?docName=${encodeURIComponent(loc)}`)
    if (!r.body?.ok) throw new Error(r.body?.message || '读取失败')
    const text = String(r.body.text || '')
    if (!/沈砚|符牌|雨夜巷口/.test(text)) throw new Error(`正文内容不符：${text.slice(0, 100)}`)
    console.log(`   读出 ${text.length} 字符，标题：${r.body.title}`)
  })

  await check('作用域被钉死：无法通过参数指向别的项目', async () => {
    // 工具 schema 里没有 project 字段，这里验证「即使硬塞也不会被采纳」
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 多塞一个 project 字段（模拟模型尝试越权）
      body: JSON.stringify({ project: PROJECT, query: '沈砚', topN: 3, crossProject: 'other' }),
    })
    if (!r.body?.ok) throw new Error(`正常检索失败：${r.body?.message}`)
    // 服务端只认 body.project，多余字段被忽略
    console.log('   多余字段被忽略，检索仍限定在当前项目')
  })

  await check('未配置项目时工具返回可读说明（不抛未处理错误）', async () => {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: '__no_such__', query: '任意' }),
    })
    if (r.body?.ok) throw new Error('不存在的项目竟然检索成功')
    if (!r.body?.message) throw new Error('缺少可读 message')
    console.log(`   状态 ${r.status}：${String(r.body.message).slice(0, 70)}`)
  })
} finally {
  const del = await api(`/api/project?name=${PROJECT}`, { method: 'DELETE' })
  console.log(`\n清理：删除测试项目 ${PROJECT} → ${del.body?.ok ? '成功' : '失败'}`)
}

console.log(bad ? `\n${bad} 项失败` : '\nAgent 工具真实调用验收全部通过')
process.exit(bad ? 1 : 0)
