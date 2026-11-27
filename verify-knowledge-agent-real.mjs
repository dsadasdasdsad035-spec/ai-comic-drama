/**
 * Agent 工具的真实上游验收（库维度，验证 search_knowledge 端到端可用）。
 *
 * 这个脚本验证「工具在真实环境里能不能拿到正确结果」，不是工具 schema ——
 * schema 与作用域由 `verify-knowledge-tools.mjs` 用 mock 覆盖。这里回答：
 * 真上游检索链路通不通？命中内容对得上资料吗？库隔离真的成立吗？
 *
 * 做法：直接用真实的知识库路由与真实上游，走一遍
 * 建库 → 上传 → 等向量就绪 → 检索 → 读全文 → 越库被拒 → 清理。
 *
 * 前置：
 *   - 应用在 KB_APP_BASE 上活着（桌面版内置知识库时自动满足）；
 *   - 上游可连（内置或外部 AnythingLLM 均可）。
 * 不涉及 Seedance，零视频成本；上游向量检索不经 LLM，也不产生对话 token。
 *
 * 跑法：KB_APP_BASE=http://127.0.0.1:59252 node verify-knowledge-agent-real.mjs
 */
import fs from 'node:fs'

const BASE = String(process.env.KB_APP_BASE || 'http://127.0.0.1:59252').replace(/\/+$/, '')
const STAMP = Date.now().toString().slice(-5)
const FIXTURE = process.env.KB_FIXTURE || '/tmp/kb-world.md'

let bad = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`✅ ${name}`)
  } catch (e) {
    bad += 1
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

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

if (!fs.existsSync(FIXTURE)) {
  console.error(`缺少素材：${FIXTURE}\n可以先写一份：printf '# 世界观\\n沈砚在雨夜巷口登场，凭符牌……\\n' > ${FIXTURE}`)
  process.exit(2)
}

// 两个库：一个放资料，一个空着用来验隔离
const madeA = await api('/api/knowledge/bases', jsonInit('POST', { name: `Agent验收A-${STAMP}` }))
if (!madeA.body?.ok) {
  console.error('建库失败：', madeA.body?.message || madeA.status)
  process.exit(2)
}
const kbA = madeA.body.base
const madeB = await api('/api/knowledge/bases', jsonInit('POST', { name: `Agent验收B-${STAMP}` }))
const kbB = madeB.body.base

const up = await fetch(
  `${BASE}/api/knowledge/upload?kbId=${encodeURIComponent(kbA.id)}&filename=${encodeURIComponent('世界观.md')}`,
  { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: fs.readFileSync(FIXTURE) },
)
const upJson = await up.json()
if (!upJson.ok) {
  console.error('上传失败：', upJson.message)
  await api(`/api/knowledge/bases/${encodeURIComponent(kbA.id)}`, { method: 'DELETE' })
  await api(`/api/knowledge/bases/${encodeURIComponent(kbB.id)}`, { method: 'DELETE' })
  process.exit(2)
}

// 等向量就绪（collector 解析是异步的）
let ready = false
for (let i = 0; i < 40; i++) {
  const r = await api('/api/knowledge/search', jsonInit('POST', { kbId: kbA.id, query: '沈砚 符牌', topN: 3 }))
  if ((r.body?.hits || []).length > 0) {
    ready = true
    break
  }
  await new Promise((x) => setTimeout(x, 3000))
}
if (!ready) console.warn('⚠️  等待 2 分钟仍无命中：collector 可能还没解析完，下面的断言可能失败')

console.log(`库：${kbA.name} / ${kbB.name}\n`)

try {
  await check('search_knowledge 的底层：真实检索能命中', async () => {
    const r = await api('/api/knowledge/search', jsonInit('POST', { kbId: kbA.id, query: '沈砚在哪一场登场', topN: 3 }))
    const hits = r.body?.hits || []
    if (!hits.length) throw new Error('检索 0 命中')
    if (!/雨夜巷口|沈砚|符牌/.test(hits.map((h) => h.text).join('\n'))) {
      throw new Error('命中内容与资料无关')
    }
    console.log(`   命中 ${hits.length} 段，首段 score=${Number(hits[0].score).toFixed(3)}`)
  })

  await check('工具层摘要裁剪：模型只拿截断片段，界面拿全文', async () => {
    const r = await api('/api/knowledge/search', jsonInit('POST', { kbId: kbA.id, query: '沈砚 世界观', topN: 3 }))
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
    const docs = await api(`/api/knowledge/docs?kbId=${encodeURIComponent(kbA.id)}`)
    const loc = (docs.body?.documents || [])[0]?.location
    if (!loc) throw new Error('清单里没有文档')
    const r = await api(
      `/api/knowledge/doc?kbId=${encodeURIComponent(kbA.id)}&docName=${encodeURIComponent(loc)}`,
    )
    if (!r.body?.ok) throw new Error(r.body?.message || '读取失败')
    const text = String(r.body.text || '')
    if (!/沈砚|符牌|雨夜巷口/.test(text)) throw new Error(`正文内容不符：${text.slice(0, 100)}`)
    console.log(`   读出 ${text.length} 字符，标题：${r.body.title}`)
  })

  await check('库之间隔离：B 库查不到 A 库的内容', async () => {
    const r = await api('/api/knowledge/search', jsonInit('POST', { kbId: kbB.id, query: '沈砚 符牌', topN: 3 }))
    const hits = r.body?.hits || []
    if (hits.length) throw new Error(`空库竟然命中 ${hits.length} 段 —— 跨库串味`)
    const docs = await api(`/api/knowledge/docs?kbId=${encodeURIComponent(kbB.id)}`)
    if ((docs.body?.docCount || 0) !== 0) throw new Error('B 库清单不该有文档')
    console.log('   B 库 0 命中、0 文档')
  })

  await check('越库读取被拒：A 的文档不能经 B 的库读', async () => {
    const docs = await api(`/api/knowledge/docs?kbId=${encodeURIComponent(kbA.id)}`)
    const loc = (docs.body?.documents || [])[0]?.location
    if (!loc) throw new Error('清单里没有文档')
    const r = await api(
      `/api/knowledge/doc?kbId=${encodeURIComponent(kbB.id)}&docName=${encodeURIComponent(loc)}`,
    )
    if (r.body?.ok) throw new Error('越库读取竟然成功')
    console.log(`   状态 ${r.status}：${String(r.body?.message || '').slice(0, 70)}`)
  })
} finally {
  for (const kb of [kbA, kbB]) {
    const del = await api(`/api/knowledge/bases/${encodeURIComponent(kb.id)}`, { method: 'DELETE' })
    console.log(`清理：删除库 ${kb.name} → ${del.body?.ok ? '成功' : '失败'}`)
  }
}

console.log(bad ? `\n${bad} 项失败` : '\nAgent 工具真实调用验收全部通过')
process.exit(bad ? 1 : 0)
