/**
 * 真实 AnythingLLM 验收（库维度）：跑真上游，不用 mock。
 *
 * 前置：一个可用的 AnythingLLM 实例（默认 127.0.0.1:3001）+ API Key，
 * 且它内部已配好 embedder（向量检索要能出结果）。
 *
 * 覆盖：
 * 1. 连接自检（/v1/auth + workspace 列表）
 * 2. 建库（回读上游 slug；同名不堆重复库）
 * 3. 上传 md 与 PDF，等 collector 解析完成
 * 4. 文档清单里两份都在
 * 5. 向量检索：命中期望的文档
 * 6. 库隔离：另一个库查不到这份资料
 * 7. 移出库（只解绑）
 *
 * **不跑问答**：问答已收敛到创意会话（Agent 工具），这里只验检索链路。
 * 向量检索不经 LLM，因此本脚本零 LLM token 成本，也不涉及 Seedance。
 *
 * 跑法：
 *   ANYTHINGLLM_BASE_URL=http://127.0.0.1:3001 \
 *   ANYTHINGLLM_API_KEY=xxxx \
 *   node verify-knowledge-real.mjs
 *
 * 可选：SB_PROJECTS_DIR 指定隔离库根（强烈建议，避免碰真实库）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseByName,
  openDatabase,
} from './server/db.mjs'
import { createKnowledgeClient, translateKbError } from './server/knowledge.mjs'
import { applyKbEnvDefaults } from './server/knowledge-settings.mjs'

const BASE = String(process.env.ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const KEY = String(process.env.ANYTHINGLLM_API_KEY || '').trim()
const KB_NAME = String(process.env.KB_TEST_NAME || `真实验收库-${Date.now().toString().slice(-5)}`).trim()

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

if (!KEY) {
  console.error('缺少 ANYTHINGLLM_API_KEY；请先在本实例里生成 API Key')
  process.exit(2)
}

const settings = { baseUrl: BASE, apiKey: KEY, enabled: true }
const client = createKnowledgeClient({
  getSettings: () => settings,
  getExternalFetch: () => null,
  timeoutMs: 60_000,
})

/** 临时项目根：映射表落这里，绝不碰真实库 */
const ROOT = process.env.SB_PROJECTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'kb-real-'))
fs.mkdirSync(ROOT, { recursive: true })
const db = openDatabase(ROOT)

/**
 * 测试素材路径。
 *
 * 注意 macOS 的 `os.tmpdir()` 解析到 `/var/folders/...` 而不是 `/tmp`，
 * 所以不能拿它当默认值去猜 /tmp 下的文件 —— 直接按 /tmp 找，找不到再用 tmpdir。
 */
function findFixture(name) {
  for (const dir of ['/tmp', os.tmpdir()]) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  return path.join('/tmp', name)
}

const MD = String(process.env.KB_MD_PATH || findFixture('kb-verify-world.md'))
const PDF = String(process.env.KB_PDF_PATH || findFixture('kb-src.pdf'))

console.log(`上游：${BASE}`)
console.log(`库名：${KB_NAME}`)
console.log(`本地库文件：${path.join(ROOT, 'storyboard.sqlite')}\n`)

let slug = ''

try {
  await check('连接自检', async () => {
    const r = await client.test()
    assert.equal(r.ok, true)
    assert.equal(r.authenticated, true)
    console.log(`   上游已有 ${r.workspaceCount} 个知识库`)
  })

  await check('建库并回读上游 slug', async () => {
    const before = (await client.test()).workspaceCount
    slug = await client.createUpstreamWorkspace(KB_NAME)
    assert.ok(slug, '应当拿到上游标识')
    console.log(`   slug = ${slug}`)
    createKnowledgeBase(db, { name: KB_NAME, upstreamSlug: slug })
    // 同名再建一次：上游会拒绝，客户端应回落到「按名字找回」而不是新建
    const again = await client.createUpstreamWorkspace(KB_NAME)
    assert.equal(again, slug, '同名库应找回同一个 slug，不重复建')
    const after = (await client.test()).workspaceCount
    assert.equal(after, before + 1, `上游库数应只 +1，实际 ${before} → ${after}`)
  })

  await check('上传 markdown', async () => {
    assert.ok(fs.existsSync(MD), `缺少测试文件 ${MD}`)
    const docs = await client.uploadDoc({
      slug,
      filename: path.basename(MD),
      bytes: fs.readFileSync(MD),
      mime: 'text/markdown',
    })
    assert.ok(docs.length > 0, '上游应返回解析后的文档条目')
    console.log(`   解析出 ${docs.length} 条：${docs.map((d) => d.title).join('、')}`)
  })

  await check('上传 PDF', async () => {
    if (!fs.existsSync(PDF)) {
      console.log(`   ⚠️ 跳过：找不到 ${PDF}（可用 KB_PDF_PATH 指定）`)
      return
    }
    const docs = await client.uploadDoc({
      slug,
      filename: path.basename(PDF),
      bytes: fs.readFileSync(PDF),
      mime: 'application/pdf',
    })
    assert.ok(docs.length > 0, 'PDF 应被解析成至少一条文档')
    console.log(`   解析出 ${docs.length} 条：${docs.map((d) => d.title).join('、')}`)
  })

  await check('文档清单包含已上传文件', async () => {
    const detail = await client.listDocs(slug)
    assert.ok(detail.docCount >= 1, `文档数应 ≥1，实际 ${detail.docCount}`)
    const titles = detail.documents.map((d) => d.title).join(' | ')
    console.log(`   清单（${detail.docCount}）：${titles}`)
    assert.ok(/kb-verify-world|kb-src/.test(titles), `清单里应有测试文件，实际：${titles}`)
  })

  await check('向量检索命中期望内容', async () => {
    const hits = await client.search(slug, '沈砚在哪一场登场', { topN: 4 })
    assert.ok(hits.length > 0, '检索应至少命中一段')
    const joined = hits.map((h) => h.text).join('\n')
    console.log(`   命中 ${hits.length} 段，首段分数 ${hits[0].score.toFixed(3)}`)
    console.log(`   片段预览：${hits[0].text.slice(0, 120).replace(/\s+/g, ' ')}…`)
    assert.ok(
      /雨夜巷口|第三场|符牌|沈砚/.test(joined),
      `命中内容应包含资料里的事实，实际：${joined.slice(0, 300)}`,
    )
  })

  await check('Agent 工具能用同一客户端检索（search_knowledge 的底层）', async () => {
    const hits = await client.search(slug, '核心道具是什么', { topN: 3 })
    assert.ok(hits.length > 0)
    const joined = hits.map((h) => h.text).join(' ')
    console.log(`   道具检索命中 ${hits.length} 段`)
    assert.ok(/符牌|镇|锁|焚/.test(joined), `应命中符牌相关内容，实际：${joined.slice(0, 200)}`)
  })

  await check('移出本库只解绑', async () => {
    const detail = await client.listDocs(slug)
    const locs = detail.documents
      .filter((d) => /kb-verify-world|kb-src/.test(d.title))
      .map((d) => d.location)
    if (!locs.length) {
      console.log('   ⚠️ 跳过：清单里没有测试文档')
      return
    }
    const r = await client.removeDocs(slug, locs)
    console.log(`   移出 ${r.removed} 份`)
    const after = await client.listDocs(slug)
    assert.equal(
      after.documents.filter((d) => /kb-verify-world|kb-src/.test(d.title)).length,
      0,
      '移出后清单不应再有测试文档',
    )
  })
  await check('库隔离：新建的空库查不到这份资料', async () => {
    const otherSlug = await client.createUpstreamWorkspace(`${KB_NAME}-空`)
    try {
      const hits = await client.search(otherSlug, '沈砚在哪一场登场', { topN: 3 })
      assert.equal(hits.length, 0, `空库不该命中，实际 ${hits.length} 段`)
      const detail = await client.listDocs(otherSlug)
      assert.equal(detail.docCount, 0, '空库清单应为 0')
      console.log('   空库 0 命中、0 文档')
    } finally {
      await client.deleteWorkspace(otherSlug).catch(() => {})
    }
  })
} catch (e) {
  console.error(`\n未预期的失败：${translateKbError(e)}`)
  bad += 1
} finally {
  // 本地库行一并清掉：这是临时库文件，留着只会让下次跑出现重名
  const row = getKnowledgeBaseByName(db, KB_NAME)
  if (row) deleteKnowledgeBase(db, row.id)
  db.close()
}

console.log(bad ? `\n${bad} 项失败` : '\n真实上游验收全部通过')
console.log(`上游可能残留 slug=${slug || '(未创建)'}：如需清理，可在 ${BASE} 控制台删除`)
process.exit(bad ? 1 : 0)
