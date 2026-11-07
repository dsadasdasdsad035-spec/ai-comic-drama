/**
 * 3D 聊天：scene3d 技能可加载、scene3d 线程可 DELETE 清空。
 * 跑法：node verify-scene3d-chat-clear.mjs
 */
import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5362
const APP = `http://127.0.0.1:${PORT}`
const PROJECT = `scene3d-clear-${Date.now()}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'scene3d-clear-'))
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

check('内置 scene3d 经 parseSkillRecords 可加载', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules', '.bin', 'esbuild'), path.join(ROOT, 'tests', 'skill-parser.ts'), '--bundle', '--platform=node', '--format=esm', '--outfile=/tmp/scene3d-skill-parser.mjs', '--log-level=warning'], { cwd: ROOT, stdio: 'pipe' })
  const out = execFileSync(process.execPath, ['/tmp/scene3d-skill-parser.mjs'], { encoding: 'utf8' })
  return out.includes('✅ 内置 scene3d 技能可加载')
})

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const res = await fetch(`${APP}${p}`, init)
  const j = await res.json().catch(() => ({}))
  return { ...j, status: res.status }
}

let up = false
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${APP}/api/health`)).ok) {
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

await api(`/api/project?name=${encodeURIComponent(PROJECT)}&create=1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: PROJECT, aspect: '16:9' }),
})

const shotId = 'ep1-sc01-sh01'
const put = await api('/api/chat-thread', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: PROJECT,
    surface: 'scene3d',
    episode: 0,
    shotId,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }], status: 'complete' }],
    activeSkills: [],
  }),
})
check('scene3d 线程可写入', put.ok)

const q = new URLSearchParams({ project: PROJECT, surface: 'scene3d', shotId })
const del = await api(`/api/chat-thread?${q}`, { method: 'DELETE' })
check('scene3d 线程可 DELETE', del.ok)

const got = await api(`/api/chat-thread?${q}`)
const msgs = got.thread?.messages || []
check('清空后无消息', Array.isArray(msgs) && msgs.length === 0, `len=${msgs.length}`)

child.kill()
process.exit(bad ? 1 : 0)
