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
  process.exit(1)
}

const builtin = fs.readFileSync(path.join(ROOT, 'skills', 'script', 'SKILL.md'), 'utf8')

try {
  const list = await api('/api/skills')
  check('技能列表成功', list.json?.ok === true && Array.isArray(list.json.skills))
  const ids = (list.json?.skills || []).map((s) => s.id).sort()
  check(
    '包含十个内置技能',
    ids.join(',') ===
      'asset,character,creative-plan,prompt,scene-code,scene-code-chat,scene3d,script,shotlist,video-reverse',
    ids.join(','),
  )
  const script = (list.json?.skills || []).find((s) => s.id === 'script')
  check('script 返回来源与内置文本', script?.source === 'builtin' && script?.text === builtin && script?.builtinText === builtin)

  const one = await api('/api/skills/script')
  check('单个技能读取成功', one.json?.ok === true && one.json.skill?.id === 'script')

  const missing = await api('/api/skills/nope')
  check('不存在的技能返回 400', missing.status === 400 && String(missing.json?.message || '').includes('不存在'))

  const traversal = await api('/api/skills/..%2Fsecret')
  check('路径穿越被拒绝', traversal.status === 400)

  const badId = await api('/api/skills/UPPER')
  check('非法 id 被拒绝', badId.status === 400)

  const edited = builtin.replace('你是短剧/漫剧的编剧与分集策划。', '你是短剧/漫剧的编剧与分集策划。（用户改）')
  const saved = await api('/api/skills/script', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: edited, baseVersion: 1 }),
  })
  check('保存覆盖成功', saved.json?.ok === true && saved.json.skill?.source === 'override')
  const afterSave = await api('/api/skills')
  const scriptSaved = (afterSave.json?.skills || []).find((s) => s.id === 'script')
  check('覆盖生效且保留内置文本', scriptSaved?.text === edited && scriptSaved?.builtinText === builtin)

  const reset = await api('/api/skills/script', { method: 'DELETE' })
  check('恢复默认成功', reset.json?.ok === true && reset.json.skill?.text === builtin && reset.json.skill?.source === 'builtin')
  const afterReset = await api('/api/skills/script')
  check('恢复后读取为内置', afterReset.json?.skill?.source === 'builtin' && afterReset.json.skill.text === builtin)

  const tooBig = await api('/api/skills/script', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'x'.repeat(65 * 1024), baseVersion: 1 }),
  })
  check('超大正文被拒绝', tooBig.status === 400 && String(tooBig.json?.message || '').includes('超过'))

  const empty = await api('/api/skills/script', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '   ', baseVersion: 1 }),
  })
  check('空正文被拒绝', empty.status === 400)
} finally {
  child.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
