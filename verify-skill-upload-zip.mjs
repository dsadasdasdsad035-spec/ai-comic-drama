/**
 * 技能 zip 上传与 SkillHub 安装（本地 mock）验收。
 * 跑法：node verify-skill-upload-zip.mjs
 */
import { createServer } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { strToU8, zipSync } from 'fflate'
import { createCheck, makeProjectsDir, startApp } from './verify-harness.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = 5338
const SKILL_ID = 'verify-upload-fixture'
const AGENT_PACK_ID = 'verify-agent-pack'
const HUB_SLUG = 'verify-mock-hub-skill'
const HUB_NS = 'verify-ns'

const SKILL_MD = `---
name: ${SKILL_ID}
description: zip 上传验收夹具（Agent 包）
---
## ${SKILL_ID}
按说明操作；写分镜用内置 submit_shots。
`

const HUB_SKILL_MD = `---
name: ${HUB_SLUG}
description: SkillHub mock Agent 包
---
## ${HUB_SLUG}
mock
`

function zipFromTree(entries) {
  const map = {}
  for (const [p, text] of entries) {
    map[p] = strToU8(text)
  }
  return Buffer.from(zipSync(map))
}

const AGENT_PACK_MD = `---
name: ${AGENT_PACK_ID}
description: |
  SkillHub Agent 包验收
allowed-tools:
  - Read
  - Bash
---
## ${AGENT_PACK_ID}
按 SKILL 操作。
`

const zipUpload = zipFromTree([
  [`${SKILL_ID}/SKILL.md`, SKILL_MD],
])

const zipAgentPack = zipFromTree([[`${AGENT_PACK_ID}/SKILL.md`, AGENT_PACK_MD]])

const zipHub = zipFromTree([[`${HUB_SLUG}/SKILL.md`, HUB_SKILL_MD]])

let bad = 0
const unit = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!cond) bad++
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-skill-zip-'))
const esbuild = path.join(ROOT, 'node_modules', '.bin', 'esbuild')

function bundle(entry, name) {
  const out = path.join(outDir, `${name}.mjs`)
  execFileSync(esbuild, [entry, '--bundle', '--platform=node', '--format=esm', '--log-level=error', `--outfile=${out}`])
  return out
}

const zipMod = await import(bundle(path.join(ROOT, 'server', 'skillZip.mjs'), 'skillZip'))

const extracted = zipMod.extractSkillMdFromZip(zipUpload)
unit('zip 解压找到 SKILL.md', extracted.path.endsWith('SKILL.md') && extracted.text.includes('name: verify-upload-fixture'))
unit(
  'manifestName 解析',
  zipMod.manifestNameFromSkillText(SKILL_MD) === SKILL_ID,
  zipMod.manifestNameFromSkillText(SKILL_MD),
)
unit('双层目录剥离为 SKILL.md', extracted.path === 'SKILL.md', extracted.path)

try {
  zipMod.extractSkillMdFromZip(zipSync({ 'readme.txt': strToU8('no skill') }))
  unit('无 SKILL.md 应失败', false)
} catch (e) {
  unit('无 SKILL.md 应失败', String(e.message).includes('未找到'))
}

const mockHub = createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://127.0.0.1')
  if (u.pathname === `/api/v1/skills/${HUB_SLUG}`) {
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        skill: { slug: HUB_SLUG, displayName: 'Mock Hub Skill' },
        namespace: { handle: HUB_NS },
        latestVersion: { version: '1.0.0' },
      }),
    )
    return
  }
  if (u.pathname === '/api/v1/download') {
    res.setHeader('Content-Type', 'application/zip')
    res.end(zipHub)
    return
  }
  if (u.pathname === '/api/skills') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 0, data: { skills: [], total: 0 } }))
    return
  }
  if (u.pathname === '/api/v1/categories') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ items: [{ key: 'other', name: '其他', active: true }] }))
    return
  }
  res.statusCode = 404
  res.end('not found')
})

await new Promise((resolve) => mockHub.listen(0, '127.0.0.1', resolve))
const mockPort = mockHub.address().port
const mockBase = `http://127.0.0.1:${mockPort}`

const PROJECTS = makeProjectsDir('skill-upload-')
const { app, stop } = await startApp({
  projectsDir: PROJECTS,
  port: PORT,
  extraEnv: { SKILLHUB_BASE_URL: mockBase },
})

async function api(p, init) {
  const r = await fetch(`${app}${p}`, init)
  let j = null
  try {
    j = await r.json()
  } catch {
    /* ignore */
  }
  return { status: r.status, json: j }
}

try {
  const up = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipUpload,
  })
  unit('upload-zip 成功', up.json?.ok === true && up.json?.skill?.id === SKILL_ID, JSON.stringify(up.json?.message))
  unit('来源为 upload', up.json?.skill?.source === 'upload', up.json?.skill?.source)

  const list = await api('/api/skills')
  const row = (list.json?.skills || []).find((s) => s.id === SKILL_ID)
  unit('列表含上传技能', Boolean(row) && row.source === 'upload', row?.id)

  const ap = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipAgentPack,
  })
  unit('Agent 包 zip 上传成功', ap.json?.ok === true && ap.json?.profile === 'agent-pack', ap.json?.message)
  unit('Agent 包 id 正确', ap.json?.skill?.id === AGENT_PACK_ID, ap.json?.skill?.id)

  const dup = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: zipUpload,
  })
  unit('重复上传覆盖', dup.json?.ok === true, dup.json?.message)

  const badZip = await api('/api/skills/upload-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: Buffer.from('not-a-zip'),
  })
  unit('非法 zip 被拒绝', badZip.status === 400, badZip.json?.message)

  const cats = await api('/api/skillhub/categories')
  unit('SkillHub 分类代理', cats.json?.ok === true && Array.isArray(cats.json?.items))

  const market = await api('/api/skillhub/skills?page=1&pageSize=5')
  unit('SkillHub 列表代理', market.json?.ok === true && Array.isArray(market.json?.items))

  const inst = await api('/api/skillhub/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: HUB_SLUG, namespace: HUB_NS, version: '1.0.0' }),
  })
  unit('SkillHub mock 安装', inst.json?.ok === true && inst.json?.skill?.source === 'skillhub', inst.json?.message)
  unit('安装写入 slug', inst.json?.skill?.skillhub?.slug === HUB_SLUG)

  const list2 = await api('/api/skills')
  const hubRow = (list2.json?.skills || []).find((s) => s.id === HUB_SLUG)
  unit('列表含 SkillHub 技能', hubRow?.source === 'skillhub', hubRow?.id)

  const unAp = await api(`/api/skill-installs/${encodeURIComponent(AGENT_PACK_ID)}`, { method: 'DELETE' })
  unit('卸载 Agent 包', unAp.json?.ok === true)

  const un = await api(`/api/skill-installs/${encodeURIComponent(SKILL_ID)}`, { method: 'DELETE' })
  unit('卸载 upload 技能', un.json?.ok === true)
  const un2 = await api(`/api/skill-installs/${encodeURIComponent(HUB_SLUG)}`, { method: 'DELETE' })
  unit('卸载 SkillHub 技能', un2.json?.ok === true)
} catch (e) {
  console.error('❌ 验收异常', e)
  bad++
} finally {
  stop()
  mockHub.close()
  fs.rmSync(outDir, { recursive: true, force: true })
}

if (bad) process.exit(1)
console.log('verify-skill-upload-zip: 全部通过')
