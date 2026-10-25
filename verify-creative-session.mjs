/**
 * 创意会话存储验收：会话 CRUD、排序、线程读写、1MB 上限、目录清理。
 * 跑法：node verify-creative-session.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5342
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'creative-session-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}
const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let json = null
  try {
    json = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json }
}
const post = (p, body) =>
  api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const put = (p, body) =>
  api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

let up = false
for (let i = 0; i < 80; i++) {
  try {
    const r = await fetch(`${APP}/api/health`)
    if (r.ok) {
      up = true
      break
    }
  } catch {
    /* wait */
  }
  await new Promise((r) => setTimeout(r, 400))
}
if (!up) {
  console.error('临时 dev server 启动失败')
  child.kill()
  process.exit(1)
}

try {
  // 1) 无项目时也能建会话
  const created = await post('/api/creative/sessions', { title: '', mode: 'reverse' })
  check('无项目可创建会话', created.json?.ok === true && Boolean(created.json.session?.id))
  const a = created.json?.session
  check('新模式被接受', a?.mode === 'reverse', String(a?.mode))
  check('会话目录已创建', fs.existsSync(path.join(TMP, 'creatives', a.id, 'sources')))

  // 2) 标题与模式可改
  const renamed = await put(`/api/creative/sessions/${a.id}`, { title: '抖音爆款拆解' })
  check('改名成功', renamed.json?.session?.title === '抖音爆款拆解', String(renamed.json?.session?.title))

  const badMode = await put(`/api/creative/sessions/${a.id}`, { mode: 'nope' })
  check('非法模式回落 plan', badMode.json?.session?.mode === 'plan', String(badMode.json?.session?.mode))

  // 3) 第二条会话排在前面
  await new Promise((r) => setTimeout(r, 15))
  const second = await post('/api/creative/sessions', { title: '第二条' })
  const b = second.json?.session
  const listed = await api('/api/creative/sessions')
  const ids = (listed.json?.sessions || []).map((s) => s.id)
  check('列表按最近更新倒序', ids[0] === b.id && ids.includes(a.id), ids.join(','))

  // 4) 线程读写
  const messages = [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: '你好' }], status: 'complete' },
    { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '在' }], status: 'complete' },
  ]
  const saved = await put(`/api/creative/sessions/${a.id}/thread`, { messages, activeSkills: [] })
  check('线程保存成功', saved.json?.ok === true && saved.json.thread?.messages?.length === 2)
  const loaded = await api(`/api/creative/sessions/${a.id}/thread`)
  check('线程可恢复', loaded.json?.thread?.messages?.[0]?.id === 'm1')

  // 5) 1MB 上限：超限拒绝且旧内容仍在
  const huge = [{ id: 'big', role: 'user', parts: [{ type: 'text', text: 'x'.repeat(1_200_000) }], status: 'complete' }]
  const tooLarge = await put(`/api/creative/sessions/${a.id}/thread`, { messages: huge })
  check('超限返回 413', tooLarge.status === 413, String(tooLarge.status))
  check('超限返回 thread-too-large', tooLarge.json?.kind === 'thread-too-large', String(tooLarge.json?.kind))
  const afterHuge = await api(`/api/creative/sessions/${a.id}/thread`)
  check('超限后旧线程未被覆盖', afterHuge.json?.thread?.messages?.length === 2)

  // 6) 概览带源与产物计数
  const summary = await api(`/api/creative/sessions/${a.id}`)
  check('概览返回计数', summary.json?.session?.sourceCount === 0 && summary.json?.session?.messageCount === 2)

  // 7) 删除只清自己
  const removed = await api(`/api/creative/sessions/${a.id}`, { method: 'DELETE' })
  check('删除成功', removed.json?.ok === true && removed.json.removed === true)
  check('目录已清理', !fs.existsSync(path.join(TMP, 'creatives', a.id)))
  check('另一会话目录仍在', fs.existsSync(path.join(TMP, 'creatives', b.id)))
  const afterDelete = await api(`/api/creative/sessions/${a.id}`)
  check('删除后读取返回 404', afterDelete.status === 404, String(afterDelete.status))

  // 8) 非法 id 被拒绝
  const badId = await api('/api/creative/sessions/..%2Fsecret')
  check('非法 id 被拒绝', badId.status >= 400, String(badId.status))

  // 9) 五张表都在
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.join(TMP, 'storyboard.sqlite'), { readOnly: true })
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creative_%'")
    .all()
    .map((r) => r.name)
    .sort()
  db.close()
  check(
    '五张创意表已建',
    tables.join(',') === 'creative_artifacts,creative_sessions,creative_shots,creative_sources,creative_threads',
    tables.join(','),
  )

  // 10) 前端 sessionStore 的接口契约（真实 HTTP）
  const ESBUILD = path.join(ROOT, 'node_modules', '.bin', 'esbuild')
  const bundle = path.join(TMP, 'session-store.mjs')
  const { execFileSync } = await import('node:child_process')
  execFileSync(ESBUILD, [
    path.join(ROOT, 'tests', 'session-store.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--log-level=warning',
    `--outfile=${bundle}`,
  ], { cwd: ROOT, stdio: 'inherit' })
  const mod = await import(`file://${bundle}`)
  const before = bad
  await mod.runSessionStoreChecks(APP, (name, ok, extra = '') => {
    check(name, ok, extra)
  })
  if (bad === before) console.log('（前端 store 全部通过）')
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n❌ ${bad} 项失败` : '\n✅ 全部通过')
process.exit(bad ? 1 : 0)
