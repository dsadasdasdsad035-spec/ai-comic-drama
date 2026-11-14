/**
 * 技能 API：列表 / 读取 / 覆盖 / 恢复默认 / 路径与大小限制。
 * 跑法：node verify-skills-api.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = process.cwd()
const PORT = 5321
const APP = `http://127.0.0.1:${PORT}`
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-api-'))
const FIXTURE_ID = 'verify-api-fixture'
const fixtureDir = path.join(ROOT, 'skills', FIXTURE_ID)
let bad = 0
const check = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const fixtureText = `---
name: ${FIXTURE_ID}
description: API 验收夹具
stage: shot
runtime: json-tools
tools: [read_episode]
inputs: [brief]
output: shots-v1
contracts: [shots-v1]
version: 1
---
## 角色与约束
你是分镜师兼 AI 影像提示词工程师。

## 任务
按用户 brief 产出镜头表。
`

fs.mkdirSync(fixtureDir, { recursive: true })
fs.writeFileSync(path.join(fixtureDir, 'SKILL.md'), fixtureText)

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP }, stdio: 'ignore' },
)

const api = async (p, init) => {
  const r = await fetch(`${APP}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json: j }
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
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  process.exit(1)
}

try {
  const list = await api('/api/skills')
  check('技能列表成功', list.json?.ok === true && Array.isArray(list.json.skills))
  const ids = (list.json?.skills || []).map((s) => s.id).sort()
  check('默认目录无历史内置 id', !ids.includes('shotlist') && !ids.includes('character'), ids.join(','))
  check('含验收夹具', ids.includes(FIXTURE_ID), ids.join(','))
  const fixture = (list.json?.skills || []).find((s) => s.id === FIXTURE_ID)
  check(
    '夹具返回来源与正文',
    fixture?.source === 'builtin' && fixture?.text === fixtureText && fixture?.builtinText === fixtureText,
  )

  const one = await api(`/api/skills/${FIXTURE_ID}`)
  check('单个技能读取成功', one.json?.ok === true && one.json.skill?.id === FIXTURE_ID)

  const missing = await api('/api/skills/nope')
  check('不存在的技能返回 400', missing.status === 400 && String(missing.json?.message || '').includes('不存在'))

  const traversal = await api('/api/skills/..%2Fsecret')
  check('路径穿越被拒绝', traversal.status === 400)

  const badId = await api('/api/skills/UPPER')
  check('非法 id 被拒绝', badId.status === 400)

  const marker = '你是分镜师兼 AI 影像提示词工程师。'
  const fixtureBody = fixtureText.replace(/^---[\s\S]*?---\r?\n/, '')
  const editedBody = fixtureBody.replace(marker, `${marker}（用户改）`)
  const saved = await api(`/api/skills/${FIXTURE_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: editedBody, baseVersion: 3 }),
  })
  check('保存覆盖成功', saved.json?.ok === true && saved.json.skill?.source === 'override')
  const afterSave = await api('/api/skills')
  const fixtureSaved = (afterSave.json?.skills || []).find((s) => s.id === FIXTURE_ID)
  check('覆盖生效且保留内置文本', fixtureSaved?.text?.includes('（用户改）') && fixtureSaved?.builtinText === fixtureText)

  const reset = await api(`/api/skills/${FIXTURE_ID}`, { method: 'DELETE' })
  check('恢复默认成功', reset.json?.ok === true && reset.json.skill?.text === fixtureText && reset.json.skill?.source === 'builtin')
  const afterReset = await api(`/api/skills/${FIXTURE_ID}`)
  check('恢复后读取为内置', afterReset.json?.skill?.source === 'builtin' && afterReset.json.skill.text === fixtureText)

  const tooBig = await api(`/api/skills/${FIXTURE_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'x'.repeat(65 * 1024), baseVersion: 3 }),
  })
  check('超大正文被拒绝', tooBig.status === 400 && String(tooBig.json?.message || '').includes('超过'))

  const empty = await api(`/api/skills/${FIXTURE_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '   ', baseVersion: 3 }),
  })
  check('空正文被拒绝', empty.status === 400)
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.rmSync(fixtureDir, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
