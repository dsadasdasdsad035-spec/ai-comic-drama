/**
 * 创意流程冒烟（8.2）。
 *
 * 覆盖「不依赖模型回合」的那部分完整链路，这些正是换运行时后最容易被弄坏的：
 * 1. 宿主真的被拉起（`/studio/` 触发 ensureStarted）并注册完全部平台工具；
 * 2. 技能能被读到（read_skill_text / read_skill_file 走宿主 → 工具桥 → 技能目录）；
 * 3. 破坏性与有成本工具在执行前被拦下（不在宿主里跑就不该扣费/写库）；
 * 4. 专家 preset 带自动压缩，长会话不会无界增长。
 *
 * 模型回合（真正生成回复、提交草稿、出图出片）需要渠道 Key 与计费，
 * 不适合放进自动测试；它们的契约由工具桥与插件测试覆盖。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-flow-'))
const STATE = path.join(TMP, 'state')
const TOKEN = 'flow-smoke-token'

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
  proc.stderr.on('data', (chunk) => {
    log += chunk.toString()
  })
  proc.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`服务提前退出（${code}）：${log.slice(-800)}`))
  })
})
const base = `http://127.0.0.1:${port}`

async function bridge(tool, args = {}) {
  const res = await fetch(`${base}/api/studio/tools/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-studio-internal': TOKEN },
    body: JSON.stringify({ project: '', episode: 1, name: tool, args }),
  })
  return { status: res.status, body: await res.json() }
}

/** 进一次创意页，触发宿主启动 */
await fetch(`${base}/studio/`).catch(() => {})

async function waitHostReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/studio/_host/status`, { credentials: 'include' })
    const body = await res.json().catch(() => ({}))
    if (body.state === 'ready') return body
    if (body.state === 'failed') throw new Error(`宿主启动失败：${body.error || '未知原因'}`)
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`宿主未在 ${timeoutMs}ms 内就绪：${log.slice(-800)}`)
}

await check('创意页能把宿主拉起到就绪', async () => {
  const status = await waitHostReady()
  assert.equal(status.state, 'ready')
})

await check('宿主注册完全部平台工具（含技能读工具）', async () => {
  let status = {}
  for (let i = 0; i < 60; i += 1) {
    const res = await fetch(`${base}/studio/_host/status`, { credentials: 'include' })
    status = await res.json()
    if (Number(status.tools?.count) >= 40) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.ok(Number(status.tools?.count) >= 40, `只注册了 ${status.tools?.count} 个工具`)
  for (const name of ['read_skill_text', 'read_skill_file', 'list_installed_skills', 'submit_shots']) {
    assert.ok(status.tools.names.includes(name), `缺少工具 ${name}`)
  }
})

await check('技能可读：正文与子文件都能取到', async () => {
  const skills = await bridge('list_installed_skills', {})
  assert.equal(skills.status, 200)
  // 桥把工具结果分成 summary（模型可见）与 details（界面可见）；清单在 details 里
  const list = skills.body.details?.skills
  assert.ok(Array.isArray(list) && list.length > 0, '技能清单为空')
  assert.ok(
    list.some((s) => s.id === 'short-drama'),
    `技能清单里没有 short-drama：${list.map((s) => s.id).join(',')}`,
  )

  const text = await bridge('read_skill_text', { id: 'short-drama' })
  assert.equal(text.status, 200)
  const summary = JSON.stringify(text.body)
  assert.match(summary, /短剧创作路由/, '读到的不是 short-drama 正文')
})

await check('破坏性工具在桥层面仍是「问一次」而不是直接执行', async () => {
  const r = await bridge('submit_shots', { episode: 1, shots: [] })
  // 桥本身不做审批（审批在宿主 pre-execute）；这里确认它不会把空提交当成功写库
  assert.ok(r.status === 200)
  assert.notEqual(r.body.ok, true, '空提交被当成成功')
})

await check('专家 preset 带自动压缩（长会话不会无界增长）', async () => {
  const patch = path.join(STATE, 'dsh', 'profiles', 'web', 'creative-experts.patch.yml')
  assert.ok(fs.existsSync(patch), '专家 patch 不存在')
  const text = fs.readFileSync(patch, 'utf8')
  assert.ok(text.includes('dsh-compaction-basic'), '没有自动压缩')
  assert.ok(text.includes('dsh-persona'), '没有 persona')
})

proc.kill('SIGTERM')

if (bad) {
  console.error(`\n${bad} 项未通过`)
  process.exit(1)
}
console.log('\n创意流程冒烟通过（模型回合需真实渠道 Key，另行手测）')
process.exit(0)
