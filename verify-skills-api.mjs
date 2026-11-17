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
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-state-'))
const FIXTURE_ID = 'verify-api-fixture'
const DUAL_ID = 'verify-api-dual'
const fixtureDir = path.join(ROOT, 'skills', FIXTURE_ID)
const dualBuiltinDir = path.join(ROOT, 'skills', DUAL_ID)
const dualInstalledDir = path.join(STATE, 'installed-skills', DUAL_ID)
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

// ---- 2.1：目录解析三种情况（直接调用 server/skills.mjs，不起服务）----
process.env.SB_STATE_ROOT = STATE
const skillsMod = await import('./server/skills.mjs')

const SOLO_BUILTIN = 'verify-solo-builtin'
const SOLO_INSTALLED = 'verify-solo-installed'
const soloBuiltinDir = path.join(ROOT, 'skills', SOLO_BUILTIN)
const soloInstalledDir = path.join(STATE, 'installed-skills', SOLO_INSTALLED)

const dualBuiltinText = `---\nname: ${DUAL_ID}\ndescription: 内置版\n---\n内置正文\n`
const dualInstalledText = `---\nname: ${DUAL_ID}\ndescription: 安装版\n---\n安装正文\n`
const dualBothText = `---\nname: ${DUAL_ID}\ndescription: 双层同名\n---\n安装目录的正文\n`
const dualBuiltinOnlyText = `---\nname: ${DUAL_ID}\ndescription: 仅内置有\n---\n只有内置提供这段\n`

try {
  // 仅内置
  fs.mkdirSync(soloBuiltinDir, { recursive: true })
  fs.writeFileSync(path.join(soloBuiltinDir, 'SKILL.md'), `---\nname: ${SOLO_BUILTIN}\n---\n内置\n`)
  const onlyBuiltin = skillsMod.resolveSkillDir(ROOT, SOLO_BUILTIN)
  check('仅内置时来源为 builtin', onlyBuiltin?.source === 'builtin', onlyBuiltin?.source)

  // 仅安装
  fs.mkdirSync(soloInstalledDir, { recursive: true })
  fs.writeFileSync(path.join(soloInstalledDir, 'SKILL.md'), `---\nname: ${SOLO_INSTALLED}\n---\n安装\n`)
  const onlyInstalled = skillsMod.resolveSkillDir(ROOT, SOLO_INSTALLED)
  check('仅安装时来源为 installed', onlyInstalled?.source === 'installed', onlyInstalled?.source)

  // 两者都有：命中安装
  fs.mkdirSync(dualBuiltinDir, { recursive: true })
  fs.mkdirSync(path.join(dualBuiltinDir, 'references'), { recursive: true })
  fs.writeFileSync(path.join(dualBuiltinDir, 'SKILL.md'), dualBuiltinText)
  fs.writeFileSync(path.join(dualBuiltinDir, 'references', 'shared.md'), dualBuiltinText)
  fs.writeFileSync(path.join(dualBuiltinDir, 'references', 'only-builtin.md'), dualBuiltinOnlyText)

  fs.mkdirSync(path.join(dualInstalledDir, 'references'), { recursive: true })
  fs.writeFileSync(path.join(dualInstalledDir, 'SKILL.md'), dualBothText)
  fs.writeFileSync(path.join(dualInstalledDir, 'references', 'shared.md'), dualInstalledText)

  const dual = skillsMod.resolveSkillDir(ROOT, DUAL_ID)
  check('两处都有时来源为 installed', dual?.source === 'installed', dual?.source)
  check('两处都有时正文来自安装', skillsMod.readSkillFile(ROOT, DUAL_ID) === dualBothText)

  // 逐文件回落：同名路径取安装版，仅内置有的文件仍可读
  const sharedSub = skillsMod.readSkillSubFile(ROOT, DUAL_ID, 'references/shared.md')
  check('同名附件取安装版', sharedSub.source === 'installed' && sharedSub.text === dualInstalledText, sharedSub.source)
  const fallbackSub = skillsMod.readSkillSubFile(ROOT, DUAL_ID, 'references/only-builtin.md')
  check('安装缺的附件回落内置', fallbackSub.source === 'builtin' && fallbackSub.text === dualBuiltinOnlyText, fallbackSub.source)

  const atts = skillsMod.listSkillAttachments(ROOT, DUAL_ID).map((a) => a.path)
  check('附件清单合并两个根', atts.includes('references/shared.md') && atts.includes('references/only-builtin.md'), atts.join(','))

  try {
    skillsMod.readSkillSubFile(ROOT, DUAL_ID, '../../../.env')
    check('安装根不绕过越界校验', false)
  } catch (e) {
    check('安装根不绕过越界校验', String(e.message).includes('不合法'), e.message)
  }
} finally {
  // 单元断言用的目录先清掉，避免干扰下面的 API 断言
  fs.rmSync(soloBuiltinDir, { recursive: true, force: true })
  fs.rmSync(soloInstalledDir, { recursive: true, force: true })
}

const child = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
  { cwd: ROOT, env: { ...process.env, SB_PROJECTS_DIR: TMP, SB_STATE_ROOT: STATE }, stdio: 'ignore' },
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

  // 2.2：同一 id 在两处都存在时，正文与附件来自安装目录
  const dualRow = (list.json?.skills || []).find((s) => s.id === DUAL_ID)
  check('两处同 id 列表取安装正文', dualRow?.text === dualBothText, dualRow?.text?.slice(-12))
  const dualAtts = (dualRow?.attachments || []).map((a) => a.path)
  check(
    '两处同 id 附件清单合并',
    dualAtts.includes('references/shared.md') && dualAtts.includes('references/only-builtin.md'),
    dualAtts.join(','),
  )
  check('附件计数与清单一致', dualRow?.fileCount === dualAtts.length, `${dualRow?.fileCount}/${dualAtts.length}`)
  const soloRow = (list.json?.skills || []).find((s) => s.id === FIXTURE_ID)
  check('仅 SKILL.md 的包附件计数为 0', soloRow?.fileCount === 0 && Array.isArray(soloRow?.attachments))

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
  fs.rmSync(STATE, { recursive: true, force: true })
  fs.rmSync(fixtureDir, { recursive: true, force: true })
  fs.rmSync(dualBuiltinDir, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
