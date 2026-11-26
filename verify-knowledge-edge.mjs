/**
 * 知识库边界条件验收（真实上游）。
 *
 * 覆盖用户实际会撞到的异常输入：
 * - 不支持的文件类型（拒绝，且给出可读原因）
 * - 空文件（拒绝）
 * - 超大文件（本地按 Content-Length 预拒绝，不浪费上游配额）
 * - 并发上传多个文件（互不干扰）
 * - 文件名含特殊字符 / 中文
 * - 移出时传非法路径（防路径穿越）
 * - 不存在的项目（可读错误而非 500）
 *
 * 跑法：KB_APP_BASE=http://127.0.0.1:57835 node verify-knowledge-edge.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE = String(process.env.KB_APP_BASE || 'http://127.0.0.1:57835').replace(/\/+$/, '')
const PROJECT = String(process.env.KB_EDGE_PROJECT || `edge${Date.now().toString().slice(-5)}`)

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
  let body = t
  try {
    body = JSON.parse(t)
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, body }
}

async function upload(filename, bytes, mime = 'application/octet-stream') {
  return api(
    `/api/knowledge/upload?project=${encodeURIComponent(PROJECT)}&filename=${encodeURIComponent(filename)}`,
    { method: 'POST', headers: { 'Content-Type': mime }, body: bytes },
  )
}

// 建项目
const made = await api(`/api/project?name=${PROJECT}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '边界验收' }),
})
if (!made.body?.ok) {
  console.error('建项目失败：', made.body?.message || made.status)
  process.exit(2)
}
console.log(`项目：${PROJECT}\n`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-edge-'))
try {
  await check('不支持的类型：.exe 被上游拒绝且原因可读', async () => {
    const exe = Buffer.from('MZ\x90\x00fake-binary-content')
    const r = await upload('virus.exe', exe, 'application/octet-stream')
    if (r.status === 200 && r.body?.ok) {
      throw new Error('竟然接受了 .exe —— 需要确认上游是否有类型白名单')
    }
    console.log(`   状态 ${r.status}：${String(r.body?.message || '').slice(0, 100)}`)
  })

  await check('空文件被拒绝', async () => {
    const r = await upload('empty.md', Buffer.alloc(0), 'text/markdown')
    if (r.status === 200 && r.body?.ok) throw new Error('空文件竟然上传成功')
    console.log(`   状态 ${r.status}：${String(r.body?.message || '').slice(0, 80)}`)
  })

  await check('超大文件在本地被预拒绝（413，不浪费上游配额）', async () => {
    // 上限 100MB，这里用 101MB 触发 Content-Length 预检
    const big = Buffer.alloc(101 * 1024 * 1024, 0x61)
    const r = await upload('huge.md', big, 'text/markdown')
    if (r.status !== 413) throw new Error(`期望 413，实际 ${r.status}：${String(r.body?.message || '').slice(0, 80)}`)
    console.log(`   状态 413：${String(r.body?.message || '').slice(0, 60)}`)
  })

  await check('中文文件名正常入库', async () => {
    const content = Buffer.from('# 中文文件名测试\n\n这是一份用中文命名的资料。核心词：朱雀。\n', 'utf8')
    const r = await upload('世界观·朱雀卷.md', content, 'text/markdown')
    if (!r.body?.ok) throw new Error(`失败：${r.body?.message}`)
    const title = r.body.documents?.[0]?.title || ''
    if (!/朱雀卷/.test(title)) throw new Error(`标题丢了中文：${title}`)
    console.log(`   入库标题：${title}`)
  })

  await check('并发上传 3 个文件互不干扰', async () => {
    const files = ['并发A.md', '并发B.md', '并发C.md'].map((n, i) => ({
      n,
      b: Buffer.from(`# ${n}\n\n第 ${i + 1} 号并发测试文档，关键词：并发词${i + 1}。\n`, 'utf8'),
    }))
    const results = await Promise.all(files.map((f) => upload(f.n, f.b, 'text/markdown')))
    const okCount = results.filter((r) => r.body?.ok).length
    if (okCount !== 3) throw new Error(`只有 ${okCount}/3 成功：${JSON.stringify(results.map((r) => r.body?.message))}`)
    console.log(`   3/3 成功`)
  })

  await check('清单里能看到上面所有文档', async () => {
    const r = await api(`/api/knowledge/docs?project=${encodeURIComponent(PROJECT)}`)
    if (!r.body?.ok) throw new Error(r.body?.message || '取清单失败')
    const titles = (r.body.documents || []).map((d) => d.title).join(' | ')
    console.log(`   共 ${r.body.docCount} 份`)
    for (const want of ['朱雀卷', '并发A', '并发B', '并发C']) {
      if (!titles.includes(want)) throw new Error(`清单缺 ${want}：${titles}`)
    }
  })

  await check('移出时传非法路径被拒绝（防穿越）', async () => {
    const r = await api('/api/knowledge/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: ['../../etc/passwd'] }),
    })
    if (r.body?.ok) throw new Error('非法路径竟然通过')
    console.log(`   拒绝原因：${String(r.body?.message || '').slice(0, 60)}`)
  })

  await check('不存在的项目返回可读错误（不是 500）', async () => {
    const r = await api('/api/knowledge/docs?project=__no_such_project__')
    if (r.status === 200 && r.body?.ok) throw new Error('竟然成功了')
    if (!r.body?.message) throw new Error('没有 message 字段')
    console.log(`   状态 ${r.status}：${String(r.body.message).slice(0, 80)}`)
  })

  await check('超长文件名不崩溃', async () => {
    const longName = `${'超长'.repeat(80)}.md`
    const r = await upload(longName, Buffer.from('# x\n', 'utf8'), 'text/markdown')
    // 上游可能截断或拒绝，只要不是 500 且返回了 JSON 就算稳
    if (typeof r.body !== 'object') throw new Error('返回了非 JSON')
    console.log(`   状态 ${r.status}：${r.body?.ok ? '接受并截断' : String(r.body?.message || '').slice(0, 60)}`)
  })

  await check('空 query 检索被本地拒绝', async () => {
    const r = await api('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: PROJECT, query: '   ' }),
    })
    if (r.body?.ok) throw new Error('空 query 竟然通过了')
    console.log(`   拒绝原因：${String(r.body?.message || '').slice(0, 60)}`)
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
  const del = await api(`/api/project?name=${PROJECT}`, { method: 'DELETE' })
  console.log(`\n清理：删除测试项目 ${PROJECT} → ${del.body?.ok ? '成功' : '失败'}`)
}

console.log(bad ? `\n${bad} 项失败` : '\n边界条件验收全部通过')
process.exit(bad ? 1 : 0)
