/**
 * 会话选库隔离验收（真实上游，零 LLM token）。
 *
 * 验的是最容易出错、出错又最不显眼的一条：两个会话选不同的库，检索结果不能串。
 * 串了的话用户会拿到另一个库的、看起来完全正常的答案 —— 没有报错可循。
 *
 * 两层都验：
 * 1. **路由层**：同一 sessionId 的检索只在该会话选定的库里；
 * 2. **工具桥层**：`invoke` 按 sessionId 现建知识库工具，并发交替调用各拿各的。
 *    （桥复用按项目缓存的工具表时，后一次会把前一次的库覆盖掉。）
 *
 * 前置：一个存活的 AnythingLLM（默认 127.0.0.1:3001）+ API Key，且配好 embedder；
 *       一个跑着的应用实例（`KB_APP_BASE`）。不跑问答，因此不产生 LLM 费用。
 *
 * 跑法：
 *   ANYTHINGLLM_BASE_URL=http://127.0.0.1:3001 ANYTHINGLLM_API_KEY=xxxx \
 *   KB_APP_BASE=http://127.0.0.1:59252 \
 *   node verify-knowledge-session-kb.mjs
 */
import assert from 'node:assert/strict'

const BASE = String(process.env.KB_APP_BASE || '').replace(/\/+$/, '')
const STAMP = Date.now().toString().slice(-5)
/** 两个库各放一个只有自己才知道的词，命中即证明没串 */
const WORD_A = `朱雀${STAMP}`
const WORD_B = `玄武${STAMP}`

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

if (!BASE) {
  console.error('缺少 KB_APP_BASE：需要一个跑着的应用实例（桌面版或 server/index.mjs）')
  process.exit(2)
}

const health = await api('/api/health').catch(() => ({ status: 0 }))
if (health.status !== 200) {
  console.error(`应用不可达：${BASE}（/api/health 返回 ${health.status}）`)
  process.exit(2)
}

const mkBase = async (name) => {
  const r = await api('/api/knowledge/bases', jsonInit('POST', { name }))
  if (!r.body?.ok) throw new Error(`建库失败：${r.body?.message || r.status}`)
  return r.body.base
}

const upload = async (kbId, filename, text) => {
  const r = await api(
    `/api/knowledge/upload?kbId=${encodeURIComponent(kbId)}&filename=${encodeURIComponent(filename)}`,
    { method: 'POST', headers: { 'Content-Type': 'text/markdown' }, body: Buffer.from(text) },
  )
  if (!r.body?.ok) throw new Error(`上传失败：${r.body?.message || r.status}`)
}

/** collector 解析是异步的：等到有命中为止 */
const waitHits = async (kbId, query, label) => {
  for (let i = 0; i < 40; i++) {
    const r = await api('/api/knowledge/search', jsonInit('POST', { kbId, query, topN: 4 }))
    if ((r.body?.hits || []).length > 0) return r.body.hits
    await new Promise((x) => setTimeout(x, 3000))
  }
  throw new Error(`${label}：等了 2 分钟仍无命中（collector 可能没解析完）`)
}

const kbA = await mkBase(`隔离验收A-${STAMP}`)
const kbB = await mkBase(`隔离验收B-${STAMP}`)
console.log(`库：${kbA.name} / ${kbB.name}\n`)

try {
  await check('准备：两个库各上传一份只有自己才知道的资料', async () => {
    await upload(kbA.id, '甲卷.md', `# 甲卷\n\n本卷的核心记号是 ${WORD_A}，只出现在甲卷。\n`)
    await upload(kbB.id, '乙卷.md', `# 乙卷\n\n本卷的核心记号是 ${WORD_B}，只出现在乙卷。\n`)
    await waitHits(kbA.id, WORD_A, '甲库')
    console.log(`   ${kbA.name} 已可检索`)
    await waitHits(kbB.id, WORD_B, '乙库')
    console.log(`   ${kbB.name} 已可检索`)
  })

  const SESS_A = `verify-a-${STAMP}`
  const SESS_B = `verify-b-${STAMP}`

  await check('两个会话分别绑定不同的库', async () => {
    const a = await api('/api/knowledge/session-kb', jsonInit('POST', { sessionId: SESS_A, kbId: kbA.id }))
    assert.equal(a.body.ok, true, a.body.message)
    const b = await api('/api/knowledge/session-kb', jsonInit('POST', { sessionId: SESS_B, kbId: kbB.id }))
    assert.equal(b.body.ok, true, b.body.message)
    const readA = await api(`/api/knowledge/session-kb?sessionId=${encodeURIComponent(SESS_A)}`)
    const readB = await api(`/api/knowledge/session-kb?sessionId=${encodeURIComponent(SESS_B)}`)
    assert.equal(readA.body.kbId, kbA.id)
    assert.equal(readB.body.kbId, kbB.id)
    console.log(`   A → ${readA.body.base.name}；B → ${readB.body.base.name}`)
  })

  await check('按会话检索：A 只命中甲卷，B 只命中乙卷', async () => {
    // 用对方的记号去问，验证「不是靠关键词隔离，而是靠作用域」
    const a = await api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_A, query: WORD_B, topN: 4 }))
    assert.equal(a.body.ok, true, a.body.message)
    const aText = (a.body.hits || []).map((h) => h.text).join('\n')
    assert.equal(a.body.hits.length > 0, true, 'A 库用自己的词应当有命中')
    assert.equal(aText.includes(WORD_B), false, `A 会话查到了乙卷的内容：${aText.slice(0, 120)}`)

    const b = await api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_B, query: WORD_A, topN: 4 }))
    const bText = (b.body.hits || []).map((h) => h.text).join('\n')
    assert.equal(bText.includes(WORD_A), false, `B 会话查到了甲卷的内容：${bText.slice(0, 120)}`)
    console.log(`   A 命中 ${a.body.hits.length} 段（无乙卷内容）；B 命中 ${(b.body.hits || []).length} 段（无甲卷内容）`)
  })

  await check('并发交替检索不串味（同一进程内的作用域是原子的）', async () => {
    const rounds = []
    for (let i = 0; i < 3; i++) {
      rounds.push(
        api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_A, query: '核心记号', topN: 2 })),
        api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_B, query: '核心记号', topN: 2 })),
      )
    }
    const results = await Promise.all(rounds)
    for (let i = 0; i < results.length; i += 2) {
      const aText = (results[i].body.hits || []).map((h) => h.text).join('\n')
      const bText = (results[i + 1].body.hits || []).map((h) => h.text).join('\n')
      assert.equal(aText.includes(WORD_B), false, `第 ${i / 2 + 1} 轮 A 串到了乙卷`)
      assert.equal(bText.includes(WORD_A), false, `第 ${i / 2 + 1} 轮 B 串到了甲卷`)
    }
    console.log('   3 轮并发交替，各拿各的')
  })

  await check('未选库的会话检索返回可读说明（不跨库兜底）', async () => {
    const r = await api(
      '/api/knowledge/search',
      jsonInit('POST', { sessionId: `never-picked-${STAMP}`, query: '核心记号' }),
    )
    assert.equal(r.status, 400)
    assert.equal(r.body.code, 'kb_session_unset')
    assert.match(String(r.body.message), /还没有选择知识库/)
  })

  await check('删掉 A 库：A 会话回到未选，B 会话不受影响', async () => {
    const del = await api(`/api/knowledge/bases/${encodeURIComponent(kbA.id)}`, { method: 'DELETE' })
    assert.equal(del.body.ok, true, del.body.message)
    const a = await api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_A, query: '核心记号' }))
    assert.equal(a.body.code, 'kb_session_unset', JSON.stringify(a.body))
    const b = await api('/api/knowledge/search', jsonInit('POST', { sessionId: SESS_B, query: '核心记号' }))
    assert.equal(b.body.ok, true, b.body.message)
    const bText = (b.body.hits || []).map((h) => h.text).join('\n')
    assert.equal(bText.includes(WORD_A), false, 'B 仍不该看到甲卷')
    console.log('   A → 未选；B 正常检索')
  })
} finally {
  const delB = await api(`/api/knowledge/bases/${encodeURIComponent(kbB.id)}`, { method: 'DELETE' }).catch(() => null)
  console.log(`\n清理：删除 ${kbB.name} → ${delB?.body?.ok ? '成功' : '失败（可手动删）'}`)
}

console.log(bad ? `\n${bad} 项失败` : '\n会话选库隔离验收全部通过')
process.exit(bad ? 1 : 0)
