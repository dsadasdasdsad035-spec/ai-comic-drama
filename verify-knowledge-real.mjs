/**
 * 真实 AnythingLLM 验收（task 5.4）：跑真上游，不用 mock。
 *
 * 前置：一个可用的 AnythingLLM 实例（默认 127.0.0.1:3001）+ API Key，
 * 且它内部已配好对话模型与 embedder（问答要真能出结果）。
 *
 * 覆盖：
 * 1. 连接自检（/v1/auth + workspace 列表）
 * 2. 建库（回读上游 slug）
 * 3. 上传 md 与 PDF，等 collector 解析完成
 * 4. 文档清单里两份都在
 * 5. 真实问答：回答里能看到正确事实 + sources 非空且有片段
 * 6. 向量检索：命中期望的文档
 * 7. 移出库
 *
 * 会产生少量上游 LLM token 费用（几次问答），不涉及 Seedance。
 *
 * 跑法：
 *   ANYTHINGLLM_BASE_URL=http://127.0.0.1:3001 \
 *   ANYTHINGLLM_API_KEY=xxxx \
 *   node verify-knowledge-real.mjs
 *
 * 可选：SB_PROJECTS_DIR 指定隔离项目根（强烈建议，避免碰真实库）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDatabase } from './server/db.mjs'
import { createKnowledgeClient, translateKbError } from './server/knowledge.mjs'
import { applyKbEnvDefaults } from './server/knowledge-settings.mjs'

const BASE = String(process.env.ANYTHINGLLM_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')
const KEY = String(process.env.ANYTHINGLLM_API_KEY || '').trim()
const PROJECT = String(process.env.KB_TEST_PROJECT || 'kbreal').trim()
/** 问答允许的最长等待：真模型可能慢 */
const CHAT_TIMEOUT_MS = Number(process.env.KB_CHAT_TIMEOUT_MS) || 180_000

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
console.log(`项目：${PROJECT}`)
console.log(`映射库：${path.join(ROOT, 'storyboard.sqlite')}\n`)

let slug = ''

try {
  await check('连接自检', async () => {
    const r = await client.test()
    assert.equal(r.ok, true)
    assert.equal(r.authenticated, true)
    console.log(`   上游已有 ${r.workspaceCount} 个知识库`)
  })

  await check('建库并回读上游 slug', async () => {
    slug = await client.ensureWorkspace(PROJECT, db)
    assert.ok(slug, '应当拿到上游标识')
    console.log(`   slug = ${slug}`)
    // 再调一次必须复用，不重复建库
    const again = await client.ensureWorkspace(PROJECT, db)
    assert.equal(again, slug, '已有映射时不应重建')
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

  await check('真实问答：回答正确且带引用', async () => {
    const res = await client.chatStream({ slug, message: '沈砚在哪一场正式登场？只说场合名。' })
    const text = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('问答超时')), CHAT_TIMEOUT_MS)
      let acc = ''
      let sources = []
      ;(async () => {
        try {
          for await (const chunk of res.body) {
            acc += Buffer.from(chunk).toString('utf8')
          }
          clearTimeout(timer)
          resolve(acc)
        } catch (e) {
          clearTimeout(timer)
          reject(e)
        }
      })()
    })
    // 解析 SSE：取最后的 sources，拼所有 textResponse
    let answer = ''
    let sources = []
    for (const frame of String(text).split('\n\n')) {
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
    console.log(`   回答：${answer.slice(0, 200).replace(/\s+/g, ' ')}`)
    console.log(`   引用来源：${sources.map((s) => s.title).join('、') || '(无)'}`)
    assert.ok(answer.trim().length > 0, '回答不能为空')
    assert.ok(/雨夜巷口/.test(answer), `回答应包含「雨夜巷口」，实际：${answer.slice(0, 200)}`)
    assert.ok(sources.length > 0, '应当带引用来源（sources 非空）')
    // 真实上游 source 的片段字段是 text（不是 chunk）；这里两种都认，
    // 因为断言的是「引用里有真实文档内容」，不是上游用哪个键名。
    const srcText = sources.map((s) => `${s.title || ''} ${s.text || s.chunk || ''}`).join(' ')
    console.log(`   引用片段预览：${srcText.slice(0, 120).replace(/\s+/g, ' ')}…`)
    assert.ok(/沈砚|雨夜巷口|符牌/.test(srcText), '引用片段里应有真实文档内容')
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
} catch (e) {
  console.error(`\n未预期的失败：${translateKbError(e)}`)
  bad += 1
} finally {
  db.close()
}

console.log(bad ? `\n${bad} 项失败` : '\n真实上游验收全部通过')
console.log(`映射库保留在：${ROOT}（测试库可用 ${BASE} 控制台删除 slug=${slug || '(未创建)'}）`)
process.exit(bad ? 1 : 0)
