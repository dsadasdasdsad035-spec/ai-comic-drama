/**
 * submit_prompts / submit_shot_prompts 别名在真实服务上的冒烟。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-prompt-smoke-'))
const STATE = path.join(TMP, 'state')
const TOKEN = 'prompt-smoke-token'

const proc = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
  cwd: ROOT,
  env: {
    ...process.env,
    SB_PROJECTS_DIR: TMP,
    SB_STATE_ROOT: STATE,
    SB_MEDIA_ROOT: path.join(TMP, 'media'),
    SB_PORT: '0',
    SB_STUDIO_INTERNAL_TOKEN: TOKEN,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`启动超时：${log.slice(-600)}`)), 60_000)
  proc.stdout.on('data', (chunk) => {
    log += chunk.toString()
    const m = log.match(/\[server\] listening http:\/\/[^:]+:(\d+)/)
    if (m) {
      clearTimeout(timer)
      resolve(Number(m[1]))
    }
  })
  proc.stderr.on('data', (chunk) => log += chunk.toString())
  proc.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${log.slice(-800)}`))
  })
})
const base = `http://127.0.0.1:${port}`

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-studio-internal': TOKEN },
    body: JSON.stringify(body || {}),
  })
  return { status: res.status, body: await res.json() }
}

await fetch(`${base}/studio/`).catch(() => {})
const deadline = Date.now() + 90_000
while (Date.now() < deadline) {
  const s = await (await fetch(`${base}/studio/_host/status`)).json()
  if (s.state === 'ready') break
  if (s.state === 'failed') throw new Error(s.error || '宿主失败')
  await new Promise((r) => setTimeout(r, 400))
}

const catalog = await post('/api/studio/tools', { project: '', episode: 1 })
assert.equal(catalog.body.ok !== false, true)
const names = (catalog.body.tools || []).map((t) => t.name)
assert.ok(names.includes('submit_prompts'), `catalog 缺 submit_prompts：${names.length} 个`)
assert.ok(names.includes('submit_shot_prompts'), 'catalog 缺 submit_shot_prompts 别名')

const alias = await post('/api/studio/tools/execute', {
  name: 'submit_shot_prompts',
  args: { shots: [{ no: 'S01', keyframe_prompt: 'a', video_prompt: 'b' }] },
  expertId: 'expert-omni',
})
assert.equal(alias.status, 200)
const err = String(alias.body.error || alias.body.message || '')
assert.ok(!err.includes('没有名为'), `别名被当成未知工具：${err}`)
assert.ok(!/unknown tool/i.test(err), `DSH 式 unknown tool：${err}`)

const canonical = await post('/api/studio/tools/execute', {
  name: 'submit_prompts',
  args: { shots: [{ no: 'S01', keyframe_prompt: 'a', video_prompt: 'b' }] },
  expertId: 'expert-omni',
})
assert.equal(canonical.status, 200)
assert.ok(canonical.body.ok === false, '无项目时应失败但不 unknown')
assert.match(String(canonical.body.error || ''), /项目|未选|没有/)

proc.kill('SIGTERM')
console.log('✅ studio-prompt-tools-smoke（catalog + 别名 execute）')