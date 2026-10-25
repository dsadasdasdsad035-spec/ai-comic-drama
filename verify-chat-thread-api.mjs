/**
 * 聊天线程 API：按项目/工作台/集/镜头隔离、覆盖写、恢复、删除。
 * 跑法：node verify-chat-thread-api.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5323
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-thread-api-'))
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

const q = (over = {}) => {
  const p = { project: 'demo', surface: 'script', episode: 0, shotId: '', ...over }
  return new URLSearchParams(p).toString()
}
const put = (over, messages, activeSkills = []) =>
  api('/api/chat-thread', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...{ project: 'demo', surface: 'script', episode: 0, shotId: '' }, ...over, messages, activeSkills }),
  })

const userMsg = (text) => ({ id: 'u1', role: 'user', parts: [{ type: 'text', text }], status: 'complete' })
const assistantMsg = (text) => ({ id: 'a1', role: 'assistant', parts: [{ type: 'text', text }], status: 'complete' })

try {
  const empty = await api(`/api/chat-thread?${q()}`)
  check('新线程为空', empty.json?.ok === true && empty.json.thread === null)

  const saved = await put({}, [userMsg('第一句'), assistantMsg('收到')], [{ id: 'script', mode: 'host', version: 1, source: 'builtin' }])
  check('保存线程成功', saved.json?.ok === true && saved.json.thread?.messages?.length === 2)
  check('技能状态被保留', saved.json.thread?.activeSkills?.[0]?.id === 'script')

  const got = await api(`/api/chat-thread?${q()}`)
  check('读取线程恢复消息', got.json?.thread?.messages?.[0]?.parts?.[0]?.text === '第一句')
  check('读取线程恢复技能状态', got.json?.thread?.activeSkills?.[0]?.mode === 'host')

  await put({}, [userMsg('第二句'), assistantMsg('再收到')])
  const updated = await api(`/api/chat-thread?${q()}`)
  check('覆盖写不重复建行', updated.json?.thread?.messages?.length === 2)
  check('覆盖写内容更新', updated.json.thread.messages[0].parts[0].text === '第二句')

  const otherEp = await api(`/api/chat-thread?${q({ episode: 2 })}`)
  check('不同集隔离', otherEp.json?.thread === null)
  const otherShot = await api(`/api/chat-thread?${q({ surface: 'scene3d', shotId: 'E01-S01' })}`)
  check('不同镜头隔离', otherShot.json?.thread === null)
  const otherProject = await api(`/api/chat-thread?${q({ project: 'other' })}`)
  check('不同项目隔离', otherProject.json?.thread === null)

  const deleted = await api(`/api/chat-thread?${q()}`, { method: 'DELETE' })
  check('删除成功', deleted.json?.ok === true)
  const afterDelete = await api(`/api/chat-thread?${q()}`)
  check('删除后为空', afterDelete.json?.thread === null)

  const badProject = await api(`/api/chat-thread?${q({ project: '../x' })}`)
  check('非法项目被拒绝', badProject.status === 400)
  const badSurface = await api(`/api/chat-thread?${q({ surface: 'Bad Surface' })}`)
  check('非法 surface 被拒绝', badSurface.status === 400)
  const badMessages = await api('/api/chat-thread', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: 'demo', surface: 'script', messages: 'nope' }),
  })
  check('非数组 messages 被拒绝', badMessages.status === 400)
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
